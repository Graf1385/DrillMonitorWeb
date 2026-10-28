'use strict';

// ── Приём данных BCS_DrillerMonitorLoader по RS-485 ──────────────────────────
//
// Монитор и компьютер с Loader соединены линией RS-485 через преобразователи
// USB-UART (на мониторе — WCH CH343, в системе /dev/ttyCH343, см.
// scripts/setup-serial.sh). Loader шлёт кадры формата server/serialFrame.js;
// каждая запись попадает в тот же конвейер, что и HTTP push (server/ingest.js).
//
// Без сторонних модулей: порт настраивается через stty и читается как файл —
// на сервере без интернета нативные npm-пакеты не поставить.
//
// Настройки: server/data/serial-settings.json { enabled, port, baud };
// переменные окружения SERIAL_ENABLED / SERIAL_PORT / SERIAL_BAUD имеют
// приоритет. Порт может появиться позже (hot-plug) — открытие повторяется.

const fs       = require('fs');
const path     = require('path');
const { execFile } = require('child_process');
const { FrameParser } = require('./serialFrame');
const { ConfigReassembler } = require('./configReassembler');
const ingest      = require('./ingest');
const ingestAdmin = require('./ingestAdmin');
const updatePackage = require('./updatePackage');
const mono        = require('./monotonic');
const logger      = require('./logger');

const SETTINGS_FILE = path.join(__dirname, 'data', 'serial-settings.json');
// 57600 бод — запас по дальности для линии RS-485 от 100 м (монитор стоит далеко от ПК)
const DEFAULTS      = { enabled: true, port: '/dev/ttyCH343', baud: 57600 };
const BAUD_RATES    = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];
const RETRY_MS      = 10000;

// Порт читаем сами, а не потоком fs.createReadStream: тот отдаёт чтение в пул
// libuv, где оно виснет в блокирующем read() до первого байта. Пока поток пула
// занят, node не может завершиться — systemd ждал остановку до таймаута и
// добивал службу, то есть каждая перезагрузка табло была длиннее на эти секунды
// (проверено на устройстве: с выключённым приёмом остановка 42 мс, с
// включённым — упиралась в таймаут). С `min 0 time` read() возвращается и без
// данных, поэтому поток свободен почти всегда.
const READ_DECISECONDS = 5;        // VTIME: read() вернётся максимум через 0,5 с
const READ_BUFFER      = 4096;

// Преобразователь может переподключиться по USB (так и было 2026-10-23: он
// пересел с ttyACM0 на ttyACM1). Пустое чтение от этого неотличимо — порт
// «открыт», ошибок нет, а данных нет никогда. Поэтому в тишине сверяем, ведёт
// ли /dev/ttyCH343 туда же, что и наш дескриптор.
const DEVICE_CHECK_MS  = 3000;
const FAST_RETRY_MS    = 500;
/// Чтение возвращается не реже чем раз в VTIME; дольше этого — оно замерло.
const STALL_MS         = 4000;

// Производители преобразователей USB-UART, которые считаем «нашими», когда
// штатного узла нет: WCH (CH343/CH340 — стоит на табло), FTDI, Silicon Labs,
// Prolific. По ним отличаем преобразователь от, скажем, модема на ttyACM.
const CONVERTER_VENDORS = ['1a86', '0403', '10c4', '067b'];

let _settings = Object.assign({}, DEFAULTS);
let _activePort = null;    // какой узел открыт на самом деле (может быть запасным)
let _fd       = null;
let _readingFd   = null;   // дескриптор, на котором сейчас висит read()
let _closePending = null;  // его же закрыли, но ждём возврата чтения
let _lastReadAt   = 0;     // когда чтение последний раз возвращалось
let _watchdog     = null;  // сторож: не ушёл ли порт и не замерло ли чтение
let _parser   = null;
let _retry    = null;
let _stopped  = true;
let _open     = false;
let _lastErr  = null;
let _lastErrLogged = '';
const _stats  = { framesOk: 0, framesBad: 0, lastFrameAt: 0, openedAt: 0,
                  // монотонные отметки: системные часы подводит timeSync, и
                  // прыжок часов не должен выглядеть как тишина на линии
                  lastFrameMono: 0, openedMono: 0, reopens: 0, framesSinceOpen: 0 };

// ── settings ─────────────────────────────────────────────────────────────────

function _sanitize(s) {
    const out = Object.assign({}, DEFAULTS);
    if (s && typeof s === 'object') {
        if (typeof s.enabled === 'boolean') out.enabled = s.enabled;
        if (typeof s.port === 'string' && /^\/dev\/tty[A-Za-z0-9_]+$/.test(s.port)) out.port = s.port;
        const b = parseInt(s.baud, 10);
        if (BAUD_RATES.indexOf(b) !== -1) out.baud = b;
    }
    return out;
}

function loadSettings() {
    let fromFile = null;
    try { fromFile = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch (_) {}
    const s = _sanitize(fromFile);
    if (process.env.SERIAL_ENABLED != null) s.enabled = process.env.SERIAL_ENABLED !== '0';
    if (process.env.SERIAL_PORT)            s.port    = process.env.SERIAL_PORT;
    if (process.env.SERIAL_BAUD)            s.baud    = parseInt(process.env.SERIAL_BAUD, 10) || s.baud;
    _settings = s;
    return s;
}

function saveSettings(newSettings) {
    const s = _sanitize(newSettings);
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
    _settings = s;
    restart();
    return s;
}

function getSettings() { return Object.assign({}, _settings); }

// ── port lifecycle ───────────────────────────────────────────────────────────

function _log(msg) {
    try { logger.log(msg); } catch (_) {}
    console.log('[serial] ' + msg);
}

function _setError(msg) {
    _lastErr = msg;
    if (msg && msg !== _lastErrLogged) { _lastErrLogged = msg; _log('RS-485: ' + msg); }
}

function _scheduleRetry(fast) {
    if (_stopped) return;
    clearTimeout(_retry);
    _retry = setTimeout(_openPort, fast ? FAST_RETRY_MS : RETRY_MS);
}

/// Тот ли это физический порт, что мы открыли? Проверяем по /proc: после
/// переподключения преобразователя символьная ссылка ведёт уже на другой узел.
function _deviceChanged(fd) {
    try {
        return fs.realpathSync(_activePort || _settings.port) !== fs.readlinkSync('/proc/self/fd/' + fd);
    } catch (_) {
        return true;   // узла нет или не прочитать — переоткрываем
    }
}

/// Кто на том конце узла: «идентификатор производителя:изделия» USB-устройства.
/// Путь к устройству обязательно разворачиваем realpath: в /sys это ссылка, а
/// `path.join(…, '..')` схлопнул бы её текстуально и ушёл не туда.
function _usbVendor(dev) {
    try {
        const node = path.basename(fs.realpathSync(dev));
        const iface = fs.realpathSync('/sys/class/tty/' + node + '/device');   // …/2-4/2-4:1.0
        const base  = path.dirname(iface);                                     // …/2-4
        const vid  = fs.readFileSync(path.join(base, 'idVendor'),  'utf8').trim().toLowerCase();
        const pid  = fs.readFileSync(path.join(base, 'idProduct'), 'utf8').trim().toLowerCase();
        return vid + ':' + pid;
    } catch (_) { return null; }
}

/**
 * Какой узел открывать. Обычно — настроенный (/dev/ttyCH343, ссылка от udev).
 * Но доступа к табло на буровой нет, а ссылки может не оказаться: правило udev
 * не применилось после обновления, преобразователь перечислился как обычный
 * ttyACM. Тогда берём единственный найденный преобразователь — лучше принимать
 * данные с запасного узла, чем ждать человека с клавиатурой.
 *
 * Выбираем только при однозначности: два преобразователя сразу — повод
 * написать в лог, а не угадывать.
 */
function choosePort(configured, available, vendorOf) {
    if (available.indexOf(configured) !== -1) return { port: configured, fallback: false };

    const others = available.filter(function (p) { return p !== configured; });
    if (!others.length) return { port: null, reason: 'последовательных портов нет' };

    const known = others.filter(function (p) {
        const v = vendorOf ? vendorOf(p) : null;
        return !!v && CONVERTER_VENDORS.indexOf(v.split(':')[0]) !== -1;
    });

    if (known.length === 1)
        return { port: known[0], fallback: true, vendor: vendorOf ? vendorOf(known[0]) : null };
    if (known.length > 1)
        return { port: null, reason: 'преобразователей несколько: ' + known.join(', ') };
    if (others.length === 1)
        return { port: others[0], fallback: true, vendor: vendorOf ? vendorOf(others[0]) : null };
    return { port: null, reason: 'подходящий порт не опознан: ' + others.join(', ') };
}

function _resolvePort() {
    const configured = _settings.port;
    if (fs.existsSync(configured)) return { port: configured, fallback: false };
    return choosePort(configured, listPorts(), _usbVendor);
}

/**
 * Сторож порта. Сам цикл чтения проверять себя не может: на исчезнувшем
 * устройстве read() перестаёт возвращаться вовсе, и всё замирает — порт
 * «открыт», ошибок нет, данных нет никогда. Ровно так табло и оглохло, когда
 * преобразователь пересел с ttyACM0 на ttyACM1. Поэтому проверяем со стороны:
 * раз в DEVICE_CHECK_MS смотрим, ведёт ли /dev/ttyCH343 туда же, куда наш
 * дескриптор, и возвращается ли чтение вообще.
 */
function _startWatchdog() {
    if (_watchdog) return;
    _watchdog = setInterval(function () {
        if (_stopped || !_open || _fd === null) return;
        const fd      = _fd;
        const stalled = mono.now() - _lastReadAt > STALL_MS;
        // Работаем с запасного узла, а штатный появился (udev наконец отработал)
        let returned = false;
        try { returned = _activePort !== _settings.port && fs.existsSync(_settings.port); } catch (_) {}
        if (!stalled && !returned && !_deviceChanged(fd)) return;

        _setError('порт ' + (_activePort || _settings.port) +
                  (stalled  ? ' перестал отвечать'
                   : returned ? ': вернулся штатный ' + _settings.port
                   : ' переподключился') + ' — открываю заново');
        // Закрываем сразу, не дожидаясь чтения: оно может не вернуться никогда,
        // а каждый такой зависший read занимает поток пула libuv.
        _fd = null; _open = false; _readingFd = null; _closePending = null;
        try { fs.closeSync(fd); } catch (_) {}
        _scheduleRetry(true);
    }, DEVICE_CHECK_MS);
    _watchdog.unref();
}

function _stopWatchdog() {
    if (_watchdog) { clearInterval(_watchdog); _watchdog = null; }
}

function _closeStream() {
    if (_fd !== null) {
        // Обнуляем раньше закрытия: незавершённое чтение вернётся с ошибкой и
        // не должно запустить ещё одно переоткрытие — иначе на порту окажутся
        // два читателя и кадры задвоятся.
        const fd = _fd;
        _fd = null;
        // Закрывать дескриптор, пока на нём висит чтение, нельзя: тот же номер
        // тут же выдадут следующему open(), и незавершённое чтение прочитает
        // чужой файл. Ждём возврата read() — он придёт в пределах VTIME.
        if (_readingFd === fd) _closePending = fd;
        else try { fs.closeSync(fd); } catch (_) {}
    }
    _open = false;
}

/// Закрыть дескриптор, закрытие которого отложили до конца чтения.
function _closeDeferred() {
    if (_closePending !== null) {
        try { fs.closeSync(_closePending); } catch (_) {}
        _closePending = null;
    }
}

function _openPort() {
    if (_stopped) return;
    const pick = _resolvePort();
    if (!pick.port) {
        _setError('порт ' + _settings.port + ' не найден — ожидание подключения' +
                  (pick.reason ? ' (' + pick.reason + ')' : ''));
        return _scheduleRetry();
    }
    const port = pick.port;
    if (pick.fallback && port !== _activePort)
        _log('RS-485: ' + _settings.port + ' не найден, открываю ' + port +
             (pick.vendor ? ' (USB ' + pick.vendor + ')' : ''));
    // raw-режим: 8N1, без управления потоком, без эха, не ждать несущей.
    // min 0 / time N — read() отдаёт то, что пришло, и не ждёт байт вечно.
    const args = ['-F', port, String(_settings.baud), 'raw', '-echo', '-echoe', '-echok',
                  'cs8', '-parenb', '-cstopb', '-crtscts', 'clocal', 'cread', '-hupcl',
                  'min', '0', 'time', String(READ_DECISECONDS)];
    execFile('stty', args, { timeout: 5000 }, function (err, stdout, stderr) {
        if (_stopped) return;
        if (err) {
            _setError('stty ' + port + ': ' + (stderr || err.message).trim());
            return _scheduleRetry();
        }
        _parser = new FrameParser(handleFrame, _onFrameError);
        try {
            _fd = fs.openSync(port, fs.constants.O_RDONLY | fs.constants.O_NOCTTY);
        } catch (e) {
            _setError('открытие ' + port + ': ' + e.message);
            return _scheduleRetry();
        }

        _open = true;
        _activePort = port;
        _lastErr = null;
        _lastErrLogged = '';
        _lastReadAt = mono.now();
        if (_stats.openedAt) _stats.reopens++;
        _stats.openedAt   = Date.now();
        _stats.openedMono = mono.now();
        _stats.framesSinceOpen = 0;
        _log('RS-485: порт ' + port + ' открыт, ' + _settings.baud + ' бод');
        _startWatchdog();
        _read(_fd, Buffer.alloc(READ_BUFFER));
    });
}

/// Цикл чтения порта. Пустой результат — обычное дело: read() вернулся по
/// таймеру, данных на линии пока нет.
function _read(fd, buf) {
    if (_stopped || _fd !== fd) return;
    _readingFd = fd;
    fs.read(fd, buf, 0, buf.length, null, function (err, bytes) {
        _readingFd = null;
        _closeDeferred();
        if (_stopped || _fd !== fd) return;
        if (err) {
            _setError('порт ' + _settings.port + ': ' + err.message);
            _closeStream();
            return _scheduleRetry();
        }
        _lastReadAt = mono.now();
        if (bytes > 0) {
            // Последняя страховка: разбор кадра не должен ронять сервер монитора
            try { _parser.push(buf.subarray(0, bytes)); }
            catch (e) { _onFrameError('parser', e && e.message ? e.message : String(e)); }
        }
        setImmediate(function () { _read(fd, buf); });
    });
}

// Сборщик длинных посылок из частей {"cfgSeq":…} (конфиг, справочники)
const _cfgAsm = new ConfigReassembler();

// ── Применение настроек, пришедших по линии ──────────────────────────────────
//
// Loader повторяет каждый кадр настройки: линия односторонняя, подтверждений
// нет. Отсев повторов общий с TCP/IP — server/applyGuard.js: табло одно, и
// повтор по сети после отправки по линии это тот же самый повтор.

const applyGuard = require('./applyGuard').shared;

function _dispatch(kind, data) {
    switch (kind) {
        case 'config': return ingest.ingestConfig(data);
        case 'net':    return ingestAdmin.ingestNetwork(data);
        case 'serial': return ingestAdmin.ingestSerial(data);
        case 'auth':   return ingestAdmin.ingestAuth(data);
        case 'upd':    return updatePackage.ingestUpdate(data);
        default:       return 'неизвестный раздел настройки: ' + kind;
    }
}

function _apply(kind, data) {
    if (applyGuard.isRepeat(kind, data)) return;   // повтор того же кадра

    // Исключение отсюда всплыло бы в обработчик 'data' потока и уронило процесс:
    // кадр с линии не должен иметь такой власти над табло.
    let err;
    try { err = _dispatch(kind, data); }
    catch (e) { err = 'сбой применения: ' + (e && e.message ? e.message : e); }

    if (err) {
        applyGuard.failed();
        _onFrameError(kind, err);
    } else {
        applyGuard.applied(kind, data);
    }
}

let _badLogged = 0;
function _onFrameError(code, detail) {
    _stats.framesBad++;
    // Не засорять логи: первые ошибки и затем каждая сотая
    if (_badLogged < 3 || _stats.framesBad % 100 === 0) {
        _badLogged++;
        _log('RS-485: битый кадр (' + code + (detail != null ? ': ' + detail : '') +
             '), всего ошибок ' + _stats.framesBad);
    }
}

// Разбор одного принятого кадра. Вынесено в экспорт: той же точкой пользуются
// проверки приёма без физической линии (кадры из файла вместо порта).
function handleFrame(obj) {
    _stats.framesOk++;
    _stats.framesSinceOpen++;
    _stats.lastFrameAt   = Date.now();
    _stats.lastFrameMono = mono.now();
    if (!obj || typeof obj !== 'object') return;

    if (obj.state && typeof obj.state === 'object') {
        ingest.ingestState(obj.state);
    } else if (obj.cfgSeq && typeof obj.cfgSeq === 'object') {
        // Часть длинной посылки — собираем и применяем, когда полна
        const done = _cfgAsm.push(obj.cfgSeq);
        if (done) _apply(done.kind, done.data);
    } else if (obj.config && typeof obj.config === 'object') {
        _apply('config', obj.config);   // конфигурация целиком в одном кадре
    } else if (obj.net && typeof obj.net === 'object') {
        _apply('net', obj.net);         // сетевые настройки устройства
    } else if (obj.serial && typeof obj.serial === 'object') {
        _apply('serial', obj.serial);   // настройки приёма по RS-485
    } else if (obj.auth && typeof obj.auth === 'object') {
        _apply('auth', obj.auth);       // пароль учётной записи монитора
    } else if (obj.upd && typeof obj.upd === 'object') {
        _apply('upd', obj.upd);         // пакет обновления программы
    } else if (obj.params) {
        let err;
        try { err = ingest.ingestRecord(obj); }
        catch (e) { err = 'сбой приёма записи: ' + (e && e.message ? e.message : e); }
        if (err) _onFrameError('format', err);
    }
}

// ── public API ───────────────────────────────────────────────────────────────

function start() {
    loadSettings();
    _stopped = false;
    if (process.platform !== 'linux') { _setError('приём по RS-485 доступен только на Linux'); return; }
    if (!_settings.enabled) { _setError('приём по RS-485 выключен в настройках'); return; }
    _openPort();
}

function stop() {
    _stopped = true;
    clearTimeout(_retry);
    _stopWatchdog();
    _closeStream();
}

function restart() {
    stop();
    _lastErr = null; _lastErrLogged = '';
    _stopped = false;
    if (process.platform !== 'linux') { _setError('приём по RS-485 доступен только на Linux'); return; }
    if (!_settings.enabled) { _setError('приём по RS-485 выключен в настройках'); return; }
    _openPort();
}

function listPorts() {
    let names = [];
    try {
        names = fs.readdirSync('/dev').filter(n => /^tty(CH343|ACM\d+|USB\d+)$/.test(n)).map(n => '/dev/' + n);
    } catch (_) {}
    names.sort((a, b) => (a.includes('CH343') ? -1 : b.includes('CH343') ? 1 : a.localeCompare(b)));
    return names;
}

function status() {
    return {
        enabled:     _settings.enabled,
        port:        _settings.port,
        baud:        _settings.baud,
        bauds:       BAUD_RATES,
        ports:       listPorts(),
        open:        _open,
        error:       _lastErr,
        framesOk:    _stats.framesOk,
        framesBad:   _stats.framesBad,
        lastFrameAt: _stats.lastFrameAt || null,
        // Для самодиагностики (server/selfCheck.js)
        activePort:  _activePort,
        openMs:      _open && _stats.openedMono ? Math.round(mono.now() - _stats.openedMono) : null,
        silenceMs:   _stats.lastFrameMono ? Math.round(mono.now() - _stats.lastFrameMono) : null,
        reopens:     _stats.reopens,
    };
}

module.exports = { start, stop, restart, status, getSettings, saveSettings, loadSettings,
                   handleFrame, choosePort, listPorts, BAUD_RATES };

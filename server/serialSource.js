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

let _settings = Object.assign({}, DEFAULTS);
let _stream   = null;
let _parser   = null;
let _retry    = null;
let _stopped  = true;
let _open     = false;
let _lastErr  = null;
let _lastErrLogged = '';
const _stats  = { framesOk: 0, framesBad: 0, lastFrameAt: 0, openedAt: 0 };

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

function _scheduleRetry() {
    if (_stopped) return;
    clearTimeout(_retry);
    _retry = setTimeout(_openPort, RETRY_MS);
}

function _closeStream() {
    if (_stream) {
        // Обработчики снимаем до destroy: иначе 'close' закрытого потока запустит
        // ещё одно переоткрытие и на порту окажутся два читателя (дубли кадров).
        const s = _stream;
        _stream = null;
        try { s.removeAllListeners(); s.destroy(); } catch (_) {}
    }
    _open = false;
}

function _openPort() {
    if (_stopped) return;
    const port = _settings.port;
    if (!fs.existsSync(port)) {
        _setError('порт ' + port + ' не найден — ожидание подключения');
        return _scheduleRetry();
    }
    // raw-режим: 8N1, без управления потоком, без эха, не ждать несущей
    const args = ['-F', port, String(_settings.baud), 'raw', '-echo', '-echoe', '-echok',
                  'cs8', '-parenb', '-cstopb', '-crtscts', 'clocal', 'cread', '-hupcl'];
    execFile('stty', args, { timeout: 5000 }, function (err, stdout, stderr) {
        if (_stopped) return;
        if (err) {
            _setError('stty ' + port + ': ' + (stderr || err.message).trim());
            return _scheduleRetry();
        }
        _parser = new FrameParser(handleFrame, _onFrameError);
        try {
            _stream = fs.createReadStream(port, { highWaterMark: 4096 });
        } catch (e) {
            _setError('открытие ' + port + ': ' + e.message);
            return _scheduleRetry();
        }
        _stream.on('open', function () {
            _open = true;
            _lastErr = null;
            _lastErrLogged = '';
            _stats.openedAt = Date.now();
            _log('RS-485: порт ' + port + ' открыт, ' + _settings.baud + ' бод');
        });
        // Последняя страховка: разбор кадра не должен ронять сервер монитора
        _stream.on('data', function (chunk) {
            try { _parser.push(chunk); }
            catch (e) { _onFrameError('parser', e && e.message ? e.message : String(e)); }
        });
        _stream.on('error', function (e) {
            _setError('порт ' + port + ': ' + e.message);
            _closeStream();
            _scheduleRetry();
        });
        _stream.on('close', function () {
            if (_open) { _open = false; _setError('порт ' + port + ' закрыт — переоткрытие'); }
            _stream = null;
            _scheduleRetry();
        });
    });
}

// Сборщик длинных посылок из частей {"cfgSeq":…} (конфиг, справочники)
const _cfgAsm = new ConfigReassembler();

// ── Применение настроек, пришедших по линии ──────────────────────────────────
//
// Loader повторяет каждый кадр настройки: линия односторонняя, подтверждений
// нет. Применять одно и то же по три раза незачем — сравниваем посылку с
// последней успешно применённой того же вида. После ошибки повтор принимается.

const APPLY_DEDUPE_MS = 10000;
let _lastApply = { kind: null, json: null, at: -Infinity };

function _dispatch(kind, data) {
    switch (kind) {
        case 'config': return ingest.ingestConfig(data);
        case 'refs':   return ingestAdmin.ingestRefs(data);
        case 'net':    return ingestAdmin.ingestNetwork(data);
        case 'serial': return ingestAdmin.ingestSerial(data);
        case 'auth':   return ingestAdmin.ingestAuth(data);
        case 'upd':    return updatePackage.ingestUpdate(data);
        default:       return 'неизвестный раздел настройки: ' + kind;
    }
}

function _apply(kind, data) {
    let json = null;
    try { json = JSON.stringify(data); } catch (_) {}

    // Окно отсева считаем монотонными часами: перевод системных (timeSync)
    // иначе либо пропустил бы повтор, либо держал отсев лишние минуты.
    if (json !== null && _lastApply.kind === kind && _lastApply.json === json &&
        (mono.now() - _lastApply.at) < APPLY_DEDUPE_MS) {
        return;   // повтор того же кадра
    }

    // Исключение отсюда всплыло бы в обработчик 'data' потока и уронило процесс:
    // кадр с линии не должен иметь такой власти над табло.
    let err;
    try { err = _dispatch(kind, data); }
    catch (e) { err = 'сбой применения: ' + (e && e.message ? e.message : e); }

    if (err) {
        _lastApply = { kind: null, json: null, at: -Infinity };
        _onFrameError(kind, err);
    } else {
        _lastApply = { kind: kind, json: json, at: mono.now() };
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
    _stats.lastFrameAt = Date.now();
    if (!obj || typeof obj !== 'object') return;

    if (obj.state && typeof obj.state === 'object') {
        ingest.ingestState(obj.state);
    } else if (obj.cfgSeq && typeof obj.cfgSeq === 'object') {
        // Часть длинной посылки — собираем и применяем, когда полна
        const done = _cfgAsm.push(obj.cfgSeq);
        if (done) _apply(done.kind, done.data);
    } else if (obj.config && typeof obj.config === 'object') {
        _apply('config', obj.config);   // конфигурация целиком в одном кадре
    } else if (obj.refs && typeof obj.refs === 'object') {
        _apply('refs', obj.refs);       // справочники параметров и единиц
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
    };
}

module.exports = { start, stop, restart, status, getSettings, saveSettings, loadSettings,
                   handleFrame, BAUD_RATES };

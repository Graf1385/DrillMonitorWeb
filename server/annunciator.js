'use strict';

// ── Внешний оповещатель и кнопка (Digispark на USB табла) ────────────────────
//
// Звук тревоги в соседнем помещении: плата по команде замыкает реле, а на
// том конце пищит оповещатель. Решает, звучать ли, сервер (server/alarm.js);
// этот модуль только доносит решение до платы и знает, отвечает ли она.
// На той же плате кнопка: короткое нажатие — следующий профиль, длинное
// (от 2 с) — квитировать тревоги. Что значит нажатие, решает тоже сервер.
//
// Плата — HID-устройство с вендорскими отчётами (прошивка и протокол —
// firmware/annunciator/annunciator.ino). Linux отдаёт её как /dev/hidraw*,
// и читаем мы её как файл: нативных модулей на табле не поставить (как и
// для RS-485 в serialSource.js). Чтение неблокирующее и по таймеру: чтение
// с блокировкой висит в пуле libuv и уже однажды не давало службе
// остановиться (см. serialSource.js).
//
// Доступ к /dev/hidraw* служба получает правилом udev (ставит install.sh).
//
// Интерфейс для alarm.js — available(), set(on), isOn() — не зависит от
// того, есть ли плата: нет её — available() ложно, и звук идёт динамиком.

const fs   = require('fs');
const path = require('path');
const mono = require('./monotonic');

const VENDOR_ID  = 0x16c0;
const PRODUCT_ID = 0x05df;
/// Пара 16c0:05df общая для V-USB HID — устройство узнаём ещё и по имени
const NAME_MARK  = 'Annunciator';

const SYS_HIDRAW   = '/sys/class/hidraw';
const SCAN_MS      = 3000;   // поиск платы, пока её нет
const READ_MS      = 100;    // опрос входных отчётов
const SEND_MS      = 500;    // выходной отчёт — всегда, это и сторож платы
const ALIVE_MS     = 1500;   // плата шлёт отчёт раз в 250 мс
const REPORT_LEN   = 8;

let _on        = false;
let _fd        = null;
let _node      = null;       // /dev/hidrawN
let _lastAt    = 0;          // монотонно: последний входной отчёт
let _seq       = 0;
let _short     = null;       // последние увиденные счётчики нажатий
let _long      = null;
let _lastError = null;
let _timers    = [];
let _started   = false;

function _log(msg) {
    try { require('./logger').log(msg); } catch (_) {}
    console.log('[annunciator] ' + msg);
}

// ── Действия по кнопке (в тестах подменяются) ────────────────────────────────

const _deps = {
    /// Следующий профиль по кругу — в том порядке, что и список профилей
    nextProfile: function () {
        const db = require('./db');
        const list = db.getProfiles();
        if (list.length < 2) return null;
        const i = list.findIndex(function (p) { return p.is_active; });
        const next = list[(i + 1) % list.length];
        const err = require('./ingest').selectProfile(next.name);
        if (err) throw new Error(err);
        return next.name;
    },
    ackAll: function () { return require('./alarm').ack(); },
    updating: function () {
        try { return require('./updateMode').isActive(); } catch (_) { return false; }
    },
    log: _log,
};

function _setDeps(partial) { Object.assign(_deps, partial); }

// ── Разбор входного отчёта ───────────────────────────────────────────────────

/// Сколько нажатий прибавилось: счётчик байтовый и ходит по кругу.
function _delta(prev, cur) {
    if (prev === null) return 0;
    const d = (cur - prev) & 0xff;
    // Больше полусотни за один отчёт не бывает — это сбой или чужое устройство
    return d > 50 ? 0 : d;
}

/**
 * Входной отчёт платы: [0] версия, [1] флаги, [2] короткие, [3] длинные.
 * Первый отчёт после подключения задаёт точку отсчёта: нажатия, накопленные
 * до нас, не исполняем — их некому было подтвердить.
 */
function _handleReport(buf) {
    if (!buf || buf.length < 4) return;
    _lastAt = mono.now();

    const s = buf[2], l = buf[3];
    const shortN = _delta(_short, s);
    const longN  = _delta(_long, l);
    _short = s;
    _long  = l;
    if (!shortN && !longN) return;

    if (_deps.updating()) {
        _deps.log('Кнопка на табле нажата во время обновления — не исполнено');
        return;
    }
    try {
        if (longN) {
            // Длинное важнее: глушат сирену, переключать профиль заодно незачем
            const any = _deps.ackAll();
            _deps.log('Кнопка на табле: ' + (any ? 'тревоги квитированы' : 'квитировать нечего'));
        } else {
            const name = _deps.nextProfile();
            _deps.log(name ? 'Кнопка на табле: профиль «' + name + '»'
                           : 'Кнопка на табле: других профилей нет');
        }
    } catch (e) {
        _deps.log('Кнопка на табле: не исполнено — ' + (e.message || e));
    }
}

/// Выходной отчёт: hidraw ждёт номер отчёта первым байтом (0 — без номеров).
function _outReport() {
    _seq = (_seq + 1) & 0xff;
    const b = Buffer.alloc(REPORT_LEN + 1);
    b[1] = _on ? 1 : 0;
    b[2] = _seq;
    b[3] = _short === null ? 0 : _short;   // эхо: плата мигнёт, что нажатие принято
    b[4] = _long  === null ? 0 : _long;
    return b;
}

// ── Устройство ───────────────────────────────────────────────────────────────

/// /dev/hidrawN платы или null. Ищем по VID:PID и имени в uevent.
function _find() {
    let names;
    try { names = fs.readdirSync(SYS_HIDRAW); } catch (_) { return null; }
    const id = ('0003:' + VENDOR_ID.toString(16).padStart(8, '0') + ':' +
                PRODUCT_ID.toString(16).padStart(8, '0')).toUpperCase();
    for (const n of names) {
        let uevent = '';
        try { uevent = fs.readFileSync(path.join(SYS_HIDRAW, n, 'device', 'uevent'), 'utf8'); }
        catch (_) { continue; }
        const hidId   = (uevent.match(/^HID_ID=(.*)$/m) || [])[1] || '';
        const hidName = (uevent.match(/^HID_NAME=(.*)$/m) || [])[1] || '';
        if (hidId.toUpperCase() === id && hidName.indexOf(NAME_MARK) !== -1) return '/dev/' + n;
    }
    return null;
}

function _close(why) {
    if (_fd !== null) { try { fs.closeSync(_fd); } catch (_) {} }
    if (_fd !== null && why) _log('Оповещатель отключён: ' + why);
    _fd = null; _node = null; _short = null; _long = null;
}

function _scan() {
    if (_fd !== null) return;
    const node = _find();
    if (!node) return;
    try {
        _fd = fs.openSync(node, fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
        _node = node;
        _lastError = null;
        _log('Оповещатель найден: ' + node);
    } catch (e) {
        // Чаще всего — нет правила udev: устройство есть, а прав нет
        const msg = e.code === 'EACCES' ? 'нет доступа к ' + node + ' (правило udev не установлено?)' : e.message;
        if (msg !== _lastError) _log('Оповещатель не открыт: ' + msg);
        _lastError = msg;
        _fd = null;
    }
}

function _read() {
    if (_fd === null) return;
    const buf = Buffer.alloc(64);
    for (let i = 0; i < 16; i++) {         // забрать всё накопленное, но не вечно
        let n;
        try { n = fs.readSync(_fd, buf, 0, buf.length, null); }
        catch (e) {
            if (e.code === 'EAGAIN' || e.code === 'EWOULDBLOCK') return;
            _close(e.code || e.message);
            return;
        }
        if (!n) return;
        _handleReport(buf.subarray(0, n));
    }
}

function _send() {
    if (_fd === null) return;
    try { fs.writeSync(_fd, _outReport()); }
    catch (e) {
        if (e.code === 'EAGAIN' || e.code === 'EWOULDBLOCK') return;
        _close(e.code || e.message);
    }
}

// ── Интерфейс для alarm.js ───────────────────────────────────────────────────

/// Отвечает ли плата: входной отчёт был только что.
function available() {
    return _fd !== null && _lastAt > 0 && mono.now() - _lastAt < ALIVE_MS;
}

/// Замкнуть или разомкнуть реле: уйдёт с ближайшим выходным отчётом.
function set(on) {
    const want = !!on;
    if (want !== _on) { _on = want; _send(); }
}

function isOn() { return _on; }

/// Для самодиагностики — без обращения к базе.
function status() {
    return {
        present:  _fd !== null,
        alive:    available(),
        node:     _node,
        relay:    _on,
        error:    _lastError,
        silentMs: _lastAt ? mono.now() - _lastAt : null,
    };
}

function start() {
    if (_started || process.platform !== 'linux') return;
    _started = true;
    _scan();
    _timers = [
        setInterval(_scan, SCAN_MS),
        setInterval(_read, READ_MS),
        setInterval(_send, SEND_MS),
    ];
    _timers.forEach(function (t) { t.unref(); });
}

function stop() {
    _timers.forEach(clearInterval);
    _timers = [];
    _started = false;
    // Разомкнуть реле перед уходом; не дойдёт — разомкнёт сторож платы
    _on = false;
    _send();
    _close(null);
}

/// Для проверок: забыть состояние.
function _reset() {
    _short = null; _long = null; _lastAt = 0; _on = false; _lastError = null;
}

module.exports = {
    available, set, isOn, status, start, stop,
    _handleReport, _delta, _outReport, _setDeps, _reset,
    VENDOR_ID, PRODUCT_ID,
};

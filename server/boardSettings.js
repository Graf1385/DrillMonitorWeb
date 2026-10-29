'use strict';

// ── Настройки самого табла ───────────────────────────────────────────────────
//
// То, что не зависит от показанного на экране и одинаково для всех профилей.
// Пока это часовой пояс. Сеть и приём по RS-485 хранятся своими путями (nmcli
// и server/data/serial-settings.json), но в обмене settings.get/save едут
// вместе с этим: для оператора это один документ «настройки табла».
//
// Пояс раньше лежал в профиле, и смена профиля переводила часы — хотя часы на
// буровой одни и те же, какой профиль ни покажи. При первом чтении переносим
// значение из активного профиля: табло на буровой никто не настраивает заново.

const fs   = require('fs');
const path = require('path');

// Путь можно подменить: проверки не должны писать в рабочий каталог табла
const FILE     = process.env.BOARD_SETTINGS_FILE ||
                 path.join(__dirname, 'data', 'board-settings.json');
const DEFAULTS = { timezone: '0' };

/// Часовой пояс — целое число часов от UTC. Шире ряд не нужен: табло стоит на
/// буровой, а не на Лайн-Айлендс.
const TZ_MIN = -12;
const TZ_MAX = 12;

let _cache = null;

function parseTimezone(v) {
    if (v === undefined || v === null) return null;
    const n = parseInt(String(v).trim(), 10);
    if (isNaN(n) || n < TZ_MIN || n > TZ_MAX) return null;
    return String(n);
}

function _fromFile() {
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
    catch (_) { return null; }
}

/// Прежнее значение из активного профиля — один раз, при первом чтении.
function _fromProfile() {
    try {
        const db = require('./db');
        const p  = db.getActiveProfile();
        return p ? parseTimezone(p.timezone) : null;
    } catch (_) { return null; }
}

function read() {
    if (_cache) return Object.assign({}, _cache);

    const stored = _fromFile();
    if (stored) {
        _cache = { timezone: parseTimezone(stored.timezone) || DEFAULTS.timezone };
        return Object.assign({}, _cache);
    }

    // Файла ещё нет: берём пояс из профиля и закрепляем его за табло
    const inherited = _fromProfile();
    _cache = { timezone: inherited || DEFAULTS.timezone };
    try { _write(_cache); } catch (_) { /* диск только для чтения — обойдёмся памятью */ }
    return Object.assign({}, _cache);
}

function _write(s) {
    fs.writeFileSync(FILE, JSON.stringify(s, null, 2));
}

/**
 * Изменить настройки. patch — только названные поля; остальные остаются.
 * Возвращает null при успехе или текст ошибки для оператора.
 */
function save(patch) {
    if (!patch || typeof patch !== 'object') return 'Неверный формат настроек табла';

    const next = read();
    if (patch.timezone !== undefined) {
        const tz = parseTimezone(patch.timezone);
        if (tz === null)
            return 'Часовой пояс должен быть целым числом от ' + TZ_MIN + ' до ' + TZ_MAX;
        next.timezone = tz;
    }

    try { _write(next); }
    catch (e) { return 'Настройки табла не сохранились: ' + (e.message || e); }

    _cache = next;
    return null;
}

/// Забыть прочитанное (проверки).
function reset() { _cache = null; }

module.exports = { read, save, reset, parseTimezone, FILE, TZ_MIN, TZ_MAX };

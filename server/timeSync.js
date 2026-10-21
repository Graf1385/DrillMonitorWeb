'use strict';

// ── Синхронизация системных часов с данными BCS_Loader ───────────────────────
//
// Сервер монитора бурильщика стоит в изолированной сети без NTP, а его RTC
// может не держать время. Единственный надёжный источник времени — поток
// данных BCS_Loader: поле `time` каждого push-пакета (время сбора данных, UTC).
//
// Защиты от ложных срабатываний:
//   • порог: расхождение меньше THRESHOLD_SEC игнорируется;
//   • подтверждение: нужны CONFIRMATIONS подряд идущих пакетов (в окне
//     SAMPLE_WINDOW_SEC) с одинаковым расхождением (разброс ≤ MAX_SPREAD_SEC) —
//     при проигрывании старого файла время записей идёт не в ногу с часами
//     и разброс растёт;
//   • не чаще одного раза в MIN_INTERVAL_SEC (по монотонным часам процесса,
//     чтобы прыжок системного времени не ломал интервал);
//   • эпоха должна быть в правдоподобном диапазоне, скрипт проверяет её ещё раз.
//
// Само изменение делает scripts/set-time.sh через sudo (NOPASSWD в
// /etc/sudoers.d/drillmonitor, ставится install.sh). На не-Linux и при
// TIME_SYNC=0 модуль ничего не делает.

const { execFile } = require('child_process');
const path         = require('path');

const ENABLED           = process.platform === 'linux' && process.env.TIME_SYNC !== '0';
const THRESHOLD_SEC     = Math.max(5, parseInt(process.env.TIME_SYNC_THRESHOLD || '30', 10) || 30);
const CONFIRMATIONS     = 3;
const SAMPLE_WINDOW_SEC = 120;
const MAX_SPREAD_SEC    = 10;
const MIN_INTERVAL_SEC  = 5 * 60;
const MIN_EPOCH         = 1700000000;   // 2023-11-14
const MAX_EPOCH         = 4102444800;   // 2100-01-01
const SCRIPT            = path.join(__dirname, '..', 'scripts', 'set-time.sh');

let _samples      = [];      // [{ drift, at }] — at по process.uptime()
let _lastApplied  = -Infinity;
let _lastFailLog  = -Infinity;

let _applier = function (epoch, cb) {
    execFile('sudo', ['-n', SCRIPT, String(epoch)], { timeout: 10000 }, function (err, stdout, stderr) {
        if (err) cb(new Error((stderr || err.message || '').trim()));
        else cb(null, (stdout || '').trim());
    });
};
// Логгер подключается лениво: он открывает БД и ставит таймеры, что в
// unit-тестах не нужно (там его подменяют через _setLogger).
let _logFn = null;

function _log(msg) {
    try {
        if (!_logFn) _logFn = require('./logger').log;
        _logFn(msg);
    } catch (e) { /* логгер недоступен */ }
    console.log('[timeSync] ' + msg);
}

function _fmt(epochSec) {
    return new Date(epochSec * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

// Вызывается на каждый push-пакет. epochSeconds — поле `time` записи.
// Возвращает true, если инициирована установка времени (для тестов).
function consider(epochSeconds, opts) {
    const enabled = opts && opts.force ? true : ENABLED;
    if (!enabled) return false;

    const t = Number(epochSeconds);
    if (!Number.isFinite(t) || t < MIN_EPOCH || t > MAX_EPOCH) return false;

    const nowMono = process.uptime();
    const drift   = t - Date.now() / 1000;

    if (Math.abs(drift) < THRESHOLD_SEC) { _samples = []; return false; }
    if (nowMono - _lastApplied < MIN_INTERVAL_SEC) return false;

    _samples = _samples.filter(s => nowMono - s.at <= SAMPLE_WINDOW_SEC);
    _samples.push({ drift, at: nowMono });
    if (_samples.length < CONFIRMATIONS) return false;

    const drifts = _samples.map(s => s.drift);
    const spread = Math.max(...drifts) - Math.min(...drifts);
    _samples = [];
    if (spread > MAX_SPREAD_SEC) return false;

    _lastApplied = nowMono;
    const before = Date.now() / 1000;
    const target = Math.round(t);
    _applier(target, function (err) {
        if (err) {
            if (nowMono - _lastFailLog > 60 * 60) {
                _lastFailLog = nowMono;
                _log('Не удалось синхронизировать время сервера с BCS_Loader: ' + err.message);
            }
            return;
        }
        const sign = drift >= 0 ? '+' : '−';
        _log('Время сервера синхронизировано с BCS_Loader: ' + _fmt(before) + ' → ' + _fmt(target) +
             ' (сдвиг ' + sign + Math.round(Math.abs(drift)) + ' с)');
    });
    return true;
}

// Для тестов: подмена исполнителя/логгера и сброс состояния.
function _setApplier(fn) { _applier = fn; }
function _setLogger(fn)  { _logFn = fn; }
function _reset() { _samples = []; _lastApplied = -Infinity; _lastFailLog = -Infinity; }

module.exports = {
    consider, _setApplier, _setLogger, _reset,
    ENABLED, THRESHOLD_SEC, CONFIRMATIONS, MAX_SPREAD_SEC, MIN_INTERVAL_SEC,
};

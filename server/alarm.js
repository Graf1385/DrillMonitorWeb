'use strict';

// ── Тревоги: решает табло ────────────────────────────────────────────────────
//
// Значения приходят от Loader раз в интервал отправки, пороги лежат в
// активном профиле здесь же. Состояние тревоги пересчитывается по каждой
// записи заново — поэтому никакого «конца тревоги» слать не нужно, и
// потерянный пакет лечится следующим. Loader тревог не решает: он их только
// показывает, читая историю обменом alarm.history.
//
// Раньше тревоги считал браузер киоска: история жила в памяти вкладки и
// стиралась перезагрузкой, а реле на USB сервера браузеру недоступно. Теперь
// экран рисует то, что прислали отсюда (SSE «alarm-state»), а квитирование
// приходит сюда же.
//
// Тревога привязана не к строке индикатора, а к ключу «параметр + пороги»:
// раскладка при каждом сохранении переписывается с новыми id, и тревога не
// должна обрываться и начинаться заново оттого, что поле сохранили. Два
// индикатора одного параметра с одинаковыми порогами — одна тревога.
//
// Данных нет: тревога держится HOLD_MS, затем звук и реле гаснут, индикатор
// остаётся в цвете тревоги, а состояние помечается «неизвестно». Сирена,
// которая воет без данных, — шум; молчащая без объяснения — ложь. Табло не
// утверждает того, чего не знает.
//
// Звук: всегда — свет (мигает индикатор). Затем по настройке профиля
// alarm_output — динамик киоска или внешний оповещатель (server/annunciator.js).
// Оповещатель не отвечает — звук тут же идёт через динамик, об этом запись в
// журнал и пометка на экране: молча подменять нельзя.

const db           = require('./db');
const sse          = require('./sse');
const dataSource   = require('./dataSource');
const annunciator  = require('./annunciator');
const mono         = require('./monotonic');

const HOLD_MS     = 10000;
const TICK_MS     = 1000;
const RECENT_MAX  = 200;

let _alarms   = new Map();   // key → состояние активной тревоги
let _recent   = [];          // события для индикатора «История сигнализаций», новые сверху
let _noDataSince = 0;        // монотонно: с какого момента нет данных (0 — данные идут)
let _stale    = false;       // тревоги «в неизвестности»: звук погашен
let _fallback = false;       // оповещатель выбран, но не отвечает
let _timer    = null;

function _log(msg) {
    try { require('./logger').log(msg); } catch (_) {}
}

function _num(v) { return (v === null || v === undefined || v === '') ? null : Number(v); }

/// Ключ тревоги — так же его строит киоск по data-атрибутам индикатора.
function keyOf(paramId, min, max) {
    return String(paramId) + '|' + (min === null ? '' : String(min)) + '|' + (max === null ? '' : String(max));
}

function _fmt(v) {
    return typeof v === 'number' && isFinite(v) ? String(Math.round(v * 100) / 100) : '—';
}

// ── Правила из активного профиля ──────────────────────────────────────────────

/// Пороги активного профиля по ключам. Читаем базу на каждую запись: это
/// раз в секунду и пара строк, зато смена профиля (в том числе кнопкой на
/// табле) действует с первой же записи.
function _rules() {
    const profile = db.getActiveProfile();
    const rules = new Map();
    if (!profile) return { profile: null, rules };
    db.getIndicatorsByProfile(profile.id).forEach(function (ind) {
        if (!ind.alarm_enabled || ind.param_id === null || ind.param_id === undefined) return;
        const min = _num(ind.alarm_min), max = _num(ind.alarm_max);
        if ((min === null || isNaN(min)) && (max === null || isNaN(max))) return;
        const key = keyOf(ind.param_id, min, max);
        if (rules.has(key)) return;
        rules.set(key, {
            key, paramId: ind.param_id,
            min: isNaN(min) ? null : min, max: isNaN(max) ? null : max,
            name: ind.header_text || ('параметр ' + ind.param_id),
            color: ind.alarm_color || '#ff0000',
        });
    });
    return { profile, rules };
}

// ── События и история ─────────────────────────────────────────────────────────

function _event(a, kind, value, at) {
    _recent.unshift({ ts: at, name: a.name, value: value, event: kind, color: a.color, key: a.key });
    if (_recent.length > RECENT_MAX) _recent.length = RECENT_MAX;
}

function _start(rule, value, profileName, at) {
    const a = Object.assign({}, rule, {
        value, extreme: value, since: at, acked: false, ackedAt: null, historyId: null,
    });
    try {
        a.historyId = db.alarmStart({
            profile: profileName || '', param_id: rule.paramId, name: rule.name,
            alarm_min: rule.min, alarm_max: rule.max, color: rule.color,
            started_at: at, start_value: value,
        });
        db.alarmTrim();
    } catch (e) { console.error('[alarm] history:', e.message); }
    _alarms.set(rule.key, a);
    _event(a, 'trigger', value, at);
    _log('[Сигнализация] ТРЕВОГА: ' + a.name + ' = ' + _fmt(value));
}

function _end(a, value, reason, at) {
    _alarms.delete(a.key);
    try { if (a.historyId) db.alarmEnd(a.historyId, at, value, reason); }
    catch (e) { console.error('[alarm] history:', e.message); }
    _event(a, 'clear', value, at);
    _log('[Сигнализация] СБРОС: ' + a.name + ' = ' + _fmt(value) + (reason !== 'норма' ? ' (' + reason + ')' : ''));
}

/// Насколько значение ушло за порог: в истории храним худшее.
function _worse(a, v) {
    if (a.max !== null && v > a.max) return a.extreme === null || v > a.extreme;
    if (a.min !== null && v < a.min) return a.extreme === null || v < a.extreme;
    return false;
}

// ── Приём записи ──────────────────────────────────────────────────────────────

/**
 * Пересчитать тревоги по записи. record.params — Map(номер → значение).
 * Значение null — параметр пропал: состояние тревоги не меняем (прочерк на
 * экране не повод ни поднимать, ни снимать тревогу). Параметра нет в
 * записи — тоже не меняем: табло держит прежнее число.
 */
function onRecord(record) {
    const at = new Date().toISOString();
    const r  = _rules();
    let changed = false;

    _noDataSince = 0;
    if (_stale) { _stale = false; changed = true; }

    // Тревоги, для которых в профиле больше нет порогов: сменили профиль или
    // поправили индикатор
    for (const a of Array.from(_alarms.values())) {
        if (!r.rules.has(a.key)) { _end(a, a.value, 'порог убран из профиля', at); changed = true; }
    }

    const params = record && record.params instanceof Map ? record.params : new Map();
    r.rules.forEach(function (rule) {
        if (!params.has(rule.paramId)) return;
        const v = params.get(rule.paramId);
        if (v === null || v === undefined || typeof v !== 'number' || !isFinite(v)) return;

        const out = (rule.min !== null && v < rule.min) || (rule.max !== null && v > rule.max);
        const a = _alarms.get(rule.key);
        if (out && !a) {
            _start(rule, v, r.profile && r.profile.name, at);
            changed = true;
        } else if (!out && a) {
            _end(a, v, 'норма', at);
            changed = true;
        } else if (a) {
            a.value = v;
            if (_worse(a, v)) {
                a.extreme = v;
                try { if (a.historyId) db.alarmExtreme(a.historyId, v); } catch (_) {}
            }
            // Имя и цвет могли поправить, не трогая порогов
            if (a.name !== rule.name || a.color !== rule.color) { a.name = rule.name; a.color = rule.color; changed = true; }
        }
    });

    if (_apply() || changed) _broadcast();
}

// ── Квитирование ─────────────────────────────────────────────────────────────

/// Квитировать тревогу по ключу или все сразу (key не задан). Звук по
/// квитированной тревоге молчит, свет остаётся, пока значение не вернётся.
function ack(key) {
    const at = new Date().toISOString();
    let any = false;
    _alarms.forEach(function (a) {
        if (a.acked || (key && a.key !== key)) return;
        a.acked = true;
        a.ackedAt = at;
        try { if (a.historyId) db.alarmAck(a.historyId, at); } catch (_) {}
        _event(a, 'ack', a.value, at);
        _log('[Сигнализация] КВИТИРОВАНИЕ: ' + a.name + ' = ' + _fmt(a.value));
        any = true;
    });
    if (any) { _apply(); _broadcast(); }
    return any;
}

// ── Звук и реле ──────────────────────────────────────────────────────────────

function _output() {
    try {
        const p = db.getActiveProfile();
        return p && p.alarm_output === 'annunciator' ? 'annunciator' : 'speaker';
    } catch (_) { return 'speaker'; }
}

/// Нужен ли звук прямо сейчас: есть неквитированная тревога и данные свежие.
function _soundWanted() {
    if (_stale) return false;
    for (const a of _alarms.values()) if (!a.acked) return true;
    return false;
}

/**
 * Решить, куда идёт звук, и довести решение до реле. Возвращает true, если
 * поменялось что-то, что видит экран.
 */
function _apply() {
    const wanted = _soundWanted();
    const output = _output();
    const relayOk = output === 'annunciator' && annunciator.available();
    const fallback = output === 'annunciator' && !relayOk;

    annunciator.set(wanted && relayOk);

    let changed = false;
    if (fallback !== _fallback) {
        _fallback = fallback;
        changed = true;
        _log(fallback
            ? 'Оповещатель не отвечает — звук тревоги идёт через динамик'
            : 'Оповещатель снова отвечает — звук тревоги идёт через него');
    }
    return changed;
}

// ── Нет данных ───────────────────────────────────────────────────────────────

function _tick() {
    const running = dataSource.getRunState().running;
    if (running) { _noDataSince = 0; }
    else if (!_noDataSince) { _noDataSince = mono.now(); }

    let changed = false;
    if (!running && !_stale && _alarms.size && mono.now() - _noDataSince >= HOLD_MS) {
        _stale = true;
        changed = true;
        _log('[Сигнализация] Нет данных от BCS_DrillerMonitorLoader — состояние тревоги неизвестно, звук выключен');
    }
    if (_apply() || changed) _broadcast();
}

// ── Состояние для экрана и Loader ────────────────────────────────────────────

function snapshot() {
    const output = _output();
    return {
        alarms: Array.from(_alarms.values()).map(function (a) {
            return { key: a.key, paramId: a.paramId, name: a.name, color: a.color,
                     value: a.value, since: a.since, acked: a.acked };
        }),
        stale:  _stale,
        // Звучит ли динамик киоска: выбран он сам, или оповещатель не отвечает
        speaker:  _soundWanted() && (output === 'speaker' || _fallback),
        output:   output,
        fallback: _fallback,
        recent:   _recent,
    };
}

function _broadcast() {
    sse.broadcast('alarm-state', snapshot());
}

/// История для Loader: последние тревоги, новые сверху.
function history(limit) {
    return db.alarmRecent(limit).map(function (r) {
        return {
            id: r.id, profile: r.profile, paramId: r.param_id, name: r.name,
            min: r.alarm_min, max: r.alarm_max,
            startedAt: r.started_at, startValue: r.start_value, extreme: r.extreme_value,
            ackedAt: r.acked_at, endedAt: r.ended_at, endValue: r.end_value, endReason: r.end_reason,
            active: !r.ended_at,
        };
    });
}

// ── Запуск ───────────────────────────────────────────────────────────────────

/// События прошлых запусков — индикатору истории на экране, чтобы он не
/// начинал каждый раз с чистого листа.
function _seedRecent() {
    const rows = db.alarmRecent(RECENT_MAX);
    const out = [];
    rows.forEach(function (r) {
        const a = { name: r.name, color: r.color, key: keyOf(r.param_id, r.alarm_min, r.alarm_max) };
        if (r.ended_at) out.push({ ts: r.ended_at, name: a.name, value: r.end_value, event: 'clear', color: a.color, key: a.key });
        if (r.acked_at) out.push({ ts: r.acked_at, name: a.name, value: r.extreme_value, event: 'ack', color: a.color, key: a.key });
        out.push({ ts: r.started_at, name: a.name, value: r.start_value, event: 'trigger', color: a.color, key: a.key });
    });
    out.sort(function (x, y) { return x.ts < y.ts ? 1 : x.ts > y.ts ? -1 : 0; });
    _recent = out.slice(0, RECENT_MAX);
}

function start() {
    if (_timer) return;
    // Состояние в памяти не пережило перезапуск: незакрытые строки закрываем
    // честно, а тревога, если она ещё есть, поднимется с первой же записью
    try { db.alarmCloseOpen(new Date().toISOString(), 'перезапуск табла'); } catch (_) {}
    try { _seedRecent(); } catch (_) {}
    _timer = setInterval(_tick, TICK_MS);
    _timer.unref();
}

function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
    annunciator.set(false);
}

/// Для проверок: забыть всё состояние.
function _reset() {
    _alarms = new Map(); _recent = []; _noDataSince = 0; _stale = false; _fallback = false;
}

module.exports = { start, stop, onRecord, ack, snapshot, history, keyOf, HOLD_MS, _reset, _tick };

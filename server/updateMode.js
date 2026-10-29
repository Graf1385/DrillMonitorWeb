'use strict';

// ── Режим обновления ─────────────────────────────────────────────────────────
//
// Пакет новой версии везёт Loader, и по линии RS-485 это минуты: 5,6 КБ/с на
// несколько мегабайт. Всё это время бурильщик смотрел на замершие показания и
// «нет данных» — выглядело как обрыв связи, хотя шла работа. Теперь табло
// заранее знает, что обновляется: экран закрывается заставкой с ходом приёма,
// и показания на ней не мигают.
//
// Начало объявляет Loader обменом update.begin — до того, как пошёл сам пакет.
// Конец объявлять некому: удачное обновление перезагружает устройство, а на
// неудачу есть сторож. Если приём замер дольше STALL_MS, заставка снимается
// сама и в журнале остаётся запись: табло не должно остаться закрытым навсегда
// из-за оборванной передачи — до него на буровой не дотянуться.

const sse    = require('./sse');
const logger = require('./logger');
const mono   = require('./monotonic');

/// Тишина дольше этого — передача сорвалась.
const STALL_MS = 5 * 60 * 1000;
const CHECK_MS = 10 * 1000;
/// Чаще этого о ходе приёма не рассказываем: по линии части идут по три в секунду.
const BROADCAST_MS = 500;

let _state = _idle();
let _lastAt = 0;
let _sentAt = 0;
let _timer  = null;

function _idle() {
    return { active: false, name: null, version: null, size: 0, received: 0,
             percent: 0, channel: null, phase: null };
}

function _log(msg) { try { logger.log(msg); } catch (_) {} }

function _broadcast(force) {
    const now = mono.now();
    if (!force && (now - _sentAt) < BROADCAST_MS) return;
    _sentAt = now;
    try { sse.broadcast('update-state', state()); } catch (_) {}
}

function _startWatch() {
    if (_timer) return;
    _timer = setInterval(function () {
        if (!_state.active) return;
        if (mono.now() - _lastAt < STALL_MS) return;
        fail('приём пакета замер дольше ' + Math.round(STALL_MS / 60000) + ' мин');
    }, CHECK_MS);
    if (_timer.unref) _timer.unref();
}

function _stopWatch() {
    if (_timer) { clearInterval(_timer); _timer = null; }
}

/**
 * Начать обновление. meta: { name, version, size, channel }.
 * Повторный вызов с теми же данными — не ошибка: Loader мог не получить ответ
 * и повторить обмен.
 */
function begin(meta) {
    const m = meta || {};
    const size = parseInt(m.size, 10);

    _state = {
        active:   true,
        name:     m.name    ? String(m.name)    : null,
        version:  m.version ? String(m.version) : null,
        size:     isNaN(size) || size < 0 ? 0 : size,
        received: 0,
        percent:  0,
        channel:  m.channel ? String(m.channel) : null,
        phase:    'receiving',
    };
    _lastAt = mono.now();
    _startWatch();

    _log('Обновление' + (_state.version ? ' до ' + _state.version : '') +
         ' начато' + (_state.channel ? ' по ' + _state.channel : '') +
         (_state.size ? ' (' + Math.round(_state.size / 1024) + ' КБ)' : '') +
         ' — экран закрыт заставкой');
    _broadcast(true);
    return null;
}

/// Сколько принято. total можно не знать — тогда остаётся объявленный размер.
function progress(received, total) {
    if (!_state.active) return;
    const r = parseInt(received, 10);
    const t = parseInt(total, 10);

    if (!isNaN(t) && t > 0) _state.size = t;
    if (!isNaN(r) && r >= 0) _state.received = r;
    _state.percent = _state.size > 0
        ? Math.min(100, Math.round(_state.received * 100 / _state.size))
        : 0;

    _lastAt = mono.now();
    _broadcast(false);
}

/// Приём кончился, пошла распаковка: прогресс тут уже не измерить.
function unpacking() {
    if (!_state.active) return;
    _state.phase   = 'unpacking';
    _state.percent = 100;
    _lastAt = mono.now();
    _broadcast(true);
}

/// Обновление не состоялось — снять заставку и сказать почему.
function fail(reason) {
    if (!_state.active) return;
    _log('Обновление не состоялось: ' + reason + ' — заставка снята');
    _state = _idle();
    _stopWatch();
    _broadcast(true);
}

function isActive() { return _state.active; }

function state() { return Object.assign({}, _state); }

/// Забыть состояние (проверки).
function reset() { _state = _idle(); _stopWatch(); }

module.exports = { begin, progress, unpacking, fail, isActive, state, reset, STALL_MS };

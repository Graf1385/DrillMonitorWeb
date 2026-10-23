'use strict';

// ── Push mode (BCS_Loader → HTTP или RS-485 → DrillMonitorWeb) ───────────────
//
// Тишину в потоке меряем монотонными часами (server/monotonic.js): системные
// подводит timeSync по данным того же Loader, и прыжок часов не должен
// выглядеть как обрыв связи.

const mono = require('./monotonic');

/// Нижняя граница тишины, после которой поток считается оборванным.
const STALE_TIMEOUT = 5000;
/// Запас к наблюдаемому интервалу: один потерянный пакет — ещё не обрыв.
const STALE_FACTOR  = 2.5;
/// Выше этого наблюдаемый интервал не поднимаем — иначе обрыв заметим нескоро.
/// Loader шлёт не реже 4 с (AppSettings.MaxDelay), так что это с запасом.
const MAX_INTERVAL  = 4500;

let _pushMode        = false;
let _pushLastMono    = 0;
let _pushInterval    = 0;      // наблюдаемый интервал между записями, мс
let _pushDataStale   = false;
let _pushStaleReason = null;
let _pushStaleTimer  = null;
let _onRecord        = null;
let _onStale         = null;
let _onResume        = null;

/// Сколько тишины считать обрывом: Loader шлёт с интервалом 250…4000 мс,
/// и при 4 с один пропущенный пакет не должен гасить табло.
function staleAfterFor(intervalMs) {
    return Math.max(STALE_TIMEOUT, (intervalMs || 0) * STALE_FACTOR);
}

function staleAfter() { return staleAfterFor(_pushInterval); }

function startPushMode(onRecord, { onStale, onResume } = {}) {
    if (_pushMode) return;
    _pushMode        = true;
    _pushLastMono    = mono.now();
    _pushInterval    = 0;
    _pushDataStale   = false;
    _pushStaleReason = null;
    _onRecord        = onRecord || null;
    _onStale         = onStale  || null;
    _onResume        = onResume || null;

    _pushStaleTimer = setInterval(function () {
        if (!_pushMode || _pushDataStale) return;
        if (mono.now() - _pushLastMono > staleAfter()) {
            _pushDataStale   = true;
            _pushStaleReason = 'network';
            if (_onStale) _onStale('network');
        }
    }, 1000);
}

function stopPushMode() {
    _pushMode        = false;
    _pushDataStale   = false;
    _pushStaleReason = null;
    _pushLastMono    = 0;
    _pushInterval    = 0;
    if (_pushStaleTimer) { clearInterval(_pushStaleTimer); _pushStaleTimer = null; }
    _onRecord = _onStale = _onResume = null;
}

function receivePushRecord(record) {
    if (!_pushMode) return;

    const t = mono.now();
    if (_pushLastMono > 0) {
        // Сглаживаем: одиночный провал не должен раздувать порог
        const gap = t - _pushLastMono;
        _pushInterval = _pushInterval > 0 ? _pushInterval * 0.7 + gap * 0.3 : gap;
        if (_pushInterval > MAX_INTERVAL) _pushInterval = MAX_INTERVAL;
    }
    _pushLastMono = t;

    if (_pushDataStale) {
        _pushDataStale   = false;
        _pushStaleReason = null;
        if (_onResume) _onResume();
    }
    if (_onRecord) _onRecord(record);
}

function isPushMode() { return _pushMode; }

function getRunState() {
    if (_pushMode) {
        if (_pushDataStale) return { running: false, reason: _pushStaleReason };
        return { running: true };
    }
    return { running: false, reason: null };
}

module.exports = {
    startPushMode, stopPushMode, receivePushRecord, isPushMode, getRunState,
    staleAfter, staleAfterFor, STALE_TIMEOUT,
};

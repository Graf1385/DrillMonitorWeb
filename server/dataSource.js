'use strict';

// ── Push mode (BCS_Loader → HTTP → DrillMonitorWeb) ──────────────────────────

const STALE_TIMEOUT = 5000;

let _pushMode        = false;
let _pushLastTime    = 0;
let _pushDataStale   = false;
let _pushStaleReason = null;
let _pushStaleTimer  = null;
let _onRecord        = null;
let _onStale         = null;
let _onResume        = null;

function startPushMode(onRecord, { onStale, onResume } = {}) {
    if (_pushMode) return;
    _pushMode        = true;
    _pushLastTime    = Date.now();
    _pushDataStale   = false;
    _pushStaleReason = null;
    _onRecord        = onRecord || null;
    _onStale         = onStale  || null;
    _onResume        = onResume || null;

    _pushStaleTimer = setInterval(function () {
        if (!_pushMode || _pushDataStale) return;
        if (Date.now() - _pushLastTime > STALE_TIMEOUT) {
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
    _pushLastTime    = 0;
    if (_pushStaleTimer) { clearInterval(_pushStaleTimer); _pushStaleTimer = null; }
    _onRecord = _onStale = _onResume = null;
}

function receivePushRecord(record) {
    if (!_pushMode) return;
    _pushLastTime = Date.now();
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
};

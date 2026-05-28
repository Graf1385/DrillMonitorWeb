'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const SETTINGS_FILE = path.join(__dirname, 'data', 'data-source-settings.json');
const STALE_TIMEOUT = 5000;

function _load() {
    try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch (_) { return {}; }
}

function _save(data) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Returns the API key, auto-generating one on first run.
function getApiKey() {
    const data = _load();
    if (!data.apiKey) {
        data.apiKey = crypto.randomBytes(32).toString('hex');
        _save(data);
    }
    return data.apiKey;
}

// ── Push mode (BCS_Loader → HTTP → DrillMonitorWeb) ──────────────────────────

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

// Returns current run state for newly connected SSE clients.
function getRunState() {
    if (_pushMode) {
        if (_pushDataStale) return { running: false, reason: _pushStaleReason };
        return { running: true };
    }
    return { running: false, reason: null };
}

module.exports = {
    getApiKey,
    startPushMode, stopPushMode, receivePushRecord, isPushMode, getRunState,
};

'use strict';

const fs   = require('fs');
const fsp  = require('fs').promises;
const path = require('path');
const net  = require('net');
const db   = require('./db/connection');

const SETTINGS_FILE = path.join(__dirname, 'data', 'data-source-settings.json');
const DEFAULTS      = { storePath: '', running: false };
const POLL_INTERVAL  = 1000;  // ms between polls
const IO_TIMEOUT     = 8000;  // ms — max wait for any single network I/O op
const STALE_TIMEOUT  = 5000;  // ms without a record before declaring data lost

function _load() {
    try {
        return Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')));
    } catch (_) {
        return Object.assign({}, DEFAULTS);
    }
}

function getSettings() {
    return _load();
}

function saveSettings(body) {
    const current = _load();
    const updated = Object.assign(current, { storePath: String(body.storePath || '') });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf8');
    return updated;
}

function setRunning(state) {
    const current = _load();
    const updated = Object.assign(current, { running: !!state });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf8');
    return updated;
}

function getEffectivePath() {
    const base = _load().storePath.trim();
    if (!base) return null;
    return path.join(base, 'Database', 'Online', 'Store');
}

function checkPath(storePath) {
    const base = String(storePath || '').trim();
    if (!base) return { ok: false, message: 'Путь не указан' };
    const full = path.join(base, 'Database', 'Online', 'Store');
    try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) return { ok: true,  message: 'Папка найдена: ' + full };
        return { ok: false, message: 'Путь указывает на файл, а не на папку: ' + full };
    } catch (_) {
        return { ok: false, message: 'Папка не найдена: ' + full };
    }
}

// ── Poller ────────────────────────────────────────────────────────────────────

const LST_RECORD_SIZE = 21;

let _paramSize     = null;       // Uint8Array[256]: index = param id, value = byte size
let _paramIsLong   = null;       // Uint8Array[256]: 1 if type_id=5 (long/int32), else float
let _watchedParams = new Set();  // param ids currently on screen (active profile)
let _polling        = false;
let _lastAddr       = -1;
let _lastLstSize    = -1;         // skip read when .lst size unchanged
let _lastLstPath    = null;       // reset _lastLstSize on file rotation
let _lastRecordTime  = 0;          // ms timestamp of last successful record
let _pollingStartTime = 0;         // ms timestamp when polling started
let _dataStale      = false;      // true after STALE_TIMEOUT without a record
let _onRecord       = null;
let _onStale        = null;       // called when data goes silent
let _onResume       = null;       // called when data resumes after stale
let _staleTimer     = null;       // setInterval handle for stale detection
let _lastStaleReason = null;      // last detected stale reason, for reconnecting SSE clients
let _cachedLstPath  = null;       // avoid readdirSync on every tick over the network

function _loadParamSizes() {
    _paramSize   = new Uint8Array(256);
    _paramIsLong = new Uint8Array(256);
    db.prepare('SELECT id, size, type_id FROM parameters').all()
      .forEach(p => {
          if (p.id >= 0 && p.id <= 255) {
              _paramSize[p.id]   = p.size;
              _paramIsLong[p.id] = (p.type_id === 5 || p.type_id === 1) ? 1 : 0;  // 5=long, 1=time (both int32)
          }
      });
}

function refreshWatchedParams() {
    const rows = db.prepare(`
        SELECT DISTINCT i.param_id
        FROM indicators i
        INNER JOIN profiles pr ON pr.id = i.profile_id AND pr.is_active = 1
        WHERE i.param_id IS NOT NULL
    `).all();
    _watchedParams = new Set(rows.map(r => r.param_id));
}

// Wraps a promise with a hard deadline. If the promise hangs (e.g. network share
// becomes unresponsive), the rejection fires after `ms` ms so the poll loop can
// continue without blocking the event loop.
function _withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('IO_TIMEOUT')), ms);
        promise.then(
            v => { clearTimeout(timer); resolve(v); },
            e => { clearTimeout(timer); reject(e); }
        );
    });
}

// Extracts hostname from a UNC path: \\server\share → 'server'
function _extractUncHost(p) {
    const m = String(p || '').match(/^[\\\/]{2}([^\\\/\s]+)/);
    return m ? m[1] : null;
}

// TCP connect to port 445 (SMB): resolves true if host is reachable
function _checkHostReachable(host, timeoutMs) {
    return new Promise(function (resolve) {
        var socket = new net.Socket();
        var settled = false;
        function done(ok) {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(ok);
        }
        socket.setTimeout(timeoutMs);
        socket.on('connect', function () { done(true); });
        socket.on('error',   function () { done(false); });
        socket.on('timeout', function () { done(false); });
        socket.connect(445, host);
    });
}

// Determine why data went stale: 'network' | 'folder' | null
// Called only once when stale is first detected.
async function _detectStaleReason() {
    const storeDir = getEffectivePath();
    if (!storeDir) return null;

    // Directly probe the store directory right now.
    // readdir (not stat) is used because Windows can answer stat from OS metadata
    // cache even when the SMB share is already broken, causing a false "accessible" result.
    try {
        await _withTimeout(fsp.readdir(storeDir), 2000);
        return null;  // directory is accessible → data just paused (drilling stopped)
    } catch (_) {
        // Directory inaccessible — distinguish network vs folder
        const host = _extractUncHost(getSettings().storePath);
        if (!host) return 'folder';  // local path, folder issue
        const reachable = await _checkHostReachable(host, 1500);
        return reachable ? 'folder' : 'network';
    }
}

async function _findLatestLst(storeDir) {
    let files;
    try {
        files = await _withTimeout(fsp.readdir(storeDir), IO_TIMEOUT);
    } catch (e) {
        if (e.message === 'IO_TIMEOUT') {
            console.warn('[dataSource] Таймаут чтения каталога:', storeDir);
            return _cachedLstPath;  // use last known path during network hiccup
        }
        return null;
    }

    const matches = files
        .filter(f => /^Shrt_\d+\.lst$/i.test(f))
        .sort((a, b) => {
            // numeric sort so Shrt_10.lst > Shrt_9.lst
            const na = parseInt(a.match(/\d+/)[0], 10);
            const nb = parseInt(b.match(/\d+/)[0], 10);
            return na - nb;
        });

    _cachedLstPath = matches.length ? path.join(storeDir, matches[matches.length - 1]) : null;
    return _cachedLstPath;
}

async function _readLastLstRecord(lstPath, size) {
    if (size < LST_RECORD_SIZE) return null;
    let fd;
    try {
        fd = await _withTimeout(fsp.open(lstPath, 'r'), IO_TIMEOUT);
        const buf = Buffer.alloc(LST_RECORD_SIZE);
        await fd.read(buf, 0, LST_RECORD_SIZE, size - LST_RECORD_SIZE);
        return {
            addr:  buf.readInt32LE(0),
            depth: buf.readFloatLE(4),
            time:  buf.readInt32LE(8),
        };
    } catch (e) {
        if (e.message === 'IO_TIMEOUT') console.warn('[dataSource] Таймаут чтения LST:', lstPath);
        return null;
    } finally {
        if (fd) try { await fd.close(); } catch (_) {}
    }
}

function _parseValue(buf, offset, size, isLong) {
    switch (size) {
        case 4:  return isLong ? buf.readInt32LE(offset) : buf.readFloatLE(offset);
        case 2:  return buf.readInt16LE(offset);
        case 1:  return buf.readUInt8(offset);
        default: return buf.toString('latin1', offset, offset + size).replace(/\0+$/, '').trim();
    }
}

async function _readDepRecord(depPath, addr) {
    let fd;
    try {
        fd = await _withTimeout(fsp.open(depPath, 'r'), IO_TIMEOUT);

        const header = Buffer.alloc(10);
        await fd.read(header, 0, 10, addr);
        const recNo      = header.readInt32LE(0);
        const recSize    = header.readUInt16LE(6);  // unsigned: valid range 0–65535
        const paramCount = header[9];

        if (recSize < 10) return null;  // guard against corrupt header
        const body = Buffer.alloc(recSize - 10);
        if (body.length > 0) await fd.read(body, 0, body.length, addr + 10);

        const params = new Map();
        let pos = 0;
        for (let i = 0; i < paramCount && pos < body.length; i++) {
            if (pos + 2 > body.length) break;
            const id     = body[pos + 1];  // body[pos] = ref (skip)
            pos += 2;
            const size   = _paramSize[id] || 4;
            const isLong = _paramIsLong ? _paramIsLong[id] === 1 : false;
            if (pos + size > body.length) break;
            params.set(id, _parseValue(body, pos, size, isLong));
            pos += size;
        }

        return { recNo, params };
    } catch (e) {
        if (e.message === 'IO_TIMEOUT') console.warn('[dataSource] Таймаут чтения DEP:', depPath);
        return null;
    } finally {
        if (fd) try { await fd.close(); } catch (_) {}
    }
}

async function _poll() {
    const storeDir = getEffectivePath();
    if (!storeDir) return;

    const lstPath = await _findLatestLst(storeDir);
    if (!lstPath) return;

    // Reset size cache on file rotation (Shrt_1.lst → Shrt_2.lst)
    if (lstPath !== _lastLstPath) {
        _lastLstPath = lstPath;
        _lastLstSize = -1;
    }

    // Cheap stat: skip everything if file size hasn't grown
    let lstSize;
    try {
        lstSize = (await _withTimeout(fsp.stat(lstPath), IO_TIMEOUT)).size;
    } catch (e) {
        if (e.message === 'IO_TIMEOUT') console.warn('[dataSource] Таймаут stat LST:', lstPath);
        return;
    }
    if (lstSize === _lastLstSize) return;

    const lst = await _readLastLstRecord(lstPath, lstSize);
    if (!lst) return;  // read failed — don't update size, retry next tick

    _lastLstSize = lstSize;

    if (lst.addr === _lastAddr) return;
    _lastAddr = lst.addr;

    const depPath = lstPath.replace(/\.lst$/i, '.dep');
    const record  = await _readDepRecord(depPath, lst.addr);
    if (!record) return;

    const filtered = new Map();
    for (const [id, val] of record.params) {
        if (!_watchedParams.has(id)) continue;
        if (typeof val === 'string' && val === '') continue;
        filtered.set(id, val);
    }

    _lastRecordTime = Date.now();
    if (_dataStale) {
        _dataStale = false;
        _lastStaleReason = null;
        if (_onResume) _onResume();
    }

    _onRecord({ recNo: record.recNo, depth: lst.depth, time: lst.time, params: filtered });
}

// Self-scheduling loop: next poll starts after the previous one finishes,
// so a slow network operation can never cause overlapping polls.
async function _runLoop() {
    while (_polling) {
        const start = Date.now();
        try {
            await _poll();
        } catch (e) {
            console.error('[dataSource] Ошибка опроса:', e.message);
        }

        const elapsed = Date.now() - start;
        const wait    = Math.max(0, POLL_INTERVAL - elapsed);
        await new Promise(r => setTimeout(r, wait));
    }
}

function startPolling(onRecord, { onStale, onResume } = {}) {
    if (_polling) return;
    _loadParamSizes();
    refreshWatchedParams();
    _onRecord       = onRecord;
    _onStale        = onStale  || null;
    _onResume       = onResume || null;
    _lastAddr        = -1;
    _lastLstSize     = -1;
    _lastLstPath     = null;
    _lastRecordTime   = 0;
    _pollingStartTime = Date.now();
    _dataStale        = false;
    _lastStaleReason  = null;
    _polling          = true;

    // Independent stale timer: fires every second regardless of I/O hangs in _poll
    _staleTimer = setInterval(async function () {
        if (_dataStale) return;
        const now      = Date.now();
        const baseline = _lastRecordTime > 0 ? _lastRecordTime : _pollingStartTime;
        if (now - baseline > STALE_TIMEOUT) {
            _dataStale = true;
            const reason = await _detectStaleReason();
            _lastStaleReason = reason;
            if (_onStale) _onStale(reason);
        }
    }, 1000);

    _runLoop().catch(e => console.error('[dataSource] Фатальная ошибка цикла:', e));
}

function stopPolling() {
    _polling        = false;
    if (_staleTimer) { clearInterval(_staleTimer); _staleTimer = null; }
    _onRecord       = null;
    _onStale        = null;
    _onResume       = null;
    _lastAddr        = -1;
    _lastLstSize     = -1;
    _lastLstPath     = null;
    _lastRecordTime   = 0;
    _pollingStartTime = 0;
    _dataStale        = false;
    _lastStaleReason  = null;
    _cachedLstPath    = null;
}

// Returns the current run state for newly connected SSE clients.
function getRunState() {
    if (!_polling)   return { running: false, reason: null };
    if (_dataStale)  return { running: false, reason: _lastStaleReason };
    return { running: true };
}

module.exports = { getSettings, saveSettings, checkPath, setRunning, getEffectivePath, startPolling, stopPolling, refreshWatchedParams, getRunState };

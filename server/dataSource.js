'use strict';

const fs   = require('fs');
const fsp  = require('fs').promises;
const path = require('path');
const db   = require('./db/connection');

const SETTINGS_FILE = path.join(__dirname, 'data', 'data-source-settings.json');
const DEFAULTS      = { storePath: '', running: false };
const POLL_INTERVAL = 1000;  // ms between polls
const IO_TIMEOUT    = 8000;  // ms — max wait for any single network I/O op

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
let _polling       = false;
let _lastAddr      = -1;
let _onRecord      = null;
let _cachedLstPath = null;       // avoid readdirSync on every tick over the network

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

async function _readLastLstRecord(lstPath) {
    let fd;
    try {
        fd = await _withTimeout(fsp.open(lstPath, 'r'), IO_TIMEOUT);
        const { size } = await fd.stat();
        if (size < LST_RECORD_SIZE) return null;
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

    const lst = await _readLastLstRecord(lstPath);
    if (!lst || lst.addr === _lastAddr) return;

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

function startPolling(onRecord) {
    if (_polling) return;
    _loadParamSizes();
    refreshWatchedParams();
    _onRecord  = onRecord;
    _lastAddr  = -1;
    _polling   = true;
    _runLoop().catch(e => console.error('[dataSource] Фатальная ошибка цикла:', e));
}

function stopPolling() {
    _polling       = false;
    _onRecord      = null;
    _lastAddr      = -1;
    _cachedLstPath = null;
}

module.exports = { getSettings, saveSettings, checkPath, setRunning, getEffectivePath, startPolling, stopPolling, refreshWatchedParams };

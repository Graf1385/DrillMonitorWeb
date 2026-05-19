'use strict';

const fs   = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, 'data', 'data-source-settings.json');
const DEFAULTS      = { storePath: '', running: false };

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

let _paramSize = null;   // Uint8Array[255]: index = param id, value = byte size
let _pollTimer = null;
let _lastAddr  = -1;
let _onRecord  = null;

function _loadParamSizes(db) {
    _paramSize = new Uint8Array(255);
    db.prepare('SELECT id, size FROM parameters').all()
      .forEach(p => { _paramSize[p.id] = p.size; });
}

function _findLatestLst(storeDir) {
    let files;
    try { files = fs.readdirSync(storeDir); } catch (_) { return null; }
    const matches = files
        .filter(f => /^Shrt_\d+\.lst$/i.test(f))
        .sort();
    return matches.length ? path.join(storeDir, matches[matches.length - 1]) : null;
}

function _readLastLstRecord(lstPath) {
    let fd;
    try {
        fd = fs.openSync(lstPath, 'r');
        const { size } = fs.fstatSync(fd);
        if (size < LST_RECORD_SIZE) return null;
        const buf = Buffer.alloc(LST_RECORD_SIZE);
        fs.readSync(fd, buf, 0, LST_RECORD_SIZE, size - LST_RECORD_SIZE);
        return {
            addr:  buf.readInt32LE(0),
            depth: buf.readFloatLE(4),
            time:  buf.readInt32LE(8),
        };
    } catch (_) {
        return null;
    } finally {
        if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
    }
}

function _parseValue(buf, offset, size) {
    switch (size) {
        case 4:  return buf.readFloatLE(offset);
        case 2:  return buf.readInt16LE(offset);
        case 1:  return buf.readUInt8(offset);
        default: return buf.slice(offset, offset + size);
    }
}

function _readDepRecord(depPath, addr) {
    let fd;
    try {
        fd = fs.openSync(depPath, 'r');

        const header = Buffer.alloc(10);
        fs.readSync(fd, header, 0, 10, addr);
        const recNo      = header.readInt32LE(0);
        const recSize    = header.readInt16LE(6);
        const paramCount = header[9];

        const body = Buffer.alloc(recSize - 10);
        fs.readSync(fd, body, 0, body.length, addr + 10);

        const params = new Map();
        let pos = 0;
        for (let i = 0; i < paramCount && pos < body.length; i++) {
            if (pos + 2 > body.length) break;
            const id   = body[pos + 1];   // body[pos] = ref (skip)
            pos += 2;
            const size = _paramSize[id] || 4;
            if (pos + size > body.length) break;
            params.set(id, _parseValue(body, pos, size));
            pos += size;
        }

        return { recNo, params };
    } catch (_) {
        return null;
    } finally {
        if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
    }
}

function _poll() {
    const storeDir = getEffectivePath();
    if (!storeDir) return;

    const lstPath = _findLatestLst(storeDir);
    if (!lstPath) return;

    const lst = _readLastLstRecord(lstPath);
    if (!lst || lst.addr === _lastAddr) return;

    _lastAddr = lst.addr;

    const depPath = lstPath.replace(/\.lst$/i, '.dep');
    const record  = _readDepRecord(depPath, lst.addr);
    if (!record) return;

    _onRecord({ recNo: record.recNo, depth: lst.depth, time: lst.time, params: record.params });
}

function startPolling(db, onRecord) {
    if (_pollTimer) return;
    _loadParamSizes(db);
    _onRecord  = onRecord;
    _lastAddr  = -1;
    _pollTimer = setInterval(_poll, 1000);
}

function stopPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    _onRecord = null;
    _lastAddr = -1;
}

module.exports = { getSettings, saveSettings, checkPath, setRunning, getEffectivePath, startPolling, stopPolling };

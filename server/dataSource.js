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

module.exports = { getSettings, saveSettings, checkPath, setRunning, getEffectivePath };

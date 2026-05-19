'use strict';

const fs   = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, 'data', 'data-source-settings.json');
const DEFAULTS      = { storePath: '' };

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
    const current  = _load();
    const updated  = Object.assign(current, { storePath: String(body.storePath || '') });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf8');
    return updated;
}

function checkPath(storePath) {
    const p = String(storePath || '').trim();
    if (!p) return { ok: false, message: 'Путь не указан' };
    try {
        const stat = fs.statSync(p);
        if (stat.isDirectory()) return { ok: true,  message: 'Папка существует' };
        return { ok: false, message: 'Путь указывает на файл, а не на папку' };
    } catch (_) {
        return { ok: false, message: 'Папка не найдена' };
    }
}

module.exports = { getSettings, saveSettings, checkPath };

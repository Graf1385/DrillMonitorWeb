'use strict';
const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const path = require('node:path');

const settingsPath = path.join(__dirname, '..', 'server', 'data', 'data-source-settings.json');

describe('dataSource.getApiKey', () => {
    let original;

    before(() => {
        try { original = fs.readFileSync(settingsPath, 'utf8'); } catch {}
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    });

    after(() => {
        if (original !== undefined) fs.writeFileSync(settingsPath, original);
        else try { fs.unlinkSync(settingsPath); } catch {}
    });

    test('auto-generates a 64-char hex key when none exists', () => {
        fs.writeFileSync(settingsPath, JSON.stringify({}));
        // Re-require to pick up the new settings state
        delete require.cache[require.resolve('../server/dataSource')];
        const ds = require('../server/dataSource');
        const key = ds.getApiKey();
        assert.equal(typeof key, 'string');
        assert.equal(key.length, 64);
        assert.ok(/^[0-9a-f]+$/.test(key));
    });

    test('persists generated key so subsequent calls return same key', () => {
        fs.writeFileSync(settingsPath, JSON.stringify({}));
        delete require.cache[require.resolve('../server/dataSource')];
        const ds = require('../server/dataSource');
        const k1 = ds.getApiKey();
        const k2 = ds.getApiKey();
        assert.equal(k1, k2);
    });

    test('returns existing key if already set', () => {
        const existing = 'a'.repeat(64);
        fs.writeFileSync(settingsPath, JSON.stringify({ apiKey: existing }));
        delete require.cache[require.resolve('../server/dataSource')];
        const ds = require('../server/dataSource');
        assert.equal(ds.getApiKey(), existing);
    });
});

describe('dataSource push mode', () => {
    let ds;

    beforeEach(() => {
        delete require.cache[require.resolve('../server/dataSource')];
        ds = require('../server/dataSource');
    });

    after(() => {
        try { ds.stopPushMode(); } catch {}
    });

    test('isPushMode() is false initially', () => {
        assert.equal(ds.isPushMode(), false);
    });

    test('getRunState() returns running:false when push not active', () => {
        const s = ds.getRunState();
        assert.equal(s.running, false);
    });

    test('startPushMode activates push mode', () => {
        ds.startPushMode(function () {});
        assert.equal(ds.isPushMode(), true);
        ds.stopPushMode();
    });

    test('getRunState() returns running:true after startPushMode', () => {
        ds.startPushMode(function () {});
        assert.equal(ds.getRunState().running, true);
        ds.stopPushMode();
    });

    test('receivePushRecord calls onRecord callback', () => {
        let received = null;
        ds.startPushMode(function (r) { received = r; });
        ds.receivePushRecord({ recNo: 1, depth: 100, time: 1000, params: new Map() });
        assert.deepEqual(received, { recNo: 1, depth: 100, time: 1000, params: new Map() });
        ds.stopPushMode();
    });

    test('stopPushMode resets isPushMode to false', () => {
        ds.startPushMode(function () {});
        ds.stopPushMode();
        assert.equal(ds.isPushMode(), false);
    });

    test('startPushMode is no-op when already active', () => {
        let callCount = 0;
        ds.startPushMode(function () { callCount++; });
        ds.startPushMode(function () { callCount += 100; }); // second call ignored
        ds.receivePushRecord({ recNo: 1, depth: 0, time: 0, params: new Map() });
        assert.equal(callCount, 1);
        ds.stopPushMode();
    });
});

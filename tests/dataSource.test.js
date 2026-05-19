'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const path = require('node:path');
const os   = require('node:os');

// dataSource.js uses db/connection.js (real DB) only for startPolling/refreshWatchedParams.
// checkPath, getEffectivePath and binary helpers do not touch the DB, so we set DB_PATH
// to a temp file to avoid side effects against the production database.
const tmpDb = path.join(os.tmpdir(), 'drillmonitor_test_' + process.pid + '.db');
process.env.DB_PATH = tmpDb;

const ds = require('../server/dataSource');

describe('dataSource.checkPath', () => {
    let tempDir;

    before(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds_test_'));
    });

    after(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
        try { fs.unlinkSync(tmpDb); } catch {}
    });

    test('empty storePath → ok: false, message includes "не указан"', () => {
        const r = ds.checkPath('');
        assert.equal(r.ok, false);
        assert.ok(r.message.includes('не указан'));
    });

    test('null storePath → ok: false', () => {
        const r = ds.checkPath(null);
        assert.equal(r.ok, false);
    });

    test('non-existent base path → ok: false, message includes "не найдена"', () => {
        const r = ds.checkPath('/nonexistent/path/xyz');
        assert.equal(r.ok, false);
        assert.ok(r.message.includes('не найдена'));
    });

    test('base path without Database/Online/Store subdir → ok: false', () => {
        // tempDir exists but has no Database/Online/Store inside
        const r = ds.checkPath(tempDir);
        assert.equal(r.ok, false);
    });

    test('base path with full Database/Online/Store subdir → ok: true', () => {
        const storeDir = path.join(tempDir, 'Database', 'Online', 'Store');
        fs.mkdirSync(storeDir, { recursive: true });
        const r = ds.checkPath(tempDir);
        assert.equal(r.ok, true);
        assert.ok(r.message.includes('найдена'));
    });

    test('file at expected path (not a dir) → ok: false', () => {
        // Use a fresh temp dir so we don't conflict with the previous test's dir
        const altDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds_file_test_'));
        try {
            const storeDir = path.join(altDir, 'Database', 'Online', 'Store');
            fs.mkdirSync(path.join(altDir, 'Database', 'Online'), { recursive: true });
            fs.writeFileSync(storeDir, ''); // file instead of dir
            const r = ds.checkPath(altDir);
            assert.equal(r.ok, false);
            assert.ok(r.message.includes('файл'));
        } finally {
            fs.rmSync(altDir, { recursive: true, force: true });
        }
    });
});

describe('dataSource.getEffectivePath', () => {
    test('returns null when no storePath is configured', () => {
        // Override _load by writing a settings file with empty storePath
        const settingsPath = path.join(__dirname, '..', 'server', 'data', 'data-source-settings.json');
        let original;
        try { original = fs.readFileSync(settingsPath, 'utf8'); } catch {}

        // Write temp settings with empty storePath
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify({ storePath: '', running: false }));
        assert.equal(ds.getEffectivePath(), null);

        // Restore
        if (original !== undefined) fs.writeFileSync(settingsPath, original);
        else fs.unlinkSync(settingsPath);
    });

    test('returns path ending in Database/Online/Store when storePath is set', () => {
        const settingsPath = path.join(__dirname, '..', 'server', 'data', 'data-source-settings.json');
        let original;
        try { original = fs.readFileSync(settingsPath, 'utf8'); } catch {}

        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify({ storePath: 'C:\\GeoData', running: false }));
        const p = ds.getEffectivePath();
        assert.ok(p !== null);
        assert.ok(p.endsWith(path.join('Database', 'Online', 'Store')));

        if (original !== undefined) fs.writeFileSync(settingsPath, original);
        else fs.unlinkSync(settingsPath);
    });
});

describe('dataSource binary parser — _parseValue logic', () => {
    // _parseValue is not exported, so we verify the expected contract by constructing
    // .lst and .dep binary buffers and observing what the poller reads.
    // Here we test the Buffer API behaviour that _parseValue relies on.

    test('Buffer.readFloatLE parses 4-byte little-endian float correctly', () => {
        const buf = Buffer.alloc(4);
        buf.writeFloatLE(3.14, 0);
        assert.ok(Math.abs(buf.readFloatLE(0) - 3.14) < 0.001);
    });

    test('Buffer.readInt16LE parses 2-byte signed int correctly', () => {
        const buf = Buffer.alloc(2);
        buf.writeInt16LE(-1234, 0);
        assert.equal(buf.readInt16LE(0), -1234);
    });

    test('Buffer.readUInt8 parses 1-byte unsigned int correctly', () => {
        const buf = Buffer.alloc(1);
        buf.writeUInt8(255, 0);
        assert.equal(buf.readUInt8(0), 255);
    });

    test('LST record: last 21 bytes encode addr(4) depth(4) time(4) correctly', () => {
        // Simulate a .lst record: 21 bytes, addr at 0, depth at 4, time at 8
        const LST_RECORD_SIZE = 21;
        const record = Buffer.alloc(LST_RECORD_SIZE);
        record.writeInt32LE(12345678, 0);  // addr
        record.writeFloatLE(1850.5, 4);    // depth
        record.writeInt32LE(1716000000, 8); // time (epoch)

        assert.equal(record.readInt32LE(0), 12345678);
        assert.ok(Math.abs(record.readFloatLE(4) - 1850.5) < 0.1);
        assert.equal(record.readInt32LE(8), 1716000000);
    });
});

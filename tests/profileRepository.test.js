'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { initSchema } = require('../server/db/schema');
const ProfileRepository = require('../server/db/ProfileRepository');

describe('ProfileRepository', () => {
    let db;
    let repo;

    before(() => {
        db = new Database(':memory:');
        db.pragma('journal_mode = WAL');
        initSchema(db);
        repo = new ProfileRepository(db);
    });

    after(() => db.close());

    // ── Read ─────────────────────────────────────────────────────────────────────

    test('getProfiles returns at least the default profile', () => {
        const profiles = repo.getProfiles();
        assert.ok(profiles.length >= 1);
        assert.ok(profiles.some(p => p.is_default === 1));
    });

    test('getProfile returns undefined for non-existent id', () => {
        assert.equal(repo.getProfile(999999), undefined);
    });

    // ── Create ───────────────────────────────────────────────────────────────────

    test('createProfile inserts row with correct fields', () => {
        const { lastInsertRowid: id } = repo.createProfile('TestCreate', '#123456', 35);
        const p = repo.getProfile(id);
        assert.equal(p.name, 'TestCreate');
        assert.equal(p.background, '#123456');
        assert.equal(p.cell_size, 35);
        assert.equal(p.alarm_volume, 50);
        assert.equal(p.alarm_delay, 2);
    });

    // ── Update ── (this is the node where the timezone bug lived) ────────────────

    test('updateProfile saves all 10 fields including timezone', () => {
        const { lastInsertRowid: id } = repo.createProfile('TzTest', '#000000', 20);
        repo.updateProfile(id, '#ffffff', 40, null, 75, 3.5, 1920, 1080, 30, 'Europe/Moscow');
        const p = repo.getProfile(id);
        assert.equal(p.background, '#ffffff');
        assert.equal(p.cell_size, 40);
        assert.equal(p.alarm_volume, 75);
        assert.equal(p.alarm_delay, 3.5);
        assert.equal(p.ws_width, 1920);
        assert.equal(p.ws_height, 1080);
        assert.equal(p.sidebar_timeout, 30);
        assert.equal(p.timezone, 'Europe/Moscow');
    });

    test('updateProfile with empty string clears timezone', () => {
        const { lastInsertRowid: id } = repo.createProfile('TzEmpty', '#000000', 20);
        repo.updateProfile(id, '#000000', 20, null, 50, 2, 0, 0, 20, 'Europe/Moscow');
        repo.updateProfile(id, '#000000', 20, null, 50, 2, 0, 0, 20, '');
        assert.equal(repo.getProfile(id).timezone, '');
    });

    test('updateProfile with null timezone falls back to empty string', () => {
        const { lastInsertRowid: id } = repo.createProfile('TzNull', '#000000', 20);
        repo.updateProfile(id, '#000000', 20, null, 50, 2, 0, 0, 20, null);
        assert.equal(repo.getProfile(id).timezone, '');
    });

    test('updateProfile returns changes=0 for non-existent id', () => {
        const result = repo.updateProfile(999999, '#fff', 20, null, 50, 2, 0, 0, 20, '');
        assert.equal(result.changes, 0);
    });

    test('updateProfile sets profile as active', () => {
        const { lastInsertRowid: id } = repo.createProfile('ActiveOnUpdate', '#000', 20);
        repo.updateProfile(id, '#000', 20, null, 50, 2, 0, 0, 20, '');
        assert.equal(repo.getProfile(id).is_active, 1);
    });

    // ── Select ───────────────────────────────────────────────────────────────────

    test('selectProfile marks exactly one profile active', () => {
        const a = repo.createProfile('SelectA', '#aaa', 20).lastInsertRowid;
        const b = repo.createProfile('SelectB', '#bbb', 20).lastInsertRowid;

        repo.selectProfile(a);
        assert.equal(repo.getProfile(a).is_active, 1);
        assert.equal(repo.getProfile(b).is_active, 0);

        repo.selectProfile(b);
        assert.equal(repo.getProfile(a).is_active, 0);
        assert.equal(repo.getProfile(b).is_active, 1);
    });

    test('getActiveProfile returns the currently active profile', () => {
        const { lastInsertRowid: id } = repo.createProfile('ActiveQuery', '#def', 20);
        repo.selectProfile(id);
        const active = repo.getActiveProfile();
        assert.equal(active.id, id);
    });

    // ── Delete ───────────────────────────────────────────────────────────────────

    test('deleteProfile removes a non-default profile', () => {
        const { lastInsertRowid: id } = repo.createProfile('ToDelete', '#000', 20);
        assert.equal(repo.deleteProfile(id).changes, 1);
        assert.equal(repo.getProfile(id), undefined);
    });

    test('deleteProfile refuses to remove the default profile (changes=0)', () => {
        const def = repo.getProfiles().find(p => p.is_default === 1);
        assert.equal(repo.deleteProfile(def.id).changes, 0);
        assert.ok(repo.getProfile(def.id));
    });
});

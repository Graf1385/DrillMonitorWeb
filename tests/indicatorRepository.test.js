'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { initSchema } = require('../server/db/schema');
const ProfileRepository  = require('../server/db/ProfileRepository');
const IndicatorRepository = require('../server/db/IndicatorRepository');

const BASE_IND = {
    param_id: 1, type: 'digitalIndicator',
    pos_left: 0, pos_top: 0, height: 100, width: 150,
    header_text: 'H', header_color: '#fff', header_bg: '#000',
    header_font: 0, header_size: 14, format: '0.00',
    value_color: '#0ff', value_bg: '#000', value_font: 0, value_size: 30,
    range_min: null, range_max: null, alarm_enabled: 0,
    alarm_min: null, alarm_max: null, alarm_color: '#f00',
    units: '', zone_colors: 0, ticker_speed: 12, value_bg_opacity: 0,
    extra_data: null,
};

describe('IndicatorRepository', () => {
    let db;
    let profiles;
    let repo;
    let p1, p2;

    before(() => {
        db = new Database(':memory:');
        db.pragma('journal_mode = WAL');
        initSchema(db);
        profiles = new ProfileRepository(db);
        repo     = new IndicatorRepository(db);
        p1 = profiles.createProfile('P1', '#000', 20).lastInsertRowid;
        p2 = profiles.createProfile('P2', '#fff', 20).lastInsertRowid;
    });

    after(() => db.close());

    // ── Save ─────────────────────────────────────────────────────────────────────

    test('saveIndicators inserts rows and getIndicatorsByProfile returns them', () => {
        repo.saveIndicators(p1, [
            { ...BASE_IND, param_id: 1, header_text: 'A' },
            { ...BASE_IND, param_id: 2, header_text: 'B' },
        ]);
        const rows = repo.getIndicatorsByProfile(p1);
        assert.equal(rows.length, 2);
        assert.equal(rows[0].header_text, 'A');
        assert.equal(rows[1].header_text, 'B');
    });

    test('saveIndicators is atomic — replaces all previous indicators', () => {
        repo.saveIndicators(p1, [{ ...BASE_IND, param_id: 99, header_text: 'Only' }]);
        const rows = repo.getIndicatorsByProfile(p1);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].header_text, 'Only');
    });

    test('saveIndicators with empty list clears all indicators for that profile', () => {
        repo.saveIndicators(p1, [{ ...BASE_IND, param_id: 1 }]);
        repo.saveIndicators(p1, []);
        assert.equal(repo.getIndicatorsByProfile(p1).length, 0);
    });

    test('saveIndicators does not touch other profiles', () => {
        repo.saveIndicators(p1, [{ ...BASE_IND, param_id: 10 }]);
        repo.saveIndicators(p2, [{ ...BASE_IND, param_id: 20, header_text: 'P2' }]);

        repo.saveIndicators(p1, [{ ...BASE_IND, param_id: 11 }]);

        const p2rows = repo.getIndicatorsByProfile(p2);
        assert.equal(p2rows.length, 1);
        assert.equal(p2rows[0].header_text, 'P2');
    });

    test('saveIndicators preserves param_id = null (time/date indicators)', () => {
        repo.saveIndicators(p1, [{ ...BASE_IND, param_id: null, type: 'timeIndicator' }]);
        const rows = repo.getIndicatorsByProfile(p1);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].param_id, null);
    });

    // ── getActiveIndicators ───────────────────────────────────────────────────────

    test('getActiveIndicators returns only indicators for active profile', () => {
        profiles.selectProfile(p1);
        repo.saveIndicators(p1, [{ ...BASE_IND, param_id: 1, header_text: 'ActInd' }]);
        repo.saveIndicators(p2, [{ ...BASE_IND, param_id: 2, header_text: 'InactInd' }]);

        const active = repo.getActiveIndicators();
        assert.ok(active.every(i => i.header_text !== 'InactInd'),
            'inactive profile indicators must not appear');
        assert.ok(active.some(i => i.header_text === 'ActInd'));
    });

    test('getActiveIndicators excludes indicators with param_id = null', () => {
        profiles.selectProfile(p1);
        repo.saveIndicators(p1, [
            { ...BASE_IND, param_id: 5,    header_text: 'HasParam' },
            { ...BASE_IND, param_id: null, header_text: 'NoParam', type: 'timeIndicator' },
        ]);

        const active = repo.getActiveIndicators();
        assert.ok(active.every(i => i.header_text !== 'NoParam'),
            'null-param indicators must be excluded from watchedParams feed');
        assert.ok(active.some(i => i.header_text === 'HasParam'));
    });

    // ── Profile isolation ─────────────────────────────────────────────────────────

    test('getIndicatorsByProfile returns only its own profile rows', () => {
        repo.saveIndicators(p1, [{ ...BASE_IND, param_id: 1 }]);
        repo.saveIndicators(p2, [{ ...BASE_IND, param_id: 2 }, { ...BASE_IND, param_id: 3 }]);

        assert.equal(repo.getIndicatorsByProfile(p1).length, 1);
        assert.equal(repo.getIndicatorsByProfile(p2).length, 2);
    });

    test('getIndicatorsByProfile for unknown profile returns empty array', () => {
        assert.equal(repo.getIndicatorsByProfile(999999).length, 0);
    });
});

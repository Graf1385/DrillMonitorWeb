'use strict';
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('../server/timeSync');

// On Windows / with TIME_SYNC=0 the module is disabled; `force` bypasses that
// so the decision logic can be tested anywhere.
const F = { force: true };
const nowSec = () => Date.now() / 1000;

describe('timeSync.consider', () => {
    let applied;

    beforeEach(() => {
        ts._reset();
        applied = [];
        ts._setApplier((epoch, cb) => { applied.push(epoch); cb(null, 'ok'); });
        ts._setLogger(() => {});   // the real logger opens the DB and starts timers
    });

    test('disabled by default on this platform unless forced', () => {
        if (ts.ENABLED) return; // Linux with TIME_SYNC unset: nothing to check here
        const r = ts.consider(nowSec() + 600);
        assert.equal(r, false);
        assert.equal(applied.length, 0);
    });

    test('ignores drift below the threshold', () => {
        for (let i = 0; i < 5; i++) {
            assert.equal(ts.consider(nowSec() + ts.THRESHOLD_SEC - 2, F), false);
        }
        assert.equal(applied.length, 0);
    });

    test('rejects invalid or implausible epochs', () => {
        assert.equal(ts.consider(NaN, F), false);
        assert.equal(ts.consider('abc', F), false);
        assert.equal(ts.consider(0, F), false);
        assert.equal(ts.consider(1_000_000_000, F), false);   // 2001
        assert.equal(ts.consider(5_000_000_000, F), false);   // 2128
        assert.equal(applied.length, 0);
    });

    test('applies only after CONFIRMATIONS consistent samples', () => {
        const target = nowSec() + 120;
        for (let i = 1; i < ts.CONFIRMATIONS; i++) {
            assert.equal(ts.consider(target + i, F), false, `sample ${i} must not apply`);
        }
        assert.equal(applied.length, 0);
        assert.equal(ts.consider(target + ts.CONFIRMATIONS, F), true);
        assert.equal(applied.length, 1);
        assert.equal(applied[0], Math.round(target + ts.CONFIRMATIONS));
    });

    test('inconsistent drift (replay of old data) is ignored', () => {
        const base = nowSec();
        assert.equal(ts.consider(base + 120, F), false);
        assert.equal(ts.consider(base + 400, F), false);
        assert.equal(ts.consider(base + 900, F), false);   // spread 780 s > MAX_SPREAD_SEC
        assert.equal(applied.length, 0);
    });

    test('negative drift (server ahead) is corrected too', () => {
        const target = nowSec() - 3600;
        ts.consider(target, F);
        ts.consider(target + 1, F);
        assert.equal(ts.consider(target + 2, F), true);
        assert.equal(applied.length, 1);
    });

    test('rate limit: no second correction within MIN_INTERVAL_SEC', () => {
        const target = nowSec() + 120;
        ts.consider(target, F); ts.consider(target + 1, F); ts.consider(target + 2, F);
        assert.equal(applied.length, 1);
        for (let i = 0; i < 6; i++) ts.consider(target + 10 + i, F);
        assert.equal(applied.length, 1, 'must not apply again immediately');
    });

    test('a sample below threshold resets the confirmation window', () => {
        const target = nowSec() + 120;
        ts.consider(target, F);
        ts.consider(target + 1, F);
        ts.consider(nowSec(), F);              // in sync → window reset
        assert.equal(ts.consider(target + 3, F), false);
        assert.equal(applied.length, 0);
    });

    test('applier failure does not throw and does not apply', () => {
        ts._setApplier((epoch, cb) => cb(new Error('sudo: a password is required')));
        const target = nowSec() + 120;
        ts.consider(target, F); ts.consider(target + 1, F);
        assert.doesNotThrow(() => ts.consider(target + 2, F));
    });
});

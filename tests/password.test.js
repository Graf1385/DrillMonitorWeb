'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const pw = require('../server/utils/password');

describe('password.hash', () => {
    test('produces pbkdf2 format with 4 colon-separated parts', () => {
        const h = pw.hash('secret');
        assert.match(h, /^pbkdf2:100000:[0-9a-f]{32}:[0-9a-f]{64}$/);
    });

    test('uses random salt — two hashes of the same password differ', () => {
        const h1 = pw.hash('same');
        const h2 = pw.hash('same');
        assert.notEqual(h1, h2);
    });
});

describe('password.verify — modern pbkdf2', () => {
    test('correct password → ok: true, legacy: false', () => {
        const h = pw.hash('correcthorse');
        const r = pw.verify('correcthorse', h);
        assert.equal(r.ok, true);
        assert.equal(r.legacy, false);
    });

    test('wrong password → ok: false', () => {
        const h = pw.hash('correcthorse');
        const r = pw.verify('wrongpassword', h);
        assert.equal(r.ok, false);
    });

    test('empty password is not equal to non-empty hash', () => {
        const h = pw.hash('nonempty');
        const r = pw.verify('', h);
        assert.equal(r.ok, false);
    });
});

describe('password.verify — legacy SHA-256', () => {
    test('correct legacy password → ok: true, legacy: true', () => {
        const legacyHash = crypto.createHash('sha256').update('legacypass').digest('hex');
        const r = pw.verify('legacypass', legacyHash);
        assert.equal(r.ok, true);
        assert.equal(r.legacy, true);
    });

    test('wrong legacy password → ok: false', () => {
        const legacyHash = crypto.createHash('sha256').update('legacypass').digest('hex');
        const r = pw.verify('wrongpass', legacyHash);
        assert.equal(r.ok, false);
    });
});

describe('password.verify — malformed input', () => {
    test('random string → ok: false', () => {
        assert.equal(pw.verify('anything', 'notahash').ok, false);
    });

    test('pbkdf2 with wrong iteration count → ok: false', () => {
        const h = pw.hash('pass').replace('pbkdf2:100000:', 'pbkdf2:99999:');
        assert.equal(pw.verify('pass', h).ok, false);
    });

    test('only 3 parts → ok: false', () => {
        assert.equal(pw.verify('pass', 'pbkdf2:100000:abcd').ok, false);
    });
});

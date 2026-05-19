'use strict';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const qs = require('node:querystring');

const BASE = 'http://localhost:3000';

// ── HTTP helper ───────────────────────────────────────────────────────────────

function req(method, urlPath, body, isForm) {
    return new Promise((resolve, reject) => {
        const bodyStr = body
            ? (isForm ? qs.stringify(body) : JSON.stringify(body))
            : null;
        const options = {
            hostname: '127.0.0.1',
            port: 3000,
            path: urlPath,
            method,
            headers: {
                'Content-Type': isForm
                    ? 'application/x-www-form-urlencoded'
                    : 'application/json',
                ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
            },
        };
        const request = http.request(options, res => {
            let raw = '';
            res.on('data', c => { raw += c; });
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
                catch { resolve({ status: res.statusCode, body: raw }); }
            });
        });
        request.on('error', reject);
        if (bodyStr) request.write(bodyStr);
        request.end();
    });
}

// ── Health ────────────────────────────────────────────────────────────────────

describe('GET /api/health', () => {
    test('returns ok:true and a version string', async () => {
        const r = await req('GET', '/api/health');
        assert.equal(r.status, 200);
        assert.equal(r.body.ok, true);
        assert.ok(typeof r.body.version === 'string');
    });
});

// ── Profiles ─────────────────────────────────────────────────────────────────

describe('GET /api/profiles', () => {
    test('returns an array with at least one profile', async () => {
        const r = await req('GET', '/api/profiles');
        assert.equal(r.status, 200);
        assert.ok(Array.isArray(r.body));
        assert.ok(r.body.length >= 1);
    });

    test('every profile includes the timezone field', async () => {
        const r = await req('GET', '/api/profiles');
        for (const p of r.body) {
            assert.ok('timezone' in p, `profile ${p.id} missing timezone field`);
        }
    });

    test('default profile has is_default=1', async () => {
        const r = await req('GET', '/api/profiles');
        assert.ok(r.body.some(p => p.is_default === 1));
    });
});

describe('Profile CRUD + timezone persistence', () => {
    let testProfileId;

    before(async () => {
        const r = await req('POST', '/api/profiles', {
            name: '__test_' + Date.now(),
            background: '#010101',
            cellSize: 25,
        }, true);
        assert.equal(r.status, 201);
        testProfileId = r.body.id;
    });

    after(async () => {
        if (testProfileId) await req('DELETE', '/api/profiles/' + testProfileId);
    });

    test('PUT /api/profiles/:id saves timezone and returns ok:true', async () => {
        const r = await req('PUT', '/api/profiles/' + testProfileId, {
            background: '#010101', cellSize: 25,
            alarmVolume: 60, alarmDelay: 1.5,
            wsWidth: 1920, wsHeight: 1080, sidebarTimeout: 15,
            timezone: 'Asia/Yekaterinburg',
        }, true);
        assert.equal(r.status, 200);
        assert.equal(r.body.ok, true);
    });

    test('GET /api/profiles reflects saved timezone', async () => {
        const r = await req('GET', '/api/profiles');
        const p = r.body.find(x => x.id === testProfileId);
        assert.ok(p, 'test profile not found');
        assert.equal(p.timezone, 'Asia/Yekaterinburg');
    });

    test('PUT with empty timezone stores empty string (not null)', async () => {
        await req('PUT', '/api/profiles/' + testProfileId, {
            background: '#010101', cellSize: 25,
            alarmVolume: 50, alarmDelay: 2,
            wsWidth: 0, wsHeight: 0, sidebarTimeout: 20,
            timezone: '',
        }, true);
        const r = await req('GET', '/api/profiles');
        const p = r.body.find(x => x.id === testProfileId);
        assert.equal(p.timezone, '');
    });

    test('PUT /api/profiles/999999 returns 404', async () => {
        const r = await req('PUT', '/api/profiles/999999', {
            background: '#fff', cellSize: 20,
        }, true);
        assert.equal(r.status, 404);
    });

    test('POST /api/profiles/:id/indicators saves and can be retrieved', async () => {
        const indicators = [{
            param_id: 1, type: 'digitalIndicator', pos_left: 0, pos_top: 0,
            height: 100, width: 150, header_text: 'Test', header_color: '#fff',
            header_bg: '#000', header_font: 0, header_size: 14, format: '0.00',
            value_color: '#0ff', value_bg: '#000', value_font: 0, value_size: 30,
            range_min: null, range_max: null, alarm_enabled: 0,
            alarm_min: null, alarm_max: null, alarm_color: '#f00',
            units: '', zone_colors: 0, ticker_speed: 12, value_bg_opacity: 0,
            extra_data: null,
        }];
        const saveR = await req('POST', '/api/profiles/' + testProfileId + '/indicators',
            { indicators }, false);
        assert.equal(saveR.status, 200);

        const getR = await req('GET', '/api/profiles/' + testProfileId + '/indicators');
        assert.equal(getR.status, 200);
        assert.ok(Array.isArray(getR.body));
        assert.equal(getR.body.length, 1);
        assert.equal(getR.body[0].header_text, 'Test');
    });
});

// ── Auth ──────────────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
    test('wrong credentials → 401, ok:false', async () => {
        const r = await req('POST', '/api/auth/login',
            { name: 'nobody', password: 'wrongpassword' }, true);
        assert.equal(r.status, 401);
        assert.equal(r.body.ok, false);
    });

    test('missing body fields → 401, ok:false', async () => {
        const r = await req('POST', '/api/auth/login', {}, true);
        assert.equal(r.status, 401);
        assert.equal(r.body.ok, false);
    });
});

// ── Protection: default profile cannot be deleted ─────────────────────────────

describe('DELETE /api/profiles/:id — default profile protection', () => {
    test('deleting default profile returns 403', async () => {
        const profiles = await req('GET', '/api/profiles');
        const def = profiles.body.find(p => p.is_default === 1);
        const r = await req('DELETE', '/api/profiles/' + def.id);
        assert.equal(r.status, 403);
    });
});

// ── Parameters ────────────────────────────────────────────────────────────────

describe('GET /api/parameters', () => {
    test('returns an array of at least 255 parameters', async () => {
        const r = await req('GET', '/api/parameters');
        assert.equal(r.status, 200);
        assert.ok(Array.isArray(r.body));
        assert.ok(r.body.length >= 255);
    });

    test('parameter 52 is "Время сбора данных"', async () => {
        const r = await req('GET', '/api/parameters');
        const p = r.body.find(x => x.id === 52);
        assert.ok(p, 'parameter 52 not found');
        assert.equal(p.name, 'Время сбора данных');
    });
});

// ── Input validation ──────────────────────────────────────────────────────────

describe('API input validation', () => {
    test('POST /api/profiles with missing fields → 400', async () => {
        const r = await req('POST', '/api/profiles', { name: 'OnlyName' }, true);
        assert.equal(r.status, 400);
    });

    test('POST /api/profiles/:id/indicators with non-array → 400', async () => {
        const r = await req('POST', '/api/profiles/1/indicators',
            { indicators: 'not-an-array' }, false);
        assert.equal(r.status, 400);
    });

    test('POST /api/logs with missing message → 400', async () => {
        const r = await req('POST', '/api/logs', {}, false);
        assert.equal(r.status, 400);
    });
});

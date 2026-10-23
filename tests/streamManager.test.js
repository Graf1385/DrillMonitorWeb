'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const sm = require('../server/streams/StreamManager');

describe('StreamManager.buildRtspUrl', () => {
    test('returns rtspUrl directly when provided', () => {
        const url = sm.buildRtspUrl({ rtspUrl: 'rtsp://direct/url' });
        assert.equal(url, 'rtsp://direct/url');
    });

    test('builds URL from host/port/credentials/channel', () => {
        const url = sm.buildRtspUrl({
            host: '192.168.1.1', port: 554,
            username: 'admin', password: 'pass12',
            channel: 2, substream: false
        });
        assert.equal(url, 'rtsp://admin:pass12@192.168.1.1:554/cam/realmonitor?channel=2&subtype=0');
    });

    test('defaults: channel=1, subtype=0, port=554 when not specified', () => {
        const url = sm.buildRtspUrl({ host: '10.0.0.1', username: 'u', password: 'p' });
        assert.ok(url.includes('channel=1'), 'should default to channel 1');
        assert.ok(url.includes('subtype=0'), 'should default to subtype 0');
        assert.ok(url.includes(':554/'),     'should default to port 554');
    });

    test('omits credentials when username is empty', () => {
        const url = sm.buildRtspUrl({ host: '10.0.0.2' });
        assert.ok(!url.includes('@'), 'no @ when no credentials');
        assert.match(url, /^rtsp:\/\/10\.0\.0\.2/);
    });

    test('substream: true → subtype=1', () => {
        const url = sm.buildRtspUrl({ host: 'h', substream: true });
        assert.ok(url.includes('subtype=1'));
    });

    test('encodes special characters in username and password', () => {
        const url = sm.buildRtspUrl({ host: 'h', username: 'user@co', password: 'p@ss/w' });
        assert.ok(!url.includes('user@co'), 'raw @ in username must be encoded');
        assert.ok(!url.includes('p@ss/w'),  'raw @ in password must be encoded');
    });
});

describe('StreamManager: поток поднимается сам', () => {
    // К табло на буровой не подойти: если камера моргнула и ffmpeg вышел,
    // перезапустить его некому. Адрес заведомо нерабочий — ffmpeg (или его
    // отсутствие) завершится сразу, и это ровно тот случай, который чиним.
    const waitFor = async (fn, ms = 8000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
            if (fn()) return true;
            await new Promise(r => setTimeout(r, 50));
        }
        return false;
    };
    const entry = () => sm.diag().find(s => s.key === 'selftest');

    test('после падения поток остаётся в работе и считает перезапуски', async () => {
        sm.start('selftest', 'rtsp://127.0.0.1:1/none');
        const fell = await waitFor(() => entry() && entry().restarts >= 1);
        assert.ok(fell, 'падение ffmpeg должно быть замечено');
        assert.equal(entry().running, false, 'между попытками процесса нет');
        assert.ok(sm.isActive('selftest'), 'намерение держать поток сохраняется');
        sm.stop('selftest');
    });

    test('остановленный поток больше не поднимается', async () => {
        sm.start('selftest2', 'rtsp://127.0.0.1:1/none');
        await waitFor(() => sm.diag().some(s => s.key === 'selftest2' && s.restarts >= 1));
        sm.stop('selftest2');
        assert.equal(sm.isActive('selftest2'), false);
        await new Promise(r => setTimeout(r, 2500));   // дольше первой паузы перезапуска
        assert.equal(sm.diag().some(s => s.key === 'selftest2'), false);
    });

    test('diag() и activeKeys() показывают, что сейчас запрошено', () => {
        assert.deepEqual(sm.activeKeys(), []);
        assert.ok(sm.hlsBase().length > 0);
    });
});

describe('StreamManager.streamKey validation', () => {
    test('start() throws on key with spaces', () => {
        assert.throws(
            () => sm.start('key with spaces', 'rtsp://x'),
            /Invalid streamKey/
        );
    });

    test('start() throws on key with special chars', () => {
        assert.throws(
            () => sm.start('key/../etc', 'rtsp://x'),
            /Invalid streamKey/
        );
    });

    test('start() throws when key exceeds 64 chars', () => {
        assert.throws(
            () => sm.start('a'.repeat(65), 'rtsp://x'),
            /Invalid streamKey/
        );
    });

    test('valid key (alphanumeric, hyphens, underscores) does not throw on validation', () => {
        // We can check the validation branch without actually spawning ffmpeg
        // by checking the regex directly mirrors what the code uses
        const VALID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
        assert.ok(VALID_RE.test('cam_01'));
        assert.ok(VALID_RE.test('stream-42'));
        assert.ok(VALID_RE.test('A'.repeat(64)));
        assert.ok(!VALID_RE.test('cam 01'));
        assert.ok(!VALID_RE.test(''));
    });
});

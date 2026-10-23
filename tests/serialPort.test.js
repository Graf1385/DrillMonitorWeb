'use strict';
// Изолированная БД в памяти — ДО require('../server/serialSource')
process.env.DB_PATH = ':memory:';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const serial = require('../server/serialSource');

// 1a86 — WCH (CH343, преобразователь на табло), 0403 — FTDI, 0bda — не преобразователь
const vendors = {
    '/dev/ttyACM0': '1a86:55d3',
    '/dev/ttyACM1': '0403:6001',
    '/dev/ttyACM2': '0bda:8153',
    '/dev/ttyUSB0': null,
};
const vendorOf = (p) => (p in vendors ? vendors[p] : null);

describe('serialSource.choosePort', () => {
    test('штатный узел на месте — берём его', () => {
        const r = serial.choosePort('/dev/ttyCH343', ['/dev/ttyCH343', '/dev/ttyACM0'], vendorOf);
        assert.equal(r.port, '/dev/ttyCH343');
        assert.equal(r.fallback, false);
    });

    test('ссылки udev нет — берём единственный преобразователь', () => {
        const r = serial.choosePort('/dev/ttyCH343', ['/dev/ttyACM0', '/dev/ttyACM2'], vendorOf);
        assert.equal(r.port, '/dev/ttyACM0', 'ttyACM2 — не преобразователь (0bda)');
        assert.equal(r.fallback, true);
        assert.equal(r.vendor, '1a86:55d3');
    });

    test('преобразователей несколько — не угадываем, а объясняем', () => {
        const r = serial.choosePort('/dev/ttyCH343', ['/dev/ttyACM0', '/dev/ttyACM1'], vendorOf);
        assert.equal(r.port, null);
        assert.match(r.reason, /несколько/);
    });

    test('единственный порт берём, даже если производителя не опознали', () => {
        const r = serial.choosePort('/dev/ttyCH343', ['/dev/ttyUSB0'], vendorOf);
        assert.equal(r.port, '/dev/ttyUSB0');
        assert.equal(r.fallback, true);
    });

    test('портов нет вовсе — ждём подключения', () => {
        const r = serial.choosePort('/dev/ttyCH343', [], vendorOf);
        assert.equal(r.port, null);
        assert.match(r.reason, /портов нет/);
    });

    test('несколько неопознанных портов — выбор неоднозначен', () => {
        const r = serial.choosePort('/dev/ttyCH343', ['/dev/ttyUSB0', '/dev/ttyACM2'], vendorOf);
        assert.equal(r.port, null);
        assert.match(r.reason, /не опознан/);
    });
});

describe('serialSource.status', () => {
    test('сводка содержит поля для самодиагностики', () => {
        const st = serial.status();
        ['activePort', 'openMs', 'silenceMs', 'reopens', 'framesOk', 'framesBad']
            .forEach((k) => assert.ok(k in st, 'нет поля ' + k));
    });

    test('до первого кадра тишина не измеряется', () => {
        assert.equal(serial.status().silenceMs, null);
    });
});

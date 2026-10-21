'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { crc16, hex4, encode, FrameParser, STX, ETX, MAX_PAYLOAD } = require('../server/serialFrame');

const RECORD = { recNo: 7, depth: 1520.55, time: 1792600112, params: { '0': 12.3, '53': 1520.55 } };

function collect() {
    const frames = [], errors = [];
    const p = new FrameParser(o => frames.push(o), (c, d) => errors.push(c));
    return { p, frames, errors };
}

describe('crc16 (CRC-16/MODBUS)', () => {
    test('check value for "123456789" is 0x4B37', () => {
        assert.equal(crc16(Buffer.from('123456789', 'ascii')), 0x4B37);
    });
    test('hex4 pads to 4 uppercase chars', () => {
        assert.equal(hex4(0x4B37), '4B37');
        assert.equal(hex4(0x001F), '001F');
    });
});

describe('encode', () => {
    test('frame layout: STX json ETX crc CRLF', () => {
        const buf  = encode(RECORD);
        const json = JSON.stringify(RECORD);
        assert.equal(buf[0], STX);
        assert.equal(buf[1 + json.length], ETX);
        assert.equal(buf.subarray(1, 1 + json.length).toString('utf8'), json);
        assert.equal(buf.subarray(buf.length - 6, buf.length - 2).toString('ascii'), hex4(crc16(Buffer.from(json))));
        assert.equal(buf.subarray(buf.length - 2).toString('ascii'), '\r\n');
    });
});

describe('FrameParser', () => {
    test('parses one complete frame', () => {
        const { p, frames, errors } = collect();
        p.push(encode(RECORD));
        assert.deepEqual(frames, [RECORD]);
        assert.equal(errors.length, 0);
        assert.equal(p.frames, 1);
    });

    test('reassembles a frame delivered byte by byte', () => {
        const { p, frames } = collect();
        const buf = encode(RECORD);
        for (let i = 0; i < buf.length; i++) p.push(buf.subarray(i, i + 1));
        assert.deepEqual(frames, [RECORD]);
    });

    test('handles several frames in one chunk and a split across chunks', () => {
        const { p, frames } = collect();
        const a = encode({ recNo: 1, params: {} });
        const b = encode({ recNo: 2, params: {} });
        const c = encode({ recNo: 3, params: {} });
        const all = Buffer.concat([a, b, c]);
        const cut = a.length + Math.floor(b.length / 2);
        p.push(all.subarray(0, cut));
        p.push(all.subarray(cut));
        assert.deepEqual(frames.map(f => f.recNo), [1, 2, 3]);
    });

    test('discards garbage before STX and between frames', () => {
        const { p, frames, errors } = collect();
        p.push(Buffer.concat([Buffer.from('noise\xff\x00xx', 'latin1'), encode(RECORD), Buffer.from('tail')]));
        assert.deepEqual(frames, [RECORD]);
        assert.equal(errors.length, 0);
    });

    test('rejects a frame with a wrong CRC and recovers on the next one', () => {
        const { p, frames, errors } = collect();
        const bad = encode(RECORD);
        bad[bad.length - 3] = bad[bad.length - 3] === 0x30 ? 0x31 : 0x30;   // portim last crc digit
        p.push(Buffer.concat([bad, encode({ recNo: 99, params: {} })]));
        assert.deepEqual(frames.map(f => f.recNo), [99]);
        assert.deepEqual(errors, ['crc']);
    });

    test('rejects a corrupted payload byte (CRC mismatch)', () => {
        const { p, frames, errors } = collect();
        const bad = encode(RECORD);
        bad[5] ^= 0x01;
        p.push(bad);
        assert.equal(frames.length, 0);
        assert.deepEqual(errors, ['crc']);
    });

    test('CRC may be lowercase hex, CRLF after CRC is optional', () => {
        const { p, frames } = collect();
        const json = JSON.stringify(RECORD);
        const crc  = hex4(crc16(Buffer.from(json))).toLowerCase();
        p.push(Buffer.concat([Buffer.from([STX]), Buffer.from(json), Buffer.from([ETX]), Buffer.from(crc)]));
        assert.deepEqual(frames, [RECORD]);
    });

    test('invalid JSON with a valid CRC is reported as json error', () => {
        const { p, frames, errors } = collect();
        const payload = Buffer.from('{not json', 'utf8');
        p.push(Buffer.concat([Buffer.from([STX]), payload, Buffer.from([ETX]), Buffer.from(hex4(crc16(payload)))]));
        assert.equal(frames.length, 0);
        assert.deepEqual(errors, ['json']);
    });

    test('an unterminated oversized frame is dropped and parsing resyncs', () => {
        const { p, frames, errors } = collect();
        p.push(Buffer.concat([Buffer.from([STX]), Buffer.alloc(MAX_PAYLOAD + 10, 0x41)]));
        assert.ok(errors.includes('overflow'));
        p.push(encode({ recNo: 5, params: {} }));
        assert.deepEqual(frames.map(f => f.recNo), [5]);
    });

    test('state frame round-trips', () => {
        const { p, frames } = collect();
        p.push(encode({ state: { running: false, reason: 'остановлено оператором' } }));
        assert.deepEqual(frames, [{ state: { running: false, reason: 'остановлено оператором' } }]);
    });

    test('cyrillic payload survives utf-8 framing', () => {
        const { p, frames } = collect();
        const obj = { state: { running: true, reason: 'Привет, буровая' } };
        p.push(encode(obj));
        assert.deepEqual(frames, [obj]);
    });
});

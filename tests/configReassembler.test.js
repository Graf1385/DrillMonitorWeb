'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { ConfigReassembler } = require('../server/configReassembler');

// Нарезать объект на кадры {id,i,n,s,k} кусками по k символов JSON
function chunkConfig(id, obj, k, kind) {
    const json  = JSON.stringify(obj);
    const parts = [];
    for (let i = 0; i < json.length; i += k) parts.push(json.slice(i, i + k));
    const n = parts.length;
    return parts.map((s, i) => {
        const f = { id: id, i: i, n: n, s: s };
        if (kind) f.k = kind;
        return f;
    });
}

const CFG = { profile: { name: 'A', background: '#000', cellSize: 20 },
              indicators: [{ param_id: 0, type: 'digitalIndicator', header_text: 'Вес' }] };

// Сборка возвращает вид посылки вместе с данными
const done = (data, kind) => ({ kind: kind || 'config', data: data });

describe('ConfigReassembler', () => {
    test('собирает конфиг из частей по порядку', () => {
        const asm = new ConfigReassembler();
        const fr  = chunkConfig(7, CFG, 10);
        assert.ok(fr.length > 1, 'нужно несколько частей');
        let result = null;
        fr.forEach((f, i) => {
            const r = asm.push(f);
            if (i < fr.length - 1) assert.equal(r, null, 'до последней части — null');
            else result = r;
        });
        assert.deepEqual(result, done(CFG));
    });

    test('собирает при частях вразнобой', () => {
        const asm = new ConfigReassembler();
        const fr  = chunkConfig(8, CFG, 9).reverse();
        let result = null;
        fr.forEach((f, i) => {
            const r = asm.push(f);
            if (i < fr.length - 1) assert.equal(r, null);
            else result = r;
        });
        assert.deepEqual(result, done(CFG));
    });

    test('повтор кадров идемпотентен', () => {
        const asm = new ConfigReassembler();
        const fr  = chunkConfig(9, CFG, 8);
        const results = [];
        // каждый кадр шлём дважды подряд — сборка завершается ровно один раз
        fr.forEach(f => { [asm.push(f), asm.push(f)].forEach(r => { if (r) results.push(r); }); });
        assert.ok(results.length >= 1, 'конфиг собрался');
        assert.deepEqual(results[0], done(CFG));
    });

    test('одна часть (n=1) применяется сразу', () => {
        const asm = new ConfigReassembler();
        const r = asm.push({ id: 1, i: 0, n: 1, s: JSON.stringify(CFG) });
        assert.deepEqual(r, done(CFG));
    });

    test('вид посылки (k) возвращается вместе с данными', () => {
        const asm  = new ConfigReassembler();
        const REFS = { units: [{ id: 1, name: 'Тонна', symbol: 'т' }] };
        const fr   = chunkConfig(11, REFS, 12, 'refs');
        assert.ok(fr.length > 1);
        let result = null;
        fr.forEach(f => { const r = asm.push(f); if (r) result = r; });
        assert.deepEqual(result, done(REFS, 'refs'));
    });

    test('смена вида посылки на том же id сбрасывает сборку', () => {
        const asm = new ConfigReassembler();
        const a = chunkConfig(12, CFG, 9, 'config');
        asm.push(a[0]);                                   // начали config
        const b = chunkConfig(12, { net: 1 }, 4, 'net');  // тот же id, другой вид
        let result = null;
        b.forEach(f => { const r = asm.push(f); if (r) result = r; });
        assert.deepEqual(result, done({ net: 1 }, 'net'));
    });

    test('новый id сбрасывает незаконченную сборку', () => {
        const asm = new ConfigReassembler();
        const a = chunkConfig(1, CFG, 9);
        asm.push(a[0]);                       // начали id=1, не закончили
        const b = chunkConfig(2, CFG, 9);     // пришёл другой id целиком
        let result = null;
        b.forEach(f => { const r = asm.push(f); if (r) result = r; });
        assert.deepEqual(result, done(CFG));
    });

    test('протухшая сборка не завершается опоздавшей частью', () => {
        let t = 0;
        const asm = new ConfigReassembler({ ttlMs: 1000, now: () => t });
        const fr  = chunkConfig(5, CFG, 5);
        assert.ok(fr.length > 2);
        for (let i = 0; i < fr.length - 1; i++) assert.equal(asm.push(fr[i]), null);
        t = 5000;                              // превысили TTL
        assert.equal(asm.push(fr[fr.length - 1]), null);
    });

    test('мусорные кадры игнорируются (null)', () => {
        const asm = new ConfigReassembler();
        assert.equal(asm.push(null), null);
        assert.equal(asm.push({}), null);
        assert.equal(asm.push({ id: 1, i: 0, n: 1, s: 123 }), null); // s не строка
        assert.equal(asm.push({ id: 1, i: 5, n: 2, s: 'x' }), null); // i вне диапазона
    });

    test('битый JSON после сборки → null', () => {
        const asm = new ConfigReassembler();
        assert.equal(asm.push({ id: 3, i: 0, n: 2, s: '{bad' }), null);
        assert.equal(asm.push({ id: 3, i: 1, n: 2, s: 'json}' }), null);
    });
});

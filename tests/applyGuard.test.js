'use strict';
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { ApplyGuard } = require('../server/applyGuard');

describe('applyGuard: отсев повторов посылки', () => {
    let clock, g;

    beforeEach(() => {
        clock = 0;
        g = new ApplyGuard({ windowMs: 10000, now: () => clock });
    });

    const cfg = (sid) => ({ sid: sid, profile: { name: 'СПО' }, indicators: [] });

    test('первая посылка не повтор', () => {
        assert.equal(g.isRepeat('config', cfg(1)), false);
    });

    test('тот же текст в окне — повтор', () => {
        assert.equal(g.isRepeat('config', cfg(1)), false);
        g.applied('config', cfg(1));
        clock += 1000;
        assert.equal(g.isRepeat('config', cfg(1)), true);
    });

    test('окно скользящее: длинная посылка проходами дальше окна тоже отсеивается', () => {
        // Три прохода по линии: между соседними 8 с при окне 10 с —
        // без сдвига третий вышел бы за окно и применился заново
        g.applied('config', cfg(1));
        clock += 8000;
        assert.equal(g.isRepeat('config', cfg(1)), true);
        clock += 8000;
        assert.equal(g.isRepeat('config', cfg(1)), true, 'третий проход тоже повтор');
    });

    test('после окна повтор проходит', () => {
        g.applied('config', cfg(1));
        clock += 10000;
        assert.equal(g.isRepeat('config', cfg(1)), false);
    });

    test('новая отправка той же раскладки отличается номером и проходит', () => {
        g.applied('config', cfg(1));
        clock += 1000;
        assert.equal(g.isRepeat('config', cfg(2)), false,
                     'сознательное повторное сохранение отсеивать нельзя');
    });

    test('другой вид посылки не отсеивается', () => {
        g.applied('config', cfg(1));
        assert.equal(g.isRepeat('net', cfg(1)), false);
    });

    test('возврат к предыдущему значению проходит: помним только последнее', () => {
        const a = { sid: 1, profile: { name: 'A' }, select: true };
        const b = { sid: 2, profile: { name: 'B' }, select: true };
        g.applied('config', a);
        assert.equal(g.isRepeat('config', b), false);
        g.applied('config', b);
        assert.equal(g.isRepeat('config', a), false, 'A → B → A должно примениться');
    });

    test('после ошибки повтор принимается', () => {
        g.applied('config', cfg(1));
        g.failed();
        assert.equal(g.isRepeat('config', cfg(1)), false);
    });

    test('неперевариваемая посылка повтором не считается', () => {
        const loop = {};
        loop.self = loop;
        assert.equal(g.isRepeat('config', loop), false);
    });
});

'use strict';
process.env.DB_PATH = ':memory:';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const sse        = require('../server/sse');
const updateMode = require('../server/updateMode');

// Перехватываем рассылку: киоск узнаёт о ходе обновления только через неё
const sent = [];
const realBroadcast = sse.broadcast;
sse.broadcast = function (event, data) { sent.push({ event, data }); };

function last(event) {
    for (let i = sent.length - 1; i >= 0; i--) if (sent[i].event === event) return sent[i].data;
    return null;
}

beforeEach(() => { sent.length = 0; updateMode.reset(); });

describe('updateMode', () => {
    test('начало поднимает заставку и рассказывает о ней киоску', () => {
        updateMode.begin({ name: 'DrillMonitorWeb 1.9.1', version: '1.9.1',
                           size: 1024 * 500, channel: 'RS-485' });

        assert.equal(updateMode.isActive(), true);
        const s = last('update-state');
        assert.ok(s, 'киоску сказали');
        assert.equal(s.active, true);
        assert.equal(s.version, '1.9.1');
        assert.equal(s.phase, 'receiving');
        assert.equal(s.percent, 0);
    });

    test('ход приёма считается в процентах от объявленного размера', () => {
        updateMode.begin({ version: '1.9.1', size: 0, channel: 'RS-485' });
        updateMode.progress(5, 20);

        const s = updateMode.state();
        assert.equal(s.received, 5);
        assert.equal(s.size, 20);
        assert.equal(s.percent, 25);
    });

    test('распаковка: процентов больше нет, но работа видна', () => {
        updateMode.begin({ version: '1.9.1', size: 10 });
        updateMode.unpacking();

        const s = updateMode.state();
        assert.equal(s.phase, 'unpacking');
        assert.equal(s.percent, 100);
    });

    test('неудача снимает заставку: табло не должно остаться закрытым', () => {
        updateMode.begin({ version: '1.9.1', size: 10 });
        updateMode.fail('пакет повреждён');

        assert.equal(updateMode.isActive(), false);
        assert.equal(last('update-state').active, false);
    });

    test('до начала обновления ход и распаковка ничего не поднимают', () => {
        updateMode.progress(5, 10);
        updateMode.unpacking();
        assert.equal(updateMode.isActive(), false);
        assert.equal(sent.length, 0, 'киоску сказать нечего');
    });

    test('повторное начало не ломает состояние: Loader мог не получить ответ', () => {
        updateMode.begin({ version: '1.9.1', size: 100 });
        updateMode.progress(50, 100);
        updateMode.begin({ version: '1.9.1', size: 100 });

        const s = updateMode.state();
        assert.equal(s.active, true);
        assert.equal(s.received, 0, 'счёт пошёл заново');
        assert.equal(s.phase, 'receiving');
    });

    test('о ходе приёма не трещим на каждую часть', () => {
        updateMode.begin({ version: '1.9.1', size: 100 });
        const before = sent.filter(x => x.event === 'update-state').length;
        for (let i = 1; i <= 20; i++) updateMode.progress(i, 100);
        const after = sent.filter(x => x.event === 'update-state').length;

        assert.ok(after - before <= 2, 'рассылка придержана, было ' + (after - before));
        assert.equal(updateMode.state().percent, 20, 'само состояние точное');
    });
});

// Возвращаем рассылку на место, иначе соседние проверки получат наш перехват
process.on('exit', () => { sse.broadcast = realBroadcast; });

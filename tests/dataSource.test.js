'use strict';
const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

describe('dataSource push mode', () => {
    let ds;

    beforeEach(() => {
        delete require.cache[require.resolve('../server/dataSource')];
        ds = require('../server/dataSource');
    });

    after(() => {
        try { ds.stopPushMode(); } catch {}
    });

    test('isPushMode() is false initially', () => {
        assert.equal(ds.isPushMode(), false);
    });

    test('getRunState() returns running:false when push not active', () => {
        assert.equal(ds.getRunState().running, false);
    });

    test('startPushMode activates push mode', () => {
        ds.startPushMode(function () {});
        assert.equal(ds.isPushMode(), true);
        ds.stopPushMode();
    });

    test('getRunState() returns running:true after startPushMode', () => {
        ds.startPushMode(function () {});
        assert.equal(ds.getRunState().running, true);
        ds.stopPushMode();
    });

    test('receivePushRecord calls onRecord callback', () => {
        let received = null;
        ds.startPushMode(function (r) { received = r; });
        ds.receivePushRecord({ recNo: 1, depth: 100, time: 1000, params: new Map() });
        assert.deepEqual(received, { recNo: 1, depth: 100, time: 1000, params: new Map() });
        ds.stopPushMode();
    });

    test('stopPushMode resets isPushMode to false', () => {
        ds.startPushMode(function () {});
        ds.stopPushMode();
        assert.equal(ds.isPushMode(), false);
    });

    test('startPushMode is no-op when already active', () => {
        let callCount = 0;
        ds.startPushMode(function () { callCount++; });
        ds.startPushMode(function () { callCount += 100; });
        ds.receivePushRecord({ recNo: 1, depth: 0, time: 0, params: new Map() });
        assert.equal(callCount, 1);
        ds.stopPushMode();
    });
});

describe('dataSource: тишина в потоке', () => {
    let ds;

    beforeEach(() => {
        delete require.cache[require.resolve('../server/dataSource')];
        ds = require('../server/dataSource');
    });

    after(() => { try { ds.stopPushMode(); } catch {} });

    test('порог тишины не меньше пяти секунд и растёт с интервалом отправки', () => {
        assert.equal(ds.staleAfterFor(0),    ds.STALE_TIMEOUT);
        assert.equal(ds.staleAfterFor(1000), ds.STALE_TIMEOUT, 'при частой отправке порог не трогаем');
        assert.equal(ds.staleAfterFor(4000), 10000,
                     'при интервале 4 с один потерянный пакет не должен гасить табло');
    });

    // У табло нет ни NTP, ни живого RTC: системные часы подводит timeSync по
    // времени из пакетов Loader. Если тишину мерить Date.now(), каждый такой
    // перевод мгновенно выглядит обрывом связи — киоск моргает «нет данных».
    test('перевод системных часов вперёд не выглядит обрывом потока', async () => {
        const realNow = Date.now;
        let stale = null;
        ds.startPushMode(function () {}, { onStale: (r) => { stale = r; } });
        ds.receivePushRecord({ recNo: 1, depth: 0, time: 0, params: new Map() });

        Date.now = () => realNow() + 60 * 60 * 1000;   // часы ушли на час вперёд
        try {
            await new Promise((r) => setTimeout(r, 1300));   // сторож тикает раз в секунду
            assert.equal(stale, null, 'поток живой, а монитор решил, что связь оборвалась');
            assert.equal(ds.getRunState().running, true);
        } finally {
            Date.now = realNow;
            ds.stopPushMode();
        }
    });
});

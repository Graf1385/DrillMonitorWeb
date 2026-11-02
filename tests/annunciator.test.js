'use strict';
// Изолированная БД в памяти — на случай, если что-то дотянется до server/db
process.env.DB_PATH = ':memory:';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const ann = require('../server/annunciator');

// Плата шлёт счётчики нажатий, а не события (firmware/annunciator): пропавший
// отчёт не теряет нажатие, повторный не удваивает. Здесь — что сервер делает
// с этими счётчиками.

let calls;

function report(shortN, longN) {
    return Buffer.from([1, 4, shortN & 0xff, longN & 0xff, 0, 0, 0, 0]);
}

describe('annunciator', () => {
    beforeEach(() => {
        ann._reset();
        calls = { next: 0, ack: 0, logs: [], updating: false };
        ann._setDeps({
            nextProfile: () => { calls.next++; return 'СПО'; },
            ackAll:      () => { calls.ack++; return true; },
            updating:    () => calls.updating,
            log:         (m) => calls.logs.push(m),
        });
    });

    test('первый отчёт — точка отсчёта, накопленное до нас не исполняется', () => {
        ann._handleReport(report(7, 3));
        assert.equal(calls.next, 0);
        assert.equal(calls.ack, 0);
    });

    test('короткое нажатие — следующий профиль, повтор того же отчёта — ничего', () => {
        ann._handleReport(report(7, 3));
        ann._handleReport(report(8, 3));
        ann._handleReport(report(8, 3));
        assert.equal(calls.next, 1);
        assert.match(calls.logs[0], /профиль «СПО»/);
    });

    test('длинное нажатие — квитирование, профиль не трогаем', () => {
        ann._handleReport(report(7, 3));
        ann._handleReport(report(8, 4));    // плата могла досчитать и короткое
        assert.equal(calls.ack, 1);
        assert.equal(calls.next, 0);
    });

    test('счётчик ходит по кругу: 255 → 0 — это одно нажатие', () => {
        ann._handleReport(report(255, 0));
        ann._handleReport(report(0, 0));
        assert.equal(calls.next, 1);
        assert.equal(ann._delta(255, 0), 1);
    });

    test('скачок счётчика на сотню — сбой, не сто нажатий', () => {
        assert.equal(ann._delta(10, 110), 0);
    });

    test('во время обновления нажатия не исполняются', () => {
        ann._handleReport(report(0, 0));
        calls.updating = true;
        ann._handleReport(report(1, 0));
        assert.equal(calls.next, 0);
        assert.match(calls.logs[0], /во время обновления/);
    });

    test('ошибка действия попадает в журнал, а не роняет приём', () => {
        ann._setDeps({ nextProfile: () => { throw new Error('Профиля нет'); } });
        ann._handleReport(report(0, 0));
        ann._handleReport(report(1, 0));
        assert.match(calls.logs[0], /не исполнено — Профиля нет/);
    });

    test('выходной отчёт: номер отчёта 0, реле, эхо счётчиков', () => {
        ann._handleReport(report(5, 2));
        ann.set(true);                      // без платы просто запоминается
        const b = ann._outReport();
        assert.equal(b.length, 9);
        assert.equal(b[0], 0, 'hidraw: первый байт — номер отчёта');
        assert.equal(b[1], 1);
        assert.equal(b[3], 5);
        assert.equal(b[4], 2);
        ann.set(false);
        assert.equal(ann._outReport()[1], 0);
    });

    test('без платы оповещатель недоступен — звук уйдёт в динамик', () => {
        ann._handleReport(report(0, 0));
        assert.equal(ann.available(), false, 'отчёт без открытого устройства не делает плату живой');
        assert.equal(ann.status().present, false);
    });
});

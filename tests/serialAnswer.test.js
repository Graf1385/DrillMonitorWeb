'use strict';
// Изолированная БД в памяти — ДО require('../server/db')
process.env.DB_PATH = ':memory:';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const serial = require('../server/serialSource');
const rpc    = require('../server/rpc');
const db     = require('../server/db');

// Сборщик кадров вместо линии: handleFrame принимает передатчик вторым
// аргументом, так что ответы можно поймать без порта.
function sink() {
    const sent = [];
    const send = function (obj) { sent.push(obj); return Promise.resolve(true); };
    send.sent = sent;
    return send;
}

/// Нарезать запрос на части cfgSeq, как это делает Loader с длинной посылкой.
function chunks(req, id, size) {
    const json = JSON.stringify(req);
    const out  = [];
    const n    = Math.ceil(json.length / size);
    for (let i = 0; i < n; i++)
        out.push({ cfgSeq: { id: id, i: i, n: n, s: json.slice(i * size, (i + 1) * size), k: 'req' } });
    return out;
}

beforeEach(() => rpc.reset());

describe('RS-485: табло отвечает на обмены', () => {
    test('кадр {"req":…} выполняется и получает ответ {"res":…}', () => {
        const send = sink();
        serial.handleFrame({ req: { id: 1, op: 'profile.get' } }, send);

        assert.equal(send.sent.length, 1, 'ответ отправлен');
        const res = send.sent[0].res;
        assert.equal(res.id, 1);
        assert.equal(res.ok, true, res.error);
        assert.ok(res.data.profile.name, 'в ответе раскладка');
    });

    test('неизвестный обмен тоже получает ответ — с отказом', () => {
        const send = sink();
        serial.handleFrame({ req: { id: 2, op: 'нет.такого' } }, send);

        assert.equal(send.sent.length, 1, 'молчать в ответ нельзя: Loader ждёт');
        assert.equal(send.sent[0].res.ok, false);
        assert.match(send.sent[0].res.error, /неизвестн/i);
    });

    test('по линии входа в систему нет: опасные обмены проходят', () => {
        serial.handleFrame({ req: { id: 3, op: 'profile.create', data: { name: 'Линейный' } } }, sink());
        const send = sink();
        serial.handleFrame({ req: { id: 4, op: 'profile.delete', data: { name: 'Линейный' } } }, send);

        assert.equal(send.sent[0].res.ok, true, send.sent[0].res.error);
        assert.ok(!db.getProfiles().some(p => p.name === 'Линейный'));
    });

    test('длинный запрос собирается из частей и отвечается один раз', () => {
        const send = sink();
        const req  = { id: 5, op: 'profile.save', data: {
            profile: { name: 'Длинный', background: '#000000', cellSize: 20 },
            indicators: Array.from({ length: 12 }, (_, i) => ({
                param_id: i, type: 'digitalIndicator', header_text: 'Параметр ' + i,
                pos_left: i, pos_top: i, width: 10, height: 10,
            })),
        } };

        const parts = chunks(req, 900, 200);
        assert.ok(parts.length > 3, 'запрос правда длинный: ' + parts.length + ' частей');
        parts.forEach(p => serial.handleFrame(p, send));

        assert.equal(send.sent.length, 1, 'ответ один, на собранный запрос');
        assert.equal(send.sent[0].res.ok, true, send.sent[0].res.error);
        assert.equal(send.sent[0].res.data.indicators, 12);
    });

    test('недополученный длинный запрос остаётся без ответа', () => {
        const send  = sink();
        const parts = chunks({ id: 6, op: 'profile.get' }, 901, 8);
        parts.slice(0, -1).forEach(p => serial.handleFrame(p, send));
        assert.equal(send.sent.length, 0, 'отвечать не на что — запрос не собрался');
    });

    test('повтор запроса по линии отдаёт прежний ответ, не выполняя заново', () => {
        const send = sink();
        const frame = { req: { id: 7, op: 'profile.create', data: { name: 'Дубль' } } };
        serial.handleFrame(frame, send);
        serial.handleFrame(frame, send);

        assert.equal(send.sent.length, 2, 'ответ на каждый запрос');
        assert.equal(send.sent[1].res.repeat, true);
        assert.equal(db.getProfiles().filter(p => p.name === 'Дубль').length, 1);
    });
});

describe('RS-485: что ответа не требует', () => {
    test('своё эхо пропускается и не считается кадром', () => {
        const before = serial.status().framesOk;
        const send   = sink();
        serial.handleFrame({ res: { id: 1, ok: true, data: {} } }, send);

        assert.equal(send.sent.length, 0, 'на свой же ответ отвечать нечего');
        assert.equal(serial.status().framesOk, before, 'эхо не учтено как принятый кадр');
    });

    test('запись данных ответа не получает: поток односторонний', () => {
        const send = sink();
        serial.handleFrame({ recNo: 1, depth: 10, time: 0, params: { 1: 2 } }, send);
        assert.equal(send.sent.length, 0);
    });

    test('уведомление о состоянии потока ответа не получает', () => {
        const send = sink();
        serial.handleFrame({ state: { running: false, reason: 'настройка табло' } }, send);
        assert.equal(send.sent.length, 0);
    });
});

describe('RS-485: передача при закрытом порте', () => {
    test('ответ в закрытый порт не теряет сервер, а считается ошибкой передачи', async () => {
        const before = serial.status().sendErrors;
        const ok     = await serial.sendFrame({ res: { id: 1, ok: true } });
        assert.equal(ok, false);
        assert.equal(serial.status().sendErrors, before + 1);
    });
});

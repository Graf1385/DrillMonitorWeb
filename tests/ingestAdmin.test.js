'use strict';
// Изолированная БД в памяти — ДО require('../server/db')
process.env.DB_PATH = ':memory:';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const db          = require('../server/db');
const ingestAdmin = require('../server/ingestAdmin');
const netConfig   = require('../server/netConfig');


describe('ingest.ingestRecord', () => {
    test('значения параметров табло не подменяет — что прислали, то и показывает', () => {
        const ingest = require('../server/ingest');
        // Поле depth записи больше не затирает параметр с «глубинным» именем:
        // данные готовит Loader, второй раз их преобразовывать нельзя
        let got = null;
        const sse = require('../server/sse');
        const orig = sse.broadcast;
        sse.broadcast = (ev, data) => { if (ev === 'drill-data') got = data; };
        try {
            assert.equal(ingest.ingestRecord({ recNo: 1, depth: 1500, time: 0, params: { 904: 7.5 } }), null);
        } finally { sse.broadcast = orig; }

        assert.equal(got.params['904'], 7.5, 'значение осталось таким, каким пришло');
        assert.equal(got.depth, 1500, 'глубина записи передаётся отдельным полем');
    });
});

describe('ingestAdmin.ingestAuth', () => {
    test('задаёт пароль admin — без него Loader не войдёт по TCP', () => {
        assert.equal(ingestAdmin.ingestAuth({ user: 'admin', password: 'lineSetPass' }), null);
        assert.ok(db.verifyUser('admin', 'lineSetPass'), 'монитор принимает новый пароль');
    });

    test('без имени пользователя берётся admin', () => {
        assert.equal(ingestAdmin.ingestAuth({ password: 'defaultUser1' }), null);
        assert.ok(db.verifyUser('admin', 'defaultUser1'));
    });

    test('короткий пароль отклоняется, старый остаётся рабочим', () => {
        ingestAdmin.ingestAuth({ password: 'прежний пароль' });
        assert.match(ingestAdmin.ingestAuth({ password: '12' }), /короче/i);
        assert.ok(db.verifyUser('admin', 'прежний пароль'));
    });

    test('неизвестный пользователь отклоняется', () => {
        assert.match(ingestAdmin.ingestAuth({ user: 'driller', password: 'whatever' }), /нет пользователя/i);
    });

    test('не кадр — не пароль', () => {
        assert.match(ingestAdmin.ingestAuth(null), /формат/i);
    });
});

describe('netConfig.validate', () => {
    test('принимает DHCP без адресов', () => {
        assert.deepEqual(netConfig.validate({ mode: 'dhcp' }), { mode: 'dhcp' });
    });

    test('принимает корректный статический адрес', () => {
        const s = netConfig.validate({ mode: 'static', address: '10.10.10.250', prefix: '24' });
        assert.deepEqual(s, { mode: 'static', address: '10.10.10.250', prefix: 24 });
    });

    test('шлюз и DNS от старых версий Loader игнорируются, а не ломают кадр', () => {
        const s = netConfig.validate({ mode: 'static', address: '192.168.1.5', prefix: 24,
                                       gateway: '192.168.1.1', dns: '8.8.8.8' });
        assert.deepEqual(s, { mode: 'static', address: '192.168.1.5', prefix: 24 });
    });

    const bad = [
        ['режим',   { mode: 'bridge' },                                      /режим/i],
        ['адрес',   { mode: 'static', address: '10.10.10',     prefix: 24 }, /IP-адрес/i],
        ['октет',   { mode: 'static', address: '10.10.10.999', prefix: 24 }, /IP-адрес/i],
        ['маска',   { mode: 'static', address: '10.10.10.5',   prefix: 99 }, /маск/i],
    ];
    bad.forEach(([what, body, re]) => {
        test('отклоняет: ' + what, () => {
            assert.throws(() => netConfig.validate(body), re);
        });
    });
});

describe('ingestAdmin.ingestSerial', () => {
    test('не даёт выключить приём командой по той же линии', () => {
        const err = ingestAdmin.ingestSerial({ enabled: false });
        assert.match(err || '', /веб-интерфейс/i);
    });

    test('отклоняет недопустимую скорость', () => {
        const err = ingestAdmin.ingestSerial({ enabled: true, baud: 12345 });
        assert.match(err || '', /скорост/i);
    });

    test('повтор тех же настроек — не ошибка и не перезапуск', () => {
        const serialSource = require('../server/serialSource');
        const cur = serialSource.getSettings();
        const err = ingestAdmin.ingestSerial({ enabled: true, port: cur.port, baud: cur.baud });
        assert.equal(err, null);
    });

    test('отклоняет неверный формат', () => {
        assert.match(ingestAdmin.ingestSerial(null) || '', /формат/i);
    });
});

describe('ingestAdmin.ingestNetwork', () => {
    test('отклоняет неверный формат и неверные адреса', () => {
        assert.match(ingestAdmin.ingestNetwork(null) || '', /формат/i);
        assert.match(ingestAdmin.ingestNetwork({ mode: 'static', address: 'x' }) || '', /IP-адрес/i);
    });
});

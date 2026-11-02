'use strict';
// Изолированная БД в памяти — ДО require('../server/db')
process.env.DB_PATH = ':memory:';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const db    = require('../server/db');
const alarm = require('../server/alarm');

// Тревоги решает табло по каждой записи заново (server/alarm.js). Здесь — то,
// ради чего логика переехала из браузера на сервер: состояние само себя чинит,
// история переживает перезагрузку, сохранение раскладки тревогу не рвёт.

const P_PRESS = 12;
const P_DEPTH = 53;

function ind(paramId, min, max, extra) {
    return Object.assign({
        param_id: paramId, type: 'digitalIndicator', pos_left: 0, pos_top: 0, height: 10, width: 10,
        header_text: 'Давление', header_color: '#c9d1d9', header_bg: '#161b22', header_font: 0,
        header_size: 14, format: '', value_color: '#38bdf8', value_bg: '#0d1117', value_font: 0,
        value_size: 48, range_min: 0, range_max: 400, alarm_enabled: 1, alarm_min: min,
        alarm_max: max, alarm_color: '#ff0000', units: '', zone_colors: 0, ticker_speed: 12,
        value_bg_opacity: 0, extra_data: null,
    }, extra || {});
}

function layout(list) {
    db.saveIndicators(db.getActiveProfile().id, list);
}

function record(values) {
    return { recNo: 1, depth: 0, time: 0, params: new Map(Object.entries(values).map(([k, v]) => [Number(k), v])) };
}

function active() { return alarm.snapshot().alarms; }

describe('alarm', () => {
    beforeEach(() => {
        alarm._reset();
        layout([ind(P_PRESS, null, 250)]);
    });

    test('в норме тревоги нет', () => {
        alarm.onRecord(record({ [P_PRESS]: 200 }));
        assert.equal(active().length, 0);
        assert.equal(alarm.snapshot().speaker, false);
    });

    test('выход за порог поднимает тревогу и звук, возврат — снимает', () => {
        alarm.onRecord(record({ [P_PRESS]: 260 }));
        assert.equal(active().length, 1);
        assert.equal(active()[0].key, alarm.keyOf(P_PRESS, null, 250));
        assert.equal(alarm.snapshot().speaker, true);

        alarm.onRecord(record({ [P_PRESS]: 240 }));
        assert.equal(active().length, 0);
        assert.equal(alarm.snapshot().speaker, false);
    });

    test('потерянная запись ничего не ломает: следующая пересчитывает заново', () => {
        alarm.onRecord(record({ [P_PRESS]: 260 }));
        // «Конца тревоги» нет как события — есть следующее значение
        alarm.onRecord(record({ [P_PRESS]: 100 }));
        assert.equal(active().length, 0);
    });

    test('прочерк (null) и отсутствие параметра состояние не меняют', () => {
        alarm.onRecord(record({ [P_PRESS]: 260 }));
        alarm.onRecord(record({ [P_PRESS]: null }));
        alarm.onRecord(record({ [P_DEPTH]: 1500 }));
        assert.equal(active().length, 1, 'тревога держится, пока нет нового значения');

        alarm._reset();
        alarm.onRecord(record({ [P_PRESS]: null }));
        assert.equal(active().length, 0, 'прочерк не поднимает тревогу');
    });

    test('квитирование глушит звук, свет остаётся до возврата в норму', () => {
        alarm.onRecord(record({ [P_PRESS]: 260 }));
        assert.equal(alarm.ack(alarm.keyOf(P_PRESS, null, 250)), true);
        const s = alarm.snapshot();
        assert.equal(s.alarms.length, 1);
        assert.equal(s.alarms[0].acked, true);
        assert.equal(s.speaker, false);
        assert.equal(alarm.ack(), false, 'повторное квитирование ничего не делает');
    });

    test('сохранение той же раскладки (новые id строк) тревогу не рвёт', () => {
        alarm.onRecord(record({ [P_PRESS]: 260 }));
        const before = db.alarmCount();
        layout([ind(P_PRESS, null, 250)]);           // как «Сохранить» из Loader
        alarm.onRecord(record({ [P_PRESS]: 265 }));
        assert.equal(active().length, 1);
        assert.equal(db.alarmCount(), before, 'новой строки в истории нет');
    });

    test('убрали порог — тревога заканчивается с причиной', () => {
        alarm.onRecord(record({ [P_PRESS]: 260 }));
        layout([ind(P_PRESS, null, null, { alarm_enabled: 0 })]);
        alarm.onRecord(record({ [P_PRESS]: 260 }));
        assert.equal(active().length, 0);
        assert.equal(db.alarmRecent(1)[0].end_reason, 'порог убран из профиля');
    });

    test('история: начало, худшее значение, квитирование, конец', () => {
        alarm.onRecord(record({ [P_PRESS]: 260 }));
        alarm.onRecord(record({ [P_PRESS]: 300 }));
        alarm.onRecord(record({ [P_PRESS]: 280 }));
        alarm.ack();
        alarm.onRecord(record({ [P_PRESS]: 200 }));

        const h = alarm.history(1)[0];
        assert.equal(h.startValue, 260);
        assert.equal(h.extreme, 300);
        assert.equal(h.endValue, 200);
        assert.equal(h.endReason, 'норма');
        assert.ok(h.ackedAt);
        assert.equal(h.active, false);
    });

    test('нижний порог: худшее — самое низкое', () => {
        layout([ind(P_PRESS, 50, null)]);
        alarm.onRecord(record({ [P_PRESS]: 40 }));
        alarm.onRecord(record({ [P_PRESS]: 10 }));
        alarm.onRecord(record({ [P_PRESS]: 30 }));
        assert.equal(alarm.history(1)[0].extreme, 10);
    });

    test('два индикатора одного параметра с одними порогами — одна тревога', () => {
        layout([ind(P_PRESS, null, 250), ind(P_PRESS, null, 250, { type: 'linearIndicator' })]);
        alarm.onRecord(record({ [P_PRESS]: 260 }));
        assert.equal(active().length, 1);
    });

    test('оповещатель выбран, но не отвечает — звук идёт через динамик', () => {
        const id = db.getActiveProfile().id;
        db.updateProfile(id, '#000000', 20, null, 50, 2, 0, 0, 20, '0', 'annunciator');
        alarm.onRecord(record({ [P_PRESS]: 260 }));
        const s = alarm.snapshot();
        assert.equal(s.output, 'annunciator');
        assert.equal(s.fallback, true);
        assert.equal(s.speaker, true, 'без платы звук не пропадает');
        db.updateProfile(id, '#000000', 20, null, 50, 2, 0, 0, 20, '0', 'speaker');
    });

    test('профиль без настройки звука остаётся при прежней', () => {
        const id = db.getActiveProfile().id;
        db.updateProfile(id, '#000000', 20, null, 50, 2, 0, 0, 20, '0', 'annunciator');
        db.updateProfile(id, '#000000', 20, null, 50, 2, 0, 0, 20, '0');
        assert.equal(db.getProfile(id).alarm_output, 'annunciator');
        db.updateProfile(id, '#000000', 20, null, 50, 2, 0, 0, 20, '0', 'speaker');
    });
});

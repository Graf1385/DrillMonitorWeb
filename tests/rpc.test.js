'use strict';
// Изолированная БД в памяти — ДО require('../server/db')
process.env.DB_PATH = ':memory:';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const db     = require('../server/db');
const rpc    = require('../server/rpc');

// Канал по умолчанию — линия: входа в систему на ней нет и быть не может
const LINE = { channel: 'rs485' };
const TCP  = { channel: 'tcp', authed: false };
const TCP_AUTHED = { channel: 'tcp', authed: true };

let _id = 1;
function call(op, data, ctx) {
    return rpc.handle({ id: _id++, op: op, data: data }, ctx || LINE);
}

beforeEach(() => rpc.reset());

describe('rpc: словарь обменов', () => {
    test('profile.get отдаёт состояние табло одним ответом', () => {
        const res = call('profile.get');
        assert.equal(res.ok, true, res.error);
        const d = res.data;
        assert.ok(d.version, 'версия программы табло');
        assert.ok(d.profile && d.profile.name, 'активный профиль');
        assert.ok(Array.isArray(d.indicators), 'раскладка');
        assert.ok(Array.isArray(d.profiles) && d.profiles.length, 'список профилей');
        assert.ok(d.profiles.some(p => p.active), 'в списке отмечен активный');
        assert.ok(Array.isArray(d.fonts),  'справочник шрифтов');
        assert.ok(Array.isArray(d.sounds), 'справочник звуков');
    });

    test('смена профиля не возит справочники: они общие и не меняются', () => {
        const res = call('profile.select', { name: db.getActiveProfile().name });
        assert.equal(res.ok, true, res.error);
        assert.ok(res.data.profile, 'раскладка пришла');
        assert.equal(res.data.fonts,  undefined);
        assert.equal(res.data.sounds, undefined);
    });

    test('часовой пояс ездит туда и обратно без потерь', () => {
        // Пояс переезжает в настройки табло, но пока он в профиле — и обмен
        // обязан его возвращать: иначе редактор сохранит профиль без пояса
        // и затрёт на табло то, чего не показывал
        const id = db.getActiveProfile().id;
        db.updateProfile(id, '#000000', 20, null, 50, 2, 0, 0, 20, '5');

        const got = call('profile.get').data.profile;
        assert.equal(got.timezone, '5');

        assert.equal(call('profile.save', { profile: got, indicators: [] }).ok, true);
        assert.equal(db.getActiveProfile().timezone, '5');
    });

    test('неизвестный обмен — понятный отказ, а не падение', () => {
        const res = call('profile.teleport');
        assert.equal(res.ok, false);
        assert.match(res.error, /неизвестн/i);
    });

    test('запрос без номера отклоняется: отвечать было бы некому', () => {
        const res = rpc.handle({ op: 'profile.get' }, LINE);
        assert.equal(res.ok, false);
        assert.match(res.error, /номер/i);
    });

    test('мусор вместо запроса не роняет разбор', () => {
        assert.equal(rpc.handle(null, LINE).ok, false);
        assert.equal(rpc.handle('пакет', LINE).ok, false);
        assert.equal(rpc.handle({ id: 1.5, op: 'profile.get' }, LINE).ok, false);
    });
});

describe('rpc: профили', () => {
    test('create → select → save → delete', () => {
        const before = db.getActiveProfile().name;
        const made   = call('profile.create', { name: 'Бурение' });
        assert.equal(made.ok, true, made.error);
        assert.equal(made.data.created.name, 'Бурение', 'ответ говорит, каким профиль создан');
        assert.equal(db.getActiveProfile().name, before,
                     'на экране прежний профиль: новый ещё собирают');
        const fresh = db.getProfiles().find(p => p.name === 'Бурение');
        assert.deepEqual(db.getIndicatorsByProfile(fresh.id), [], 'новый профиль пустой');

        const saved = call('profile.save', {
            profile: { name: 'Бурение', background: '#102030', cellSize: 25,
                       wsWidth: 1920, wsHeight: 1080 },
            indicators: [{ param_id: 44, type: 'tankIndicator', pos_left: 10, pos_top: 10,
                           width: 20, height: 30, header_text: 'Ёмкость' }],
        });
        assert.equal(saved.ok, true, saved.error);
        assert.equal(saved.data.indicators, 1);

        const back = call('profile.get').data;
        assert.equal(back.profile.background, '#102030');
        assert.equal(back.indicators.length, 1);
        assert.equal(back.indicators[0].header_text, 'Ёмкость');

        assert.equal(call('profile.select', { name: 'Стандартный' }).ok, true);
        assert.equal(db.getActiveProfile().name, 'Стандартный');

        const del = call('profile.delete', { name: 'Бурение' });
        assert.equal(del.ok, true, del.error);
        assert.ok(!db.getProfiles().some(p => p.name === 'Бурение'));
    });

    test('create с copyFrom повторяет раскладку образца', () => {
        call('profile.create', { name: 'Образец' });
        call('profile.save', {
            profile: { name: 'Образец', background: '#000000', cellSize: 20 },
            indicators: [{ param_id: 1, type: 'digitalIndicator' },
                         { param_id: 2, type: 'gaugeIndicator' }],
        });
        const res = call('profile.create', { name: 'Копия', copyFrom: 'Образец' });
        assert.equal(res.ok, true, res.error);
        assert.equal(res.data.created.name, 'Копия');
        const copy = db.getProfiles().find(p => p.name === 'Копия');
        assert.equal(db.getIndicatorsByProfile(copy.id).length, 2, 'раскладка образца скопирована');
        assert.equal(db.getActiveProfile().name, 'Образец', 'на экране по-прежнему образец');
    });

    test('повторное имя, пустое имя и несуществующий образец — отказ с текстом', () => {
        call('profile.create', { name: 'Занято' });
        assert.match(call('profile.create', { name: 'Занято' }).error, /уже есть/i);
        assert.match(call('profile.create', { name: '  ' }).error,     /имен/i);
        assert.match(call('profile.create', { name: 'Ещё', copyFrom: 'Нет такого' }).error, /нет/i);
    });

    test('стандартный профиль удалить нельзя', () => {
        const res = call('profile.delete', { name: 'Стандартный' });
        assert.equal(res.ok, false);
        assert.match(res.error, /стандартн/i);
        assert.ok(db.getProfiles().some(p => p.name === 'Стандартный'));
    });

    test('переключение на несуществующий профиль ничего не меняет', () => {
        const was = db.getActiveProfile().name;
        const res = call('profile.select', { name: 'Призрак' });
        assert.equal(res.ok, false);
        assert.match(res.error, /нет/i);
        assert.equal(db.getActiveProfile().name, was);
    });

    test('сохранение без часового пояса его не затирает', () => {
        call('profile.create', { name: 'Пояс' });
        const id = db.getProfiles().find(x => x.name === 'Пояс').id;
        db.updateProfile(id, '#000000', 20, null, 50, 2, 0, 0, 20, '7');   // он же активирует

        call('profile.save', {
            profile: { name: 'Пояс', background: '#222222', cellSize: 20 },
            indicators: [],
        });
        assert.equal(db.getProfiles().find(p => p.name === 'Пояс').timezone, '7',
                     'пояс остался прежним');
    });
});

describe('rpc: повтор запроса', () => {
    // Теряется не только запрос, но и ответ на него. Повторить из-за этого
    // создание профиля — значит получить второй профиль на ровном месте.
    test('тот же id с теми же данными не выполняется дважды', () => {
        const req = { id: 777, op: 'profile.create', data: { name: 'Однажды' } };
        const first  = rpc.handle(req, LINE);
        const second = rpc.handle(req, LINE);

        assert.equal(first.ok, true, first.error);
        assert.equal(second.ok, true);
        assert.equal(second.repeat, true, 'ответ отдан из памяти');
        assert.equal(db.getProfiles().filter(p => p.name === 'Однажды').length, 1);
    });

    test('другой id с теми же данными выполняется и честно отказывает', () => {
        rpc.handle({ id: 10, op: 'profile.create', data: { name: 'Дважды' } }, LINE);
        const again = rpc.handle({ id: 11, op: 'profile.create', data: { name: 'Дважды' } }, LINE);
        assert.equal(again.ok, false);
        assert.equal(again.repeat, undefined);
        assert.match(again.error, /уже есть/i);
    });

    test('тот же id с другими данными — это другой запрос', () => {
        rpc.handle({ id: 20, op: 'profile.create', data: { name: 'Первый' } }, LINE);
        const other = rpc.handle({ id: 20, op: 'profile.create', data: { name: 'Второй' } }, LINE);
        assert.equal(other.ok, true, other.error);
        assert.equal(other.repeat, undefined);
        assert.ok(db.getProfiles().some(p => p.name === 'Второй'));
    });

    test('отказ тоже запоминается: повтор не выполняет обмен заново', () => {
        const req = { id: 30, op: 'profile.delete', data: { name: 'Стандартный' } };
        assert.equal(rpc.handle(req, LINE).ok, false);
        const second = rpc.handle(req, LINE);
        assert.equal(second.ok, false);
        assert.equal(second.repeat, true);
    });
});

describe('rpc: доступ', () => {
    test('по TCP/IP опасные обмены требуют входа в систему', () => {
        call('profile.create', { name: 'Под замком' });
        const res = call('profile.delete', { name: 'Под замком' }, TCP);
        assert.equal(res.ok, false);
        assert.match(res.error, /вход/i);
        assert.ok(db.getProfiles().some(p => p.name === 'Под замком'), 'профиль на месте');

        assert.equal(call('profile.delete', { name: 'Под замком' }, TCP_AUTHED).ok, true);
    });

    test('чтение раскладки входа не требует: этим обменом Loader подключается', () => {
        assert.equal(call('profile.get', null, TCP).ok, true);
    });

    test('по RS-485 входа нет: кто добрался до линии, тот стоит у табло', () => {
        call('profile.create', { name: 'С линии' });
        assert.equal(call('profile.delete', { name: 'С линии' }, LINE).ok, true);
    });
});

describe('rpc: настройки и журнал', () => {
    test('settings.get отдаёт линию, а сеть — с понятной ошибкой, если nmcli нет', () => {
        const res = call('settings.get');
        assert.equal(res.ok, true, res.error);
        assert.ok(res.data.serial, 'настройки RS-485');
        assert.ok(Array.isArray(res.data.serial.bauds));
        assert.ok(res.data.version);
        // На машине разработчика nmcli нет — это не повод отказать во всём ответе
        assert.ok(res.data.network || res.data.networkError);
    });

    test('settings.save без разделов — отказ', () => {
        assert.match(call('settings.save', {}).error, /нечего/i);
    });

    test('log.get отдаёт журнал новыми вперёд и уважает предел', () => {
        for (let i = 0; i < 5; i++) db.createLog('Запись ' + i);
        const res = call('log.get', { limit: 3 });
        assert.equal(res.ok, true);
        assert.equal(res.data.entries.length, 3);
        assert.ok(res.data.total >= 5);
        assert.equal(res.data.entries[0].message, 'Запись 4', 'новые сверху');
        assert.ok(res.data.entries[0].time, 'время записи');
    });

    test('log.clear очищает журнал и оставляет запись о том, кто это сделал', () => {
        db.createLog('Было');
        assert.equal(call('log.clear').ok, true);
        const after = db.getLogs();
        assert.equal(after.length, 1);
        assert.match(after[0].message, /очищен/i);
    });
});

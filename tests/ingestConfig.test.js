'use strict';
// Изолированная БД в памяти — ДО require('../server/db')
process.env.DB_PATH = ':memory:';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const db     = require('../server/db');
const ingest = require('../server/ingest');

describe('ingest.ingestConfig', () => {
    test('создаёт профиль по имени и сохраняет индикаторы', () => {
        const err = ingest.ingestConfig({
            profile: { name: 'EditorTest', background: '#010203', cellSize: 25,
                       wsWidth: 1920, wsHeight: 1080, timezone: '3' },
            indicators: [
                { param_id: 0, type: 'digitalIndicator', pos_left: 40, pos_top: 40,
                  width: 200, height: 120, header_text: 'Вес', value_size: 48 },
                { param_id: 2, type: 'gaugeIndicator', pos_left: 260, pos_top: 40,
                  width: 200, height: 160, header_text: 'Давление', range_min: 0, range_max: 40 },
            ],
        });
        assert.equal(err, null);
        const p = db.getProfiles().find(x => x.name === 'EditorTest');
        assert.ok(p, 'профиль создан');
        assert.equal(p.background, '#010203');
        assert.equal(p.cell_size, 25);
        assert.equal(p.ws_width, 1920);
        assert.equal(p.ws_height, 1080);
        assert.equal(p.timezone, '3');
        assert.equal(p.is_active, 1, 'профиль активирован');

        const inds = db.getIndicatorsByProfile(p.id);
        assert.equal(inds.length, 2);
        assert.equal(inds[0].header_text, 'Вес');
        assert.equal(inds[1].type, 'gaugeIndicator');
        assert.equal(inds[1].range_max, 40);
    });

    test('upsert по имени: второй вызов заменяет индикаторы, профиль один', () => {
        ingest.ingestConfig({ profile: { name: 'UpsertX', background: '#000', cellSize: 20 },
                              indicators: [{ param_id: 0, type: 'digitalIndicator' }] });
        ingest.ingestConfig({ profile: { name: 'UpsertX', background: '#111', cellSize: 30 },
                              indicators: [{ param_id: 1, type: 'tankIndicator' },
                                           { param_id: 2, type: 'gaugeIndicator' }] });
        const matches = db.getProfiles().filter(x => x.name === 'UpsertX');
        assert.equal(matches.length, 1, 'профиль не продублировался');
        assert.equal(matches[0].background, '#111');
        assert.equal(matches[0].cell_size, 30);
        assert.equal(db.getIndicatorsByProfile(matches[0].id).length, 2);
    });

    test('нормализует boolean и пропущенные поля (без ошибки bind)', () => {
        const err = ingest.ingestConfig({
            profile: { name: 'NormTest', background: '#000', cellSize: 20 },
            indicators: [{ type: 'digitalIndicator', alarm_enabled: true, zone_colors: true }],
        });
        assert.equal(err, null);
        const p    = db.getProfiles().find(x => x.name === 'NormTest');
        const inds = db.getIndicatorsByProfile(p.id);
        assert.equal(inds[0].alarm_enabled, 1);
        assert.equal(inds[0].zone_colors, 1);
        assert.equal(inds[0].param_id, null);
        assert.equal(inds[0].header_color, '#c9d1d9'); // дефолт
    });

    test('дробные проценты позиции/размера не округляются', () => {
        // Монитор хранит раскладку в процентах рабочего поля (items.js:966-969)
        const err = ingest.ingestConfig({
            profile: { name: 'PctTest', background: '#000', cellSize: 20 },
            indicators: [{
                param_id: 0, type: 'digitalIndicator',
                pos_left: 38.7890625, pos_top: 11.348057882711348,
                width: 15.1953125, height: 10.814927646610816,
            }],
        });
        assert.equal(err, null);
        const p  = db.getProfiles().find(x => x.name === 'PctTest');
        const it = db.getIndicatorsByProfile(p.id)[0];
        assert.equal(it.pos_left, 38.7890625);
        assert.equal(it.pos_top,  11.348057882711348);
        assert.equal(it.width,    15.1953125);
        assert.equal(it.height,   10.814927646610816);
    });

    test('отклоняет неверные полезные нагрузки', () => {
        assert.match(ingest.ingestConfig(null)                                   || '', /формат/i);
        assert.match(ingest.ingestConfig({})                                     || '', /профил/i);
        assert.match(ingest.ingestConfig({ profile: {} })                        || '', /имен/i);
        assert.match(ingest.ingestConfig({ profile: { name: 'Без списка' } })    || '', /индикатор/i);
    });
});

describe('ingest.ingestConfig: быстрое переключение профиля', () => {
    // Профили лежат на табло, поэтому переключение — это одно имя, а не
    // пересылка всей раскладки (по RS-485 это были бы секунды эфира).
    const mk = (name) => ingest.ingestConfig({
        profile: { name, background: '#101010', cellSize: 20, wsWidth: 1280, wsHeight: 720 },
        indicators: [{ param_id: 1, type: 'digitalIndicator', pos_left: 1, pos_top: 1, width: 10, height: 10 }],
    });

    test('делает активным уже сохранённый профиль', () => {
        assert.equal(mk('Смена А'), null);
        assert.equal(mk('Смена Б'), null);
        assert.equal(db.getActiveProfile().name, 'Смена Б', 'последняя загрузка активна');

        assert.equal(ingest.ingestConfig({ profile: { name: 'Смена А' }, select: true }), null);
        assert.equal(db.getActiveProfile().name, 'Смена А');

        // Раскладка профиля при переключении не трогается
        const prof = db.getProfiles().find(p => p.name === 'Смена А');
        assert.equal(db.getIndicatorsByProfile(prof.id).length, 1);
    });

    test('неизвестное имя — понятная ошибка, активный профиль прежний', () => {
        const before = db.getActiveProfile().name;
        assert.match(ingest.ingestConfig({ profile: { name: 'Нет такого' }, select: true }) || '', /нет|не найден/i);
        assert.equal(db.getActiveProfile().name, before);
    });
});

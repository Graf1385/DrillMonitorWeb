'use strict';
// Изолированная БД в памяти и свой файл настроек — ДО require('../server/*')
process.env.DB_PATH = ':memory:';
process.env.BOARD_SETTINGS_FILE =
    require('path').join(require('os').tmpdir(), 'dm-board-settings-' + process.pid + '.json');

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const db     = require('../server/db');
const boardSettings = require('../server/boardSettings');

function forget() {
    boardSettings.reset();
    try { fs.unlinkSync(boardSettings.FILE); } catch (_) {}
}

beforeEach(forget);
after(forget);

describe('boardSettings', () => {
    test('первое чтение наследует пояс активного профиля', () => {
        const id = db.getActiveProfile().id;
        db.updateProfile(id, '#000000', 20, null, 50, 2, 0, 0, 20, '7');

        assert.equal(boardSettings.read().timezone, '7');
        assert.ok(fs.existsSync(boardSettings.FILE), 'значение закреплено за табло');
    });

    test('дальше пояс живёт своей жизнью: смена профиля его не трогает', () => {
        const id = db.getActiveProfile().id;
        db.updateProfile(id, '#000000', 20, null, 50, 2, 0, 0, 20, '7');
        assert.equal(boardSettings.read().timezone, '7');

        // На табле появился профиль с другим поясом в столбце — часы те же
        const other = db.createProfile('Ночная', '#000000', 20).lastInsertRowid;
        db.updateProfile(other, '#000000', 20, null, 50, 2, 0, 0, 20, '2');
        boardSettings.reset();   // как после перезапуска табла

        assert.equal(boardSettings.read().timezone, '7');
    });

    test('сохранение принимает целые часы и отвергает всё прочее', () => {
        assert.equal(boardSettings.save({ timezone: '5' }), null);
        assert.equal(boardSettings.read().timezone, '5');

        assert.equal(boardSettings.save({ timezone: -12 }), null);
        assert.equal(boardSettings.read().timezone, '-12');

        assert.match(boardSettings.save({ timezone: '13' })      || '', /часов/i);
        assert.match(boardSettings.save({ timezone: '-13' })     || '', /часов/i);
        assert.match(boardSettings.save({ timezone: 'москва' })  || '', /часов/i);
        assert.match(boardSettings.save({ timezone: '' })        || '', /часов/i);
        assert.equal(boardSettings.read().timezone, '-12', 'неудача ничего не меняет');
    });

    test('сохранение переживает перезапуск', () => {
        boardSettings.save({ timezone: '3' });
        boardSettings.reset();
        assert.equal(boardSettings.read().timezone, '3');
    });

    test('пустой запрос и мусор не роняют табло', () => {
        assert.match(boardSettings.save(null) || '', /формат/i);
        assert.equal(boardSettings.save({}), null, 'нечего менять — и не меняем');
    });
});

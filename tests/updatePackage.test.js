'use strict';
// Изолированная БД в памяти — ДО require('../server/db')
process.env.DB_PATH = ':memory:';

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const { execFileSync } = require('child_process');

const updatePackage = require('../server/updatePackage');

// Проверяем разбор архива: распаковка на диск и перезагрузка устройства в
// тестах недопустимы, а вся опасная часть (пути, подмена базы, смена
// зависимостей) решается до неё.

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-upd-test-'));
after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} });

// package.json проекта лежит с BOM — читаем так же, как это делает updatePackage
const deps = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8').replace(/^﻿/, '')
).dependencies;

/// Собрать tar.gz из карты {путь: содержимое} и вернуть имя файла.
let _n = 0;
function pack(files) {
    const dir = path.join(tmp, 'pkg' + (++_n));
    Object.keys(files).forEach((rel) => {
        const full = path.join(dir, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, files[rel]);
    });
    const out = path.join(tmp, 'pkg' + _n + '.tgz');
    execFileSync('tar', ['-czf', out, '-C', dir].concat(Object.keys(files)), { timeout: 60000 });
    return out;
}

const pkgJson = (version, d) => JSON.stringify({ name: 'drillmonitorweb', version, dependencies: d || deps });

describe('updatePackage.inspect', () => {
    test('принимает пакет программы без верхнего каталога', () => {
        const info = updatePackage.inspect(pack({
            'package.json':    pkgJson('9.9.9'),
            'app.js':          'require("./server/server");',
            'server/server.js': '// сервер',
        }));
        assert.equal(info.error, undefined);
        assert.equal(info.strip, 0);
        assert.equal(info.version, '9.9.9');
        assert.equal(info.withModules, false);
    });

    test('снимает верхний каталог архива GitHub', () => {
        const info = updatePackage.inspect(pack({
            'Graf1385-DrillMonitorWeb-9f3c1a2/package.json':     pkgJson('9.9.9'),
            'Graf1385-DrillMonitorWeb-9f3c1a2/server/server.js': '// сервер',
        }));
        assert.equal(info.error, undefined);
        assert.equal(info.strip, 1);
        assert.equal(info.version, '9.9.9');
    });

    test('видит зависимости в пакете', () => {
        const info = updatePackage.inspect(pack({
            'package.json':                   pkgJson('9.9.9', { express: '^9.0.0' }),
            'server/server.js':               '// сервер',
            'node_modules/express/index.js':  'module.exports = {};',
        }));
        assert.equal(info.error, undefined);
        assert.equal(info.withModules, true);
    });

    test('отклоняет смену зависимостей без node_modules — ставить их нечем', () => {
        const info = updatePackage.inspect(pack({
            'package.json':     pkgJson('9.9.9', { express: '^9.9.9', 'left-pad': '^1.0.0' }),
            'server/server.js': '// сервер',
        }));
        assert.match(info.error, /зависимост/i);
    });

    test('рабочее состояние табло из пакета не ставится', () => {
        const info = updatePackage.inspect(pack({
            'package.json':                        pkgJson('9.9.9'),
            'server/server.js':                    '// сервер',
            'server/data/profiles.db':             'SQLite format 3',
            'server/data/profiles.db-wal':         'wal',
            'server/data/serial-settings.json':    '{"baud":115200}',
            'server/data/data-source-settings.json': '{}',
            'server/data/parameters.json':         '[]',
        }));
        assert.equal(info.error, undefined);
        assert.deepEqual(info.skipped.sort(), [
            'server/data/data-source-settings.json',
            'server/data/profiles.db',
            'server/data/profiles.db-wal',
            'server/data/serial-settings.json',
        ]);
        assert.ok(!info.skipped.includes('server/data/parameters.json'),
                  'справочник из релиза ставится как обычный файл');
    });

    test('то же в архиве с верхним каталогом', () => {
        const info = updatePackage.inspect(pack({
            'DrillMonitorWeb-1/package.json':                     pkgJson('9.9.9'),
            'DrillMonitorWeb-1/server/server.js':                 '// сервер',
            'DrillMonitorWeb-1/server/data/serial-settings.json': '{"baud":115200}',
        }));
        assert.equal(info.strip, 1);
        assert.deepEqual(info.skipped, ['server/data/serial-settings.json']);
    });

    test('отклоняет посторонний архив', () => {
        const info = updatePackage.inspect(pack({ 'readme.txt': 'не тот пакет' }));
        assert.match(info.error, /не пакет DrillMonitorWeb/i);
    });

    test('отклоняет испорченный package.json', () => {
        const info = updatePackage.inspect(pack({
            'package.json':     '{ это не json',
            'server/server.js': '// сервер',
        }));
        assert.match(info.error, /package\.json/i);
    });

    test('не читается — не применяется', () => {
        const bad = path.join(tmp, 'broken.tgz');
        fs.writeFileSync(bad, Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00]));
        assert.match(updatePackage.inspect(bad).error, /прочитать архив/i);
    });
});

describe('updatePackage.ingestUpdate', () => {
    test('кадр без данных отклоняется', () => {
        assert.match(updatePackage.ingestUpdate({}), /нет данных/i);
        assert.match(updatePackage.ingestUpdate(null), /формат/i);
    });

    test('недосчитанный размер ловится до распаковки', () => {
        const err = updatePackage.ingestUpdate({
            data: Buffer.from('кусок пакета').toString('base64'),
            size: 999999,
        });
        assert.match(err, /не целиком/i);
    });

    test('несовпадение контрольной суммы ловится до распаковки', () => {
        const err = updatePackage.ingestUpdate({
            data:   Buffer.from('кусок пакета').toString('base64'),
            sha256: '0'.repeat(64),
        });
        assert.match(err, /контрольная сумма/i);
    });
});

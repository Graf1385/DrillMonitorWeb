'use strict';
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('node:fs');
const os   = require('node:os');
const path = require('node:path');

const diag = require('../server/selfCheck');

// Все часы и подсистемы подменяем: проверки должны быть воспроизводимы и не
// зависеть ни от реального времени, ни от железа машины, на которой идут тесты.
let clock, logs, env;

function setup() {
    clock = 0;
    logs  = [];
    env = {
        serial: {
            enabled: true, open: true, port: '/dev/ttyCH343', activePort: '/dev/ttyCH343',
            baud: 57600, error: null, framesOk: 10, framesBad: 0,
            openMs: 60000, silenceMs: 1000, reopens: 0,
        },
        push: true, running: true,
        statfs:  { bavail: 500000, bsize: 4096, blocks: 1000000 },   // ~2 ГБ из 4 ГБ
        memory:  { available: 800 * 1024 * 1024, total: 2048 * 1024 * 1024 },
        streams: [],
        now: 1760000000000,          // 2025-10-09
        reopens: 0, cleans: 0,
    };

    diag._reset();
    diag._setDeps({
        mono:         () => clock,
        now:          () => env.now,
        log:          (m) => logs.push(m),
        serial:       () => env.serial,
        pushMode:     () => env.push,
        runState:     () => ({ running: env.running }),
        streams:      () => env.streams,
        statfs:       () => env.statfs,
        memory:       () => env.memory,
        reopenSerial: () => { env.reopens++; },
        cleanDisk:    () => { env.cleans++; },
    });
}

/// Прогнать проверки так, как их гоняет таймер: раз в пять секунд
function run(ms) {
    for (let t = 0; t < ms; t += 5000) { clock += 5000; diag.tick(); }
}

function find(re) { return logs.filter((l) => re.test(l)); }
function check(id) { return diag.snapshot().checks.find((c) => c.id === id); }

describe('selfCheck: журнал переходов', () => {
    beforeEach(setup);

    test('пока всё в порядке, в журнал не попадает ничего', () => {
        run(60000);
        assert.deepEqual(logs, []);
    });

    test('постоянная неисправность — одна запись, а не строка в пять секунд', () => {
        env.serial.open = false;
        env.serial.error = 'порт /dev/ttyCH343 не найден';
        env.push = false;
        run(10 * 60 * 1000);
        assert.equal(find(/RS-485/).length, 1, 'ожидалась ровно одна запись о порте');
        assert.match(logs[0], /не найден/);
    });

    test('восстановление записывается с длительностью', () => {
        env.serial.open = false;
        env.push = false;
        run(5 * 60 * 1000);
        env.serial.open = true;
        run(10000);

        const back = find(/норма/);
        assert.equal(back.length, 1);
        assert.match(back[0], /RS-485: норма/);
        assert.match(back[0], /неисправность длилась 5 мин/);
    });

    test('сбой короче выдержки в журнал не попадает', () => {
        env.serial.open = false;
        env.push = false;
        run(5000);                 // 5 с — меньше выдержки в 10 с
        env.serial.open = true;
        run(30000);
        assert.deepEqual(logs, [], 'мигание не должно засорять журнал');
    });

    test('неисправность при запуске проходит ту же выдержку и попадает в журнал', () => {
        env.serial.open = false;
        env.push = false;
        diag.tick();               // первый замер — уже неисправность
        assert.deepEqual(logs, [], 'сразу писать нельзя: USB перечисляется медленнее службы');
        run(20000);
        assert.equal(find(/RS-485/).length, 1);
    });
});

describe('selfCheck: RS-485', () => {
    beforeEach(setup);

    test('закрытый порт — неисправность, когда других источников данных нет', () => {
        env.serial.open = false;
        env.push = false;
        run(20000);
        assert.equal(check('serial').level, 'fail');
    });

    test('закрытый порт при живом приёме по сети — только предупреждение', () => {
        env.serial.open = false;
        env.push = true; env.running = true;
        run(20000);
        assert.equal(check('serial').level, 'warn');
    });

    test('выключенный в настройках приём не считается неисправностью', () => {
        env.serial.enabled = false;
        run(20000);
        assert.equal(check('serial').level, 'off');
        assert.deepEqual(logs, []);
    });

    test('порт открыт, но кадров не было ни одного — предупреждение', () => {
        env.serial.silenceMs = null;
        env.serial.openMs    = 3 * 60 * 1000;
        env.push = false;
        run(20000);
        assert.equal(check('serial').level, 'warn');
        assert.match(check('serial').detail, /кадров не было/);
    });

    test('кадров не было, но данные идут по сети — линия просто не используется', () => {
        env.serial.silenceMs = null;
        env.serial.openMs    = 3 * 60 * 1000;
        env.push = true; env.running = true;
        run(20000);
        assert.equal(check('serial').level, 'off');
        assert.match(check('serial').detail, /данные идут по сети/);
    });

    test('молчание линии при живом приёме по сети не делает табло неисправным', () => {
        // Передача по TCP/IP: приём по линии включён в настройках, но ею никто
        // не пользуется. Это не отказ, и дёргать порт незачем.
        env.serial.silenceMs = 6 * 60 * 1000;
        env.push = true; env.running = true;
        run(60 * 60 * 1000);
        assert.equal(check('serial').level, 'off');
        assert.equal(env.reopens, 0, 'переоткрывать порт, в который никто не пишет, незачем');
        assert.notEqual(diag.snapshot().level, 'fail');
    });

    test('работа с запасного узла видна в сводке', () => {
        env.serial.activePort = '/dev/ttyACM1';
        run(10000);
        assert.match(check('serial').detail, /ttyACM1 \(вместо \/dev\/ttyCH343\)/);
    });

    test('молчание линии переоткрывает порт, но не чаще раза в десять минут', () => {
        env.serial.silenceMs = 6 * 60 * 1000;
        env.running = false;            // линия и есть транспорт — данных нет вовсе
        run(10000);
        assert.equal(env.reopens, 1, 'первое переоткрытие сразу');
        run(9 * 60 * 1000);
        assert.equal(env.reopens, 1, 'раньше десяти минут повторять незачем');
        run(2 * 60 * 1000);
        assert.equal(env.reopens, 2);
        assert.equal(find(/Самовосстановление/).length, 2);
    });

    test('не помогло трижды — порт больше не дёргаем', () => {
        env.serial.silenceMs = 6 * 60 * 1000;
        env.running = false;
        run(60 * 60 * 1000);            // час молчания: Loader просто выключен
        assert.equal(env.reopens, 3, 'трёх попыток достаточно');
    });

    test('после возвращения данных попытки отсчитываются заново', () => {
        env.serial.silenceMs = 6 * 60 * 1000;
        env.running = false;
        run(60 * 60 * 1000);
        env.serial.silenceMs = 1000;    // кадры пошли
        run(10000);
        env.serial.silenceMs = 6 * 60 * 1000;
        run(10000);
        assert.equal(env.reopens, 4);
    });
});

describe('selfCheck: данные, диск, память, часы', () => {
    beforeEach(setup);

    test('обрыв данных записывается и подтверждается выдержкой', () => {
        env.running = false;
        run(10000);
        assert.deepEqual(logs, [], 'пятнадцатисекундная выдержка ещё не прошла');
        run(20000);
        assert.equal(check('data').level, 'fail');
        assert.equal(find(/Поступление данных/).length, 1);
    });

    test('до первых данных источник не считается неисправным', () => {
        env.push = false; env.running = false;
        env.serial.enabled = false;
        run(60000);
        assert.equal(check('data').level, 'off');
        assert.deepEqual(logs, []);
    });

    test('переполненный диск чистится сам, но не чаще раза в час', () => {
        env.statfs = { bavail: 5000, bsize: 4096, blocks: 1000000 };   // ~20 МБ из 4 ГБ
        run(10000);
        assert.equal(check('disk').level, 'fail');
        assert.equal(env.cleans, 1);
        run(30 * 60 * 1000);
        assert.equal(env.cleans, 1);
        run(31 * 60 * 1000);
        assert.equal(env.cleans, 2);
    });

    test('место на исходе — предупреждение без уборки', () => {
        env.statfs = { bavail: 50000, bsize: 4096, blocks: 1000000 };  // ~200 МБ из 4 ГБ
        run(10000);
        assert.equal(check('disk').level, 'warn');
        assert.equal(env.cleans, 0);
    });

    test('нехватка оперативной памяти — предупреждение', () => {
        env.memory = { available: 100 * 1024 * 1024, total: 2048 * 1024 * 1024 };
        run(60000);
        assert.equal(check('memory').level, 'warn');
    });

    test('невыставленные часы видны в диагностике', () => {
        env.now = 1600000000000;   // 2020 — RTC не держит время, NTP в сети нет
        run(10000);
        assert.equal(check('clock').level, 'warn');
        assert.match(check('clock').detail, /часы не выставлены/);
    });

    test('упавший видеопоток — предупреждение с именем потока', () => {
        env.streams = [{ key: 'cam1', running: false, restarts: 3 },
                       { key: 'cam2', running: true,  restarts: 0 }];
        run(20000);
        assert.equal(check('video').level, 'warn');
        assert.match(check('video').detail, /cam1/);
    });

    // Недоступная камера: ffmpeg жив и молчит. Процесс есть — видео нет,
    // и проверка обязана говорить об этом, а не показывать «ок».
    test('живой ffmpeg без единого сегмента — предупреждение', () => {
        env.streams = [{ key: 'cam1', running: true, restarts: 0,
                         startedAt: env.now - 60000, playlistAt: 0 }];
        run(20000);
        assert.equal(check('video').level, 'warn');
        assert.match(check('video').detail, /нет кадров/);
        assert.match(check('video').detail, /cam1/);
    });

    test('только что запущенному потоку дают время на первый сегмент', () => {
        env.streams = [{ key: 'cam1', running: true, restarts: 0,
                         openedAt: env.now - 5000, startedAt: env.now - 5000, playlistAt: 0 }];
        run(20000);
        assert.equal(check('video').level, 'ok');
    });

    // Недоступная камера роняет ffmpeg каждые несколько секунд. Выдержка,
    // отсчитанная от последнего запуска, в таком потоке не истекает никогда —
    // и проверка показывала «ок», пока на экране был чёрный прямоугольник
    test('поток, который всё время перезапускается, не прячется за выдержкой', () => {
        env.streams = [{ key: 'cam1', running: true, restarts: 12,
                         openedAt: env.now - 5 * 60 * 1000, startedAt: env.now - 3000,
                         playlistAt: 0 }];
        run(20000);
        assert.equal(check('video').level, 'warn');
        assert.match(check('video').detail, /нет кадров/);
    });

    test('поток с живым плейлистом — всё в порядке', () => {
        env.streams = [{ key: 'cam1', running: true, restarts: 0,
                         startedAt: env.now - 60000, playlistAt: env.now - 1000 }];
        run(20000);
        assert.equal(check('video').level, 'ok');
        assert.match(check('video').detail, /потоков 1/);
    });

    test('плейлист перестал обновляться — поток замер', () => {
        env.streams = [{ key: 'cam1', running: true, restarts: 0,
                         startedAt: env.now - 120000, playlistAt: env.now - 40000 }];
        run(20000);
        assert.equal(check('video').level, 'warn');
        assert.match(check('video').detail, /нет кадров/);
    });
});

describe('selfCheck: сводка', () => {
    beforeEach(setup);

    test('уровень сводки — худший из проверок', () => {
        run(10000);
        assert.equal(diag.snapshot().level, 'ok');
        assert.equal(diag.snapshot().healthy, true);

        env.running = false;
        run(30000);
        assert.equal(diag.snapshot().level, 'fail');
        assert.equal(diag.snapshot().healthy, false);
    });

    test('происшествие сохраняется с длительностью', () => {
        env.serial.open = false;
        env.push = false;
        run(3 * 60 * 1000);
        env.serial.open = true;
        run(10000);

        const inc = diag.snapshot().incidents.find((i) => i.id === 'serial');
        assert.ok(inc, 'происшествие должно остаться в сводке');
        assert.equal(inc.level, 'fail');
        assert.ok(inc.endedAt, 'закрытое происшествие помечается временем окончания');
        assert.ok(inc.durationSec >= 170 && inc.durationSec <= 190, 'длительность ≈ 3 мин, получено ' + inc.durationSec);
    });

    test('самовосстановления попадают в сводку', () => {
        env.serial.silenceMs = 6 * 60 * 1000;
        env.running = false;            // линия и есть транспорт — данных нет вовсе
        run(10000);
        const r = diag.snapshot().recoveries;
        assert.equal(r.length, 1);
        assert.equal(r[0].ok, true);
        assert.match(r[0].what, /переоткрытие порта/);
    });
});

describe('selfCheck: записи внешнего сторожа', () => {
    beforeEach(setup);

    test('перезапуск, сделанный сторожем, переносится в общий журнал', () => {
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'diag-')), 'watchdog.log');
        fs.writeFileSync(file, '2026-10-23 11:20:01 сервер не отвечает — перезапуск службы\n');
        diag._setDeps({ watchdogLog: file });

        diag._ingestWatchdogLog();

        assert.equal(find(/Внешний сторож/).length, 1);
        assert.match(logs[0], /перезапуск службы/);
        assert.equal(fs.readFileSync(file, 'utf8'), '', 'файл очищается, чтобы не повторяться при каждом запуске');
    });

    test('пустого файла достаточно, чтобы ничего не записать', () => {
        const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'diag-')), 'watchdog.log');
        fs.writeFileSync(file, '\n  \n');
        diag._setDeps({ watchdogLog: file });
        diag._ingestWatchdogLog();
        assert.deepEqual(logs, []);
    });
});

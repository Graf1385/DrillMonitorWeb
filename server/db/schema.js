const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');
const pw     = require('../utils/password');

function initSchema(db) {

    // ── Profiles ─────────────────────────────────────────────────────────────

    db.exec(`
        CREATE TABLE IF NOT EXISTS profiles (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT    NOT NULL UNIQUE,
            background TEXT    NOT NULL,
            cell_size  REAL    NOT NULL,
            is_default INTEGER NOT NULL DEFAULT 0,
            is_active  INTEGER NOT NULL DEFAULT 0
        )
    `);

    try { db.exec('ALTER TABLE profiles ADD COLUMN is_active        INTEGER NOT NULL DEFAULT 0'); } catch {}
    try { db.exec('ALTER TABLE profiles ADD COLUMN alarm_sound_id  INTEGER'); } catch {}
    try { db.exec('ALTER TABLE profiles ADD COLUMN alarm_volume    INTEGER NOT NULL DEFAULT 50'); } catch {}
    try { db.exec('ALTER TABLE profiles ADD COLUMN alarm_delay     REAL    NOT NULL DEFAULT 2'); } catch {}
    try { db.exec('ALTER TABLE profiles ADD COLUMN ws_width        INTEGER NOT NULL DEFAULT 0'); } catch {}
    try { db.exec('ALTER TABLE profiles ADD COLUMN ws_height       INTEGER NOT NULL DEFAULT 0'); } catch {}
    try { db.exec('ALTER TABLE profiles ADD COLUMN sidebar_timeout INTEGER NOT NULL DEFAULT 20'); } catch {}

    db.exec('UPDATE profiles SET cell_size = ROUND(cell_size * 20) WHERE cell_size < 10');

    db.prepare(`
        INSERT OR IGNORE INTO profiles (name, background, cell_size, is_default, is_active)
        VALUES ('Стандартный', '#000000', 20, 1, 1)
    `).run();

    const hasActive = db.prepare('SELECT COUNT(*) as c FROM profiles WHERE is_active = 1').get();
    if (hasActive.c === 0) {
        db.prepare('UPDATE profiles SET is_active = 1 WHERE is_default = 1').run();
    }

    // ── Data types ────────────────────────────────────────────────────────────

    db.exec(`
        CREATE TABLE IF NOT EXISTS data_types (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            name           TEXT    NOT NULL UNIQUE,
            default_format TEXT    NOT NULL DEFAULT ''
        )
    `);

    const seedDataTypes = [
        [1, 'time',   'HH:mm:ss'],
        [2, 'float',  '0000.00'],
        [3, 'short',  '0000'],
        [4, 'string', '""'],
        [5, 'long',   '0'],
    ];
    const upsertDataType = db.prepare('INSERT OR REPLACE INTO data_types (id, name, default_format) VALUES (?, ?, ?)');
    for (const [id, name, fmt] of seedDataTypes) upsertDataType.run(id, name, fmt);

    // ── Units ─────────────────────────────────────────────────────────────────

    db.exec(`
        CREATE TABLE IF NOT EXISTS units (
            id     INTEGER PRIMARY KEY AUTOINCREMENT,
            name   TEXT NOT NULL,
            symbol TEXT NOT NULL UNIQUE
        )
    `);

    const seedUnits = [
        ['Тонна',                 'т'],
        ['Мегапаскаль',           'МПа'],
        ['Литр в секунду',        'л/с'],
        ['Оборотов в минуту',     'об/мин'],
        ['Метр в час',            'м/ч'],
        ['Метр',                  'м'],
        ['Градус Цельсия',        '°C'],
        ['Килограмм на кубометр', 'кг/м³'],
        ['Килоньютон-метр',       'кН·м'],
    ];
    const insertUnit = db.prepare('INSERT OR IGNORE INTO units (name, symbol) VALUES (?, ?)');
    for (const [name, symbol] of seedUnits) insertUnit.run(name, symbol);

    // ── Parameters ────────────────────────────────────────────────────────────

    db.exec(`
        CREATE TABLE IF NOT EXISTS parameters (
            id       INTEGER PRIMARY KEY,
            name     TEXT    NOT NULL,
            type_id  INTEGER,
            unit_id  INTEGER REFERENCES units(id) ON DELETE SET NULL,
            size     INTEGER,
            accuracy INTEGER
        )
    `);

    // Migration: drop UNIQUE constraint on name, add new columns
    {
        const paramIdxs = db.prepare('PRAGMA index_list(parameters)').all();
        const hasUnique = paramIdxs.some(i => i.origin === 'u');
        if (hasUnique) {
            db.transaction(() => {
                db.exec(`CREATE TABLE parameters_new (
                    id       INTEGER PRIMARY KEY,
                    name     TEXT    NOT NULL,
                    type_id  INTEGER,
                    unit_id  INTEGER REFERENCES units(id) ON DELETE SET NULL,
                    size     INTEGER,
                    accuracy INTEGER
                )`);
                db.exec('INSERT INTO parameters_new (id, name, type_id, unit_id) SELECT id, name, type_id, unit_id FROM parameters');
                db.exec('DROP TABLE parameters');
                db.exec('ALTER TABLE parameters_new RENAME TO parameters');
            })();
        } else {
            try { db.exec('ALTER TABLE parameters ADD COLUMN unit_id  INTEGER REFERENCES units(id) ON DELETE SET NULL'); } catch {}
            try { db.exec('ALTER TABLE parameters ADD COLUMN size     INTEGER'); } catch {}
            try { db.exec('ALTER TABLE parameters ADD COLUMN accuracy INTEGER'); } catch {}
        }
    }

    // Seed all 255 parameters from Reference table (Ref.json)
    // Format: [id, name, size, typeChar, unit, accuracy]
    // typeChar: f=float(2), i=short(3), l=long(5), s=string(4)
    const REF_TYPE = { f: 2, i: 3, l: 5, s: 4 };
    const refParams = [
        [0,   'Вес на крюке',                    4,  'f', 'т',        2],
        [1,   'Нагрузка на долото',              4,  'f', 'т',        2],
        [2,   'Давление на входе',               4,  'f', 'атм',      2],
        [3,   'Давление на выходе',              4,  'f', 'атм',      2],
        [4,   'Обороты ротора',                  4,  'f', 'х/мин',    2],
        [5,   'Момент на роторе',                4,  'f', 'Тс*м',     2],
        [6,   'Плотность на входе',              4,  'f', 'кг/м3',    2],
        [7,   'Плотность на выходе',             4,  'f', 'кг/м3',    2],
        [8,   'Температура на входе',            4,  'f', 'грС',      2],
        [9,   'Температура на выход',            4,  'f', 'грС',      2],
        [10,  'Объем рабочих емк.',              4,  'f', 'м3',       2],
        [11,  'Общий газ',                       4,  'f', '%',        2],
        [12,  'Положение крюка',                 4,  'f', 'м',        2],
        [13,  'Ходов насоса 1',                  4,  'f', 'х/сек',    0],
        [14,  'Ходов насоса 2',                  4,  'f', 'х/сек',    0],
        [15,  'Расход на выходе',                4,  'f', 'м3/сек',   2],
        [16,  'С1',                              4,  'f', 'ppm',      4],
        [17,  'С2',                              4,  'f', 'ppm',      4],
        [18,  'С3',                              4,  'f', 'ppm',      4],
        [19,  'H2',                              4,  'f', 'ppm',      4],
        [20,  'С4',                              4,  'f', 'ppm',      4],
        [21,  'С5',                              4,  'f', 'ppm',      4],
        [22,  'Мех.скорость',                    4,  'f', 'м/час',    2],
        [23,  'ДМК 2',                           4,  'f', 'сек/м',    2],
        [24,  'Интервал за рейс',                4,  'f', 'м',        2],
        [25,  'Время бурения   рейс',            4,  'f', 'сек',      2],
        [26,  'Стоимость бурения',               4,  'f', '$/m',      2],
        [27,  'DEXP',                            4,  'f', '/Pa',      2],
        [28,  'DEXC с учетом плотн.',            4,  'f', 'a',        2],
        [29,  'DEXCN износа долота',             4,  'f', '/Pa',      2],
        [30,  'Эквив.плотн.циркуляц',           4,  'f', 'кг/м3',    2],
        [31,  'Расход на входе',                 4,  'f', 'м3/сек',   2],
        [32,  'Расход разность',                 4,  'f', 'м3/сек',   2],
        [33,  'Плотность разность',              4,  'f', 'кг/м3',    2],
        [34,  'Температура разность',            4,  'f', 'грС',      2],
        [35,  'Ходов насоса    рейс',            4,  'l', 'ход',      0],
        [36,  'Оборотов долота рейс',            4,  'l', 'об',       0],
        [37,  'Отставание газов(хн)',            4,  'f', 'ход',      2],
        [38,  'Отставание газов(вр)',            4,  'f', 'сек',      2],
        [39,  'Глуб.отст.газов усте',           4,  'f', 'м',        2],
        [40,  'Отставание шлама(вр)',            4,  'f', 'сек',      2],
        [41,  'С2...С6 / С1...С6',              4,  'f', '%',        2],
        [42,  'С1...С2 / С3...С6',              4,  'f', '%',        2],
        [43,  'С4...С6 / С3',                   4,  'f', '%',        2],
        [44,  'Объем емкости 1',                4,  'f', 'м3',       2],
        [45,  'Объем емкости 2',                4,  'f', 'м3',       2],
        [46,  'Объем емкости 3',                4,  'f', 'м3',       2],
        [47,  'Объем емкости 4',                4,  'f', 'м3',       2],
        [48,  'Объем емкости 5',                4,  'f', 'м3',       2],
        [49,  'Объем емк.Долива',               4,  'f', 'м3',       2],
        [50,  'Давл.в зоне дол.СПО',           4,  'f', 'Па',       2],
        [51,  'Объем всех емкостей',            4,  'f', 'м3',       2],
        [52,  'Время сбора данных',             4,  'l', 'сек',      0],
        [53,  'Глубина Забоя',                  4,  'f', 'м',        2],
        [54,  'Глубина долота',                 4,  'f', 'м',        2],
        [55,  'Глубина вертикальная',           4,  'f', 'м',        2],
        [56,  'Отставание шлама(хн)',           4,  'f', 'ход',      2],
        [57,  'Объем затрубья',                 4,  'f', 'м3',       2],
        [58,  'Пот.давл. затрубья',             4,  'f', 'атм',      2],
        [59,  'Объем в трубах',                 4,  'f', 'м3',       2],
        [60,  'Пот.давл. в трубах',             4,  'f', 'атм',      2],
        [61,  'Скорость в насадках',            4,  'f', 'м/сек',    2],
        [62,  'Пот.давл. в насадках',           4,  'f', 'атм',      2],
        [63,  'Гидр.мощн. на долоте',          4,  'f', 'Вт',       2],
        [64,  'Гидр.мощн. на площад',          4,  'f', 'Вт/м2',    2],
        [65,  'Удар.нагр. на долото',           4,  'f', 'Н',        2],
        [66,  'Удар.нагр. на площад',          4,  'f', 'Па',       2],
        [67,  'Гидр.мощность систем',           4,  'f', 'Вт',       2],
        [68,  'Скорость оседания шл',           4,  'f', 'м/сек',    2],
        [69,  'Пот.давл. в оборуд.',            4,  'f', 'атм',      2],
        [70,  'Пот.давл. суммарные',            4,  'f', 'атм',      2],
        [71,  'Град.давл.поров:Dexp',           4,  'f', 'кг/м3',    2],
        [72,  'Над забоем',                     4,  'f', 'м m',      2],
        [73,  'Номер рейса',                    2,  'i', '',         0],
        [74,  'Глубина начала рейса',           4,  'f', 'м',        2],
        [75,  'Время начала рейса',             4,  'l', 'сек m/yy', 0],
        [76,  'Глубина подошвы Об.К',          4,  'f', 'hh:mm:ss', 2],
        [77,  'Баланс дол/выт СПО',            4,  'f', 'м3',       2],
        [78,  'Способ бурения',                 2,  'i', '',         0],
        [79,  'Расход турбины /сек',            4,  'f', 'об/м3',    2],
        [80,  'Плотность шлама',                4,  'f', 'кг/м3',    2],
        [81,  'Диаметр шлама',                  4,  'f', 'мм',       2],
        [82,  'Вязкость раствора',              4,  'f', 'Па*сек м', 2],
        [83,  'Напряжение сдвига',              4,  'f', 'Па м2',    2],
        [84,  'Град.пластового давл',           4,  'f', 'кг/м3',    2],
        [85,  'Град.горного давлен.',           4,  'f', 'кг/м3',    2],
        [86,  'Тип долота',                     12, 's', '',         0],
        [87,  'Стоимость долота',               4,  'f', '$',        2],
        [88,  'Диаметр долота',                 4,  'f', 'мм',       2],
        [89,  'Sigma:Напряжение ГП',            4,  'f', '3/ход',    2],
        [90,  'Sigma:Прочность ГП',             4,  'f', '3/ход',    2],
        [91,  'Sigma:Эталонная Прочность ГП',  4,  'f', '3/ход',    2],
        [92,  'Sigma:Пористость ГП',            4,  'f', '% /м',     2],
        [93,  'Площадь насадок',                4,  'f', 'м2',       2],
        [94,  'Производит. насоса 1',           4,  'f', 'м3/ход',   2],
        [95,  'Объем емкости 9',                4,  'f', 'м3',       2],
        [96,  'ГК (гамма-каротаж)',             4,  'f', 'API',      2],
        [97,  'Изменение Давл.на вх',           4,  'f', 'атм',      2],
        [98,  'Гидростатическое давление',      4,  'f', 'атм',      2],
        [99,  'Эффективное давление',           4,  'f', 'атм',      2],
        [100, 'Глубина выхода шлама',           4,  'f', 'м',        2],
        [101, 'Глубина забоя датчик',           4,  'f', 'м c',      2],
        [102, 'Момент на долоте',               4,  'f', 'Н*м',      2],
        [103, 'Код породы',                     2,  'i', '',         0],
        [104, 'Время СПО       рейс',           4,  'f', 'сек',      2],
        [105, 'Sigm:Град.давл.пласт',           4,  'f', 'кг/м3',    2],
        [106, 'Время на свечу',                 4,  'f', 'сек св',   2],
        [107, 'Свеч вне скважины',              2,  'i', 'шт ч',     0],
        [108, 'Свеч внутри скважины',           2,  'i', 'шт ч',     0],
        [109, 'Труб вне скважины',              2,  'i', 'шт б',     0],
        [110, 'Труб внутри скважины',           2,  'i', 'шт б',     0],
        [111, 'Труб в одной свече',             2,  'i', 'шт б',     0],
        [112, 'Состояние клиньев',              2,  'i', 'ipe',      0],
        [113, 'Труб до забоя трубы',            2,  'i', 'шт б',     0],
        [114, 'H2S датчик 1 рубы',              4,  'f', '%',        2],
        [115, 'Вес крюке СПО средн.',           4,  'f', 'кг',       2],
        [116, 'Вес крюке СПО ожид.',            4,  'f', 'кг',       2],
        [117, 'Водоизм. ожидаемое',             4,  'f', 'м3',       2],
        [118, 'Водоизм. расчетное',             4,  'f', 'м3',       2],
        [119, 'Водоизм. текущее',               4,  'f', 'м3',       2],
        [120, 'Давл.свабир/поршнев.',           4,  'f', 'атм',      2],
        [121, 'Потери БР по времени',           4,  'f', 'м3 10мин', 2],
        [122, 'Потери БР по глубине',           4,  'f', 'м3 м',     2],
        [123, 'Время СПО ка инструм',           4,  'f', 'сек',      2],
        [124, 'Давление пульсаций',             4,  'f', 'атм',      2],
        [125, 'Шламограмма',                    32, 's', 'si',       0],
        [126, 'Нефтепроявления',                9,  's', '',         0],
        [127, 'Дифференциальное давление',      4,  'f', 'атм',      2],
        [128, 'Плотность перелома',             4,  'f', 'кг/м3',    2],
        [129, 'Время спуска Обс.Тр.',           4,  'f', 'сек об.тр',2],
        [130, 'Время спуска Обс.Кол',           4,  'f', 'сек',      2],
        [131, 'Обс.Труб внутри скв.',           2,  'i', 'шт тр',    0],
        [132, 'Обс.Труб вне скваж.',            2,  'i', 'шт тр',    0],
        [133, 'Время спускаОбК рейс',           4,  'f', 'сек',      2],
        [134, 'Наработка тал.каната',           4,  'f', 'кг*м',     2],
        [135, 'Ходов насоса 3',                 4,  'f', 'х/сек',    0],
        [136, 'Потери БР суммарные',            4,  'f', 'м3 час',   2],
        [137, 'нС4 / С1...С6',                  4,  'f', '%',        2],
        [138, 'Объем труб (маталла)',           4,  'f', 'м3 м',     2],
        [139, 'Время контр.поглощ.',            4,  'f', 'сек',      2],
        [140, 'Глуб.спускаемой ОбК',           4,  'f', 'м c',      2],
        [141, 'Время контр.выброса',            4,  'f', 'сек',      2],
        [142, 'Кол-во закаченого БР',           4,  'f', 'м3',       2],
        [143, 'Мгновенная скор.прох',           4,  'f', 'м/сек',    2],
        [144, 'Время к.выброса рейс',           4,  'f', 'сек',      2],
        [145, 'Объем емкости 10 иам',           4,  'f', 'м3',       2],
        [146, 'Объем емкости 11 иам',           4,  'f', 'м3',       2],
        [147, 'Время к.поглощения р',           4,  'f', 'сек',      2],
        [148, 'Примечание',                     31, 's', 'si',       0],
        [149, 'Объем емкости 12',               4,  'f', 'м3',       2],
        [150, 'Обсадных труб забой',            2,  'i', 'шт тр',    0],
        [151, 'Время ремонта   рейс',           4,  'f', 'сек',      2],
        [152, 'Сумма С1...С6',                  4,  'f', 'ppm',      2],
        [153, 'С1...С2 / С5...С6',              4,  'f', '%',        2],
        [154, 'H2S',                            4,  'f', '%',        2],
        [155, 'Минерализация на вх',            4,  'f', '%',        2],
        [156, 'Минерализация на вых',           4,  'f', '%',        2],
        [157, 'Время бурения час',              4,  'f', 'сек',      2],
        [158, 'Время циркуляции рейс',          4,  'f', 'сек',      2],
        [159, 'Время проработки',               4,  'f', 'сек',      2],
        [160, 'Время промывки  рейс',           4,  'f', 'сек',      2],
        [161, 'Время наращивание рейс',         4,  'f', 'сек',      2],
        [162, 'Время СПО       рейс',           4,  'f', 'сек',      2],
        [163, 'Время ПЗР       рейс',           4,  'f', 'сек',      2],
        [164, 'Время ГИС       рейс',           4,  'f', 'сек',      2],
        [165, 'Время простоя   рейс',           4,  'f', 'сек',      2],
        [166, 'Плотность емк 1',                4,  'f', 'кг/м3',    2],
        [167, 'Плотность емк 2',                4,  'f', 'кг/м3',    2],
        [168, 'Плотность емк 3',                4,  'f', 'кг/м3',    2],
        [169, 'Плотность емк 4',                4,  'f', 'кг/м3',    2],
        [170, 'Плотность емк 5',                4,  'f', 'кг/м3',    2],
        [171, 'Температура емк 1',              4,  'f', 'грС',      2],
        [172, 'Температура емк 2',              4,  'f', 'грС',      2],
        [173, 'Температура емк 3',              4,  'f', 'грС',      2],
        [174, 'Температура емк 4',              4,  'f', 'грС',      2],
        [175, 'Температура емк 5',              4,  'f', 'грС',      2],
        [176, 'Кальцит',                        4,  'f', '%',        2],
        [177, "С2' Этилен ора Емк6",            4,  'f', '%',        2],
        [178, 'Прогноз износа Долот',           4,  'f', 'м',        2],
        [179, 'H2S датчик 2',                   4,  'f', '%',        2],
        [180, 'Dexp:Полный град.дав',           4,  'f', 'кг/м3',    2],
        [181, 'Sigm:Полный град.дав',           4,  'f', 'кг/м3',    2],
        [182, 'Время проработки',               4,  'f', 'сек',      2],
        [183, 'Время промывки',                 4,  'f', 'сек',      2],
        [184, 'Время наращивания',              4,  'f', 'сек',      2],
        [185, 'Время СПО',                      4,  'f', 'сек',      2],
        [186, 'Время циркуляции',               4,  'f', 'сек',      2],
        [187, 'Время простоя',                  4,  'f', 'сек',      2],
        [188, 'Объемная плотн.шлама',           4,  'f', 'кг/м3',    2],
        [189, 'Ускор.Обор.Ротора',              4,  'f', 'об/с2',    2],
        [190, 'Направление крюка',              2,  'i', '',         0],
        [191, 'Абсол.скорость крюка',           4,  'f', 'м/сек',    2],
        [192, 'Глубина инклинометра',           4,  'f', 'м',        2],
        [193, 'Отклонитель',                    4,  'f', 'рад',      2],
        [194, 'Азимут',                         4,  'f', 'рад',      2],
        [195, 'Зенит',                          4,  'f', 'рад',      2],
        [196, 'Доломит',                        4,  'f', '% m',      2],
        [197, 'Момент на ключе',                4,  'f', 'Н*м',      2],
        [198, 'Глуб.отст.газов хром',          4,  'f', 'м gC',     2],
        [199, 'Плотность Долива',               4,  'f', 'кг/м3',    2],
        [200, 'Температура Долива',             4,  'f', 'грС',      2],
        [201, 'нС4 о 9',                        4,  'f', '%',        2],
        [202, 'С1 / С1...С6',                   4,  'f', '%',        2],
        [203, 'С2 / С1...С6',                   4,  'f', '%',        2],
        [204, 'С3 / С1...С6',                   4,  'f', '%',        2],
        [205, 'Минерал.плотн.шлама',            4,  'f', 'кг/м3',    2],
        [206, 'С4 / С1...С6',                   4,  'f', '%',        2],
        [207, 'С5 / С1...С6',                   4,  'f', '%',        2],
        [208, 'С6 / С1...С6',                   4,  'f', '%',        2],
        [209, 'С6 e',                           4,  'f', 'ppm',      2],
        [210, 'Ускорение инструмент',           4,  'f', 'м/сек2',   2],
        [211, 'Скорость проработки',            4,  'f', 'м/сек',    2],
        [212, 'Технологический этап',           2,  'i', 'ode',      0],
        [213, 'Этапы ГТИ по времени',           4,  'l', '',         0],
        [214, 'Этапы ГТИ по глубине',           4,  'l', '',         0],
        [215, 'иС4 .Давление циркул',           4,  'f', '%',        2],
        [216, 'С1 по шламу',                    4,  'f', '%',        2],
        [217, 'С2 по шламу',                    4,  'f', '%',        2],
        [218, 'С3 по шламу',                    4,  'f', '%',        2],
        [219, 'С4 по шламу',                    4,  'f', '%',        2],
        [220, 'С5 по шламу',                    4,  'f', '%',        2],
        [221, 'С6 по шламу',                    4,  'f', '%',        2],
        [222, 'Сумма шламу С1...С6',            4,  'f', '%',        2],
        [223, 'иС4/С1...С6',                    4,  'f', '%',        2],
        [224, 'С2...С3 / С4...С6',              4,  'f', '%',        2],
        [225, 'С1 / С2...С6',                   4,  'f', '%',        2],
        [226, 'CO2',                            4,  'f', '%',        2],
        [227, 'Перепад давл на турб',           4,  'f', '%',        2],
        [228, 'Давление над забоем',            4,  'f', '%',        2],
        [229, 'Хроматограф время',              4,  'f', 'сек',      2],
        [230, 'Хроматограф канал 1',            4,  'f', 'код',      2],
        [231, 'Хроматограф канал 2',            4,  'f', 'код',      2],
        [232, 'Порядок пород шлама',            10, 's', '',         0],
        [233, 'Код аварии',                     4,  'l', '',         0],
        [234, 'РТК',                            4,  'l', '',         0],
        [235, 'Скорость инструмента',           4,  'f', 'м/сек',    2],
        [236, 'Объем емкости 6',                4,  'f', 'м3',       2],
        [237, 'Объем емкости 7',                4,  'f', 'м3',       2],
        [238, 'Объем емкости 8',                4,  'f', 'м3',       2],
        [239, 'Объем нераб.емкостей',           4,  'f', 'м3',       2],
        [240, 'Dexp:Пластовое давл.',           4,  'f', 'атм',      2],
        [241, 'Sigm:Пластовое давл.',           4,  'f', 'атм',      2],
        [242, 'Вес на крюке СПО min',           4,  'f', 'кг',       2],
        [243, 'Вес на крюке СПО max',           4,  'f', 'кг',       2],
        [244, 'Обороты долота',                 4,  'f', 'об/с',     2],
        [245, 'Коэф.откр.пористости',           4,  'f', '% м',      2],
        [246, 'Вес бурового инстр.',            4,  'f', 'кг',       2],
        [247, 'Dexp:линия норм.упл.',           4,  'f', 'кг/м3',    2],
        [248, 'Sigm:линия норм.упл.',           4,  'f', 'кг/м3',    2],
        [249, 'иС5',                            4,  'f', '%',        2],
        [250, 'иС5 / С1...С6',                  4,  'f', '%',        2],
        [251, 'нС5',                            4,  'f', '%',        2],
        [252, 'нС5 / С1...С6',                  4,  'f', '%',        2],
        [253, 'Момент ротора (max)',             4,  'f', 'Н*м',      2],
        [254, 'Заводской ном.долота',           20, 's', null,       0],
    ];

    db.transaction(() => {
        const ins = db.prepare('INSERT OR IGNORE INTO parameters (id, name, type_id, size, accuracy) VALUES (?, ?, ?, ?, ?)');
        const upd = db.prepare('UPDATE parameters SET type_id = ?, size = ?, accuracy = ? WHERE id = ?');
        for (const [id, name, size, typeChar, , accuracy] of refParams) {
            const typeId = REF_TYPE[typeChar] || null;
            ins.run(id, name.trim(), typeId, size, accuracy);
            upd.run(typeId, size, accuracy, id);
        }
    })();

    // ── Indicators ────────────────────────────────────────────────────────────

    db.exec(`
        CREATE TABLE IF NOT EXISTS indicators (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            param_id     INTEGER,
            profile_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            type         TEXT    NOT NULL DEFAULT 'digitalIndicator',
            pos_left     INTEGER NOT NULL DEFAULT 0,
            pos_top      INTEGER NOT NULL DEFAULT 0,
            height       INTEGER,
            width        INTEGER,
            header_text  TEXT    NOT NULL DEFAULT '',
            header_color TEXT    NOT NULL DEFAULT '#c9d1d9',
            header_bg    TEXT    NOT NULL DEFAULT '#161b22',
            header_font  INTEGER NOT NULL DEFAULT 0,
            header_size  INTEGER NOT NULL DEFAULT 14,
            format       TEXT    NOT NULL DEFAULT '',
            value_color  TEXT    NOT NULL DEFAULT '#38bdf8',
            value_bg     TEXT    NOT NULL DEFAULT '#0d1117',
            value_font   INTEGER NOT NULL DEFAULT 0,
            value_size   INTEGER NOT NULL DEFAULT 48,
            range_min    REAL,
            range_max    REAL,
            alarm_min    REAL,
            alarm_max    REAL,
            alarm_color  TEXT    NOT NULL DEFAULT '#ff0000',
            alarm_sound  TEXT    NOT NULL DEFAULT '',
            alarm_volume INTEGER NOT NULL DEFAULT 50,
            alarm_delay  REAL    NOT NULL DEFAULT 2
        )
    `);

    [
        'pos_left INTEGER NOT NULL DEFAULT 0',
        'pos_top  INTEGER NOT NULL DEFAULT 0',
        "header_bg TEXT NOT NULL DEFAULT '#161b22'",
        "value_bg  TEXT NOT NULL DEFAULT '#0d1117'",
        'range_min REAL',
        'range_max REAL',
        'alarm_min REAL',
        'alarm_max REAL',
        "format TEXT NOT NULL DEFAULT ''",
        "alarm_color   TEXT    NOT NULL DEFAULT '#ff0000'",
        "alarm_sound   TEXT    NOT NULL DEFAULT ''",
        'alarm_volume  INTEGER NOT NULL DEFAULT 50',
        'alarm_delay   REAL    NOT NULL DEFAULT 2',
        'alarm_enabled INTEGER NOT NULL DEFAULT 0',
    ].forEach(col => {
        try { db.exec('ALTER TABLE indicators ADD COLUMN ' + col); } catch {}
    });

    [
        "units            TEXT    NOT NULL DEFAULT ''",
        'zone_colors      INTEGER NOT NULL DEFAULT 0',
        'ticker_speed     REAL    NOT NULL DEFAULT 12',
        'value_bg_opacity REAL    NOT NULL DEFAULT 0',
    ].forEach(col => {
        try { db.exec('ALTER TABLE indicators ADD COLUMN ' + col); } catch {}
    });

    try { db.exec("ALTER TABLE parameters ADD COLUMN units TEXT NOT NULL DEFAULT ''"); } catch {}

    const indCols = db.prepare('PRAGMA table_info(indicators)').all().map(c => c.name);
    if (indCols.includes('decimals') && !indCols.includes('format')) {
        db.transaction(() => {
            db.exec("ALTER TABLE indicators ADD COLUMN format TEXT NOT NULL DEFAULT ''");
            db.exec(`UPDATE indicators SET format = CASE
                WHEN decimals = 0 THEN '0'
                WHEN decimals = 1 THEN '0.0'
                WHEN decimals = 2 THEN '0.00'
                WHEN decimals = 3 THEN '0.000'
                WHEN decimals = 4 THEN '0.0000'
                ELSE '' END`);
            db.exec(`CREATE TABLE indicators_new (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                param_id     INTEGER,
                profile_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
                type         TEXT    NOT NULL DEFAULT 'digitalIndicator',
                pos_left     INTEGER NOT NULL DEFAULT 0,
                pos_top      INTEGER NOT NULL DEFAULT 0,
                height       INTEGER,
                width        INTEGER,
                header_text  TEXT    NOT NULL DEFAULT '',
                header_color TEXT    NOT NULL DEFAULT '#c9d1d9',
                header_bg    TEXT    NOT NULL DEFAULT '#161b22',
                header_font  TEXT    NOT NULL DEFAULT 'monospace',
                header_size  INTEGER NOT NULL DEFAULT 14,
                format       TEXT    NOT NULL DEFAULT '',
                value_color  TEXT    NOT NULL DEFAULT '#38bdf8',
                value_bg     TEXT    NOT NULL DEFAULT '#0d1117',
                value_font   TEXT    NOT NULL DEFAULT 'monospace',
                value_size   INTEGER NOT NULL DEFAULT 48,
                range_min    REAL,
                range_max    REAL,
                alarm_min    REAL,
                alarm_max    REAL
            )`);
            db.exec(`INSERT INTO indicators_new
                SELECT id, param_id, profile_id, type, pos_left, pos_top, height, width,
                       header_text, header_color, header_bg, header_font, header_size,
                       format, value_color, value_bg, value_font, value_size,
                       range_min, range_max, alarm_min, alarm_max
                FROM indicators`);
            db.exec('DROP TABLE indicators');
            db.exec('ALTER TABLE indicators_new RENAME TO indicators');
        })();
    }

    const fontColInfo    = db.prepare('PRAGMA table_info(indicators)').all();
    const headerFontCol  = fontColInfo.find(c => c.name === 'header_font');
    if (headerFontCol && headerFontCol.type === 'TEXT') {
        db.transaction(() => {
            db.exec(`CREATE TABLE indicators_new (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                param_id     INTEGER,
                profile_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
                type         TEXT    NOT NULL DEFAULT 'digitalIndicator',
                pos_left     INTEGER NOT NULL DEFAULT 0,
                pos_top      INTEGER NOT NULL DEFAULT 0,
                height       INTEGER,
                width        INTEGER,
                header_text  TEXT    NOT NULL DEFAULT '',
                header_color TEXT    NOT NULL DEFAULT '#c9d1d9',
                header_bg    TEXT    NOT NULL DEFAULT '#161b22',
                header_font  INTEGER NOT NULL DEFAULT 0,
                header_size  INTEGER NOT NULL DEFAULT 14,
                format       TEXT    NOT NULL DEFAULT '',
                value_color  TEXT    NOT NULL DEFAULT '#38bdf8',
                value_bg     TEXT    NOT NULL DEFAULT '#0d1117',
                value_font   INTEGER NOT NULL DEFAULT 0,
                value_size   INTEGER NOT NULL DEFAULT 48,
                range_min    REAL,
                range_max    REAL,
                alarm_min    REAL,
                alarm_max    REAL,
                alarm_color  TEXT    NOT NULL DEFAULT '#ff0000',
                alarm_sound  TEXT    NOT NULL DEFAULT '',
                alarm_volume INTEGER NOT NULL DEFAULT 50,
                alarm_delay  REAL    NOT NULL DEFAULT 2,
                alarm_enabled INTEGER NOT NULL DEFAULT 0
            )`);
            db.exec(`INSERT INTO indicators_new
                SELECT id, param_id, profile_id, type, pos_left, pos_top, height, width,
                       header_text, header_color, header_bg, 0, header_size,
                       format, value_color, value_bg, 0, value_size,
                       range_min, range_max, alarm_min, alarm_max,
                       alarm_color, alarm_sound, alarm_volume, alarm_delay, alarm_enabled
                FROM indicators`);
            db.exec('DROP TABLE indicators');
            db.exec('ALTER TABLE indicators_new RENAME TO indicators');
        })();
    }

    // ── Users ─────────────────────────────────────────────────────────────────

    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            name     TEXT    NOT NULL UNIQUE,
            password TEXT    NOT NULL
        )
    `);

    const adminExists = db.prepare('SELECT COUNT(*) as c FROM users WHERE name = ?').get('admin').c > 0;
    if (!adminExists) {
        const adminPass = process.env.ADMIN_PASSWORD || (() => {
            const generated = crypto.randomBytes(8).toString('hex');
            console.log('\n[DrillMonitor] Создан пользователь admin с паролем: ' + generated);
            console.log('[DrillMonitor] Смените пароль после первого входа.\n');
            return generated;
        })();
        db.prepare('INSERT INTO users (name, password) VALUES (?, ?)').run('admin', pw.hash(adminPass));
    }

    // ── Fonts ─────────────────────────────────────────────────────────────────

    db.exec(`
        CREATE TABLE IF NOT EXISTS fonts (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            name      TEXT    NOT NULL UNIQUE,
            font      BLOB    NOT NULL,
            mime_type TEXT    NOT NULL DEFAULT ''
        )
    `);
    try { db.exec("ALTER TABLE fonts ADD COLUMN mime_type TEXT NOT NULL DEFAULT ''"); } catch {}

    const fontsDir = path.join(__dirname, '../../fonts');
    if (fs.existsSync(fontsDir)) {
        const insertFont = db.prepare('INSERT OR IGNORE INTO fonts (name, font, mime_type) VALUES (?, ?, ?)');
        for (const file of fs.readdirSync(fontsDir)) {
            const ext = path.extname(file).toLowerCase();
            if (ext !== '.otf' && ext !== '.ttf') continue;
            const mime = ext === '.otf' ? 'font/otf' : 'font/ttf';
            insertFont.run(path.basename(file, ext), fs.readFileSync(path.join(fontsDir, file)), mime);
        }
    }

    // ── Logs ──────────────────────────────────────────────────────────────────

    db.exec(`
        CREATE TABLE IF NOT EXISTS logs (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT    NOT NULL,
            message   TEXT    NOT NULL
        )
    `);

    try { db.exec('ALTER TABLE indicators ADD COLUMN extra_data TEXT'); } catch {}

    db.prepare('DELETE FROM logs WHERE timestamp < ?')
        .run(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    // ── Alarm sounds ──────────────────────────────────────────────────────────

    db.exec(`
        CREATE TABLE IF NOT EXISTS alarm_sounds (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT    NOT NULL UNIQUE,
            file BLOB    NOT NULL
        )
    `);
}

module.exports = { initSchema };

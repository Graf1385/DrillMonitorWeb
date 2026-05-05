const crypto = require('crypto');
const path   = require('path');
const fs     = require('fs');

function _sha256(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
}

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

    db.prepare('DELETE FROM data_types').run();
    db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run('data_types');
    const seedDataTypes = [
        [1, 'time',   'HH:mm:ss'],
        [2, 'float',  '0000.00'],
        [3, 'short',  '0000'],
        [4, 'string', '""'],
    ];
    const insertDataType = db.prepare('INSERT INTO data_types (id, name, default_format) VALUES (?, ?, ?)');
    for (const [id, name, fmt] of seedDataTypes) insertDataType.run(id, name, fmt);

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
            id      INTEGER PRIMARY KEY,
            name    TEXT    NOT NULL UNIQUE,
            type_id INTEGER
        )
    `);

    const paramCols = db.prepare('PRAGMA table_info(parameters)').all().map(c => c.name);
    if (paramCols.includes('type') && !paramCols.includes('type_id')) {
        db.transaction(() => {
            db.exec('ALTER TABLE parameters ADD COLUMN type_id INTEGER');
            db.prepare(`
                UPDATE parameters SET type_id = (
                    SELECT dt.id FROM data_types dt
                    WHERE (parameters.type = 'datetime' AND dt.name = 'time')
                       OR (parameters.type != 'datetime' AND dt.name = parameters.type)
                )
            `).run();
            db.exec(`CREATE TABLE parameters_new (
                id      INTEGER PRIMARY KEY,
                name    TEXT NOT NULL UNIQUE,
                type_id INTEGER
            )`);
            db.exec('INSERT INTO parameters_new SELECT id, name, type_id FROM parameters');
            db.exec('DROP TABLE parameters');
            db.exec('ALTER TABLE parameters_new RENAME TO parameters');
        })();
    }

    const seedParams = [
        [0,  'Вес на крюке',                  'float'],
        [1,  'Давление в манифольде',          'float'],
        [2,  'Расход бурового раствора',       'float'],
        [3,  'Обороты ротора',                 'float'],
        [4,  'Крутящий момент',                'float'],
        [5,  'Скорость проходки',              'float'],
        [6,  'Глубина забоя',                  'float'],
        [7,  'Глубина долота',                 'float'],
        [8,  'Температура бурового раствора',  'float'],
        [9,  'Плотность бурового раствора',    'float'],
        [10, 'Время сбора данных',             'time'],
    ];
    const getTypeId   = db.prepare('SELECT id FROM data_types WHERE name = ?');
    const insertParam = db.prepare('INSERT OR IGNORE INTO parameters (id, name, type_id) VALUES (?, ?, ?)');
    const updateParam = db.prepare('UPDATE parameters SET type_id = ? WHERE id = ?');
    for (const [id, name, typeName] of seedParams) {
        const dt = getTypeId.get(typeName);
        insertParam.run(id, name, dt ? dt.id : null);
        if (dt) updateParam.run(dt.id, id);
    }

    try { db.exec('ALTER TABLE parameters ADD COLUMN unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL'); } catch {}

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

    db.prepare(`
        INSERT OR IGNORE INTO users (name, password) VALUES ('admin', ?)
    `).run(_sha256('RFVtgb12345678'));

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

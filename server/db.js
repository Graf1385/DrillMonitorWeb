const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'data', 'profiles.db'));

// ── Profiles ──────────────────────────────────────────────────────────────────

db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL UNIQUE,
        background TEXT    NOT NULL,
        cell_size  INTEGER NOT NULL,
        is_default INTEGER NOT NULL DEFAULT 0,
        is_active  INTEGER NOT NULL DEFAULT 0
    )
`);

try { db.exec('ALTER TABLE profiles ADD COLUMN is_active        INTEGER NOT NULL DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE profiles ADD COLUMN alarm_sound_id  INTEGER'); } catch {}
try { db.exec('ALTER TABLE profiles ADD COLUMN alarm_volume    INTEGER NOT NULL DEFAULT 50'); } catch {}
try { db.exec('ALTER TABLE profiles ADD COLUMN alarm_delay     REAL    NOT NULL DEFAULT 2'); } catch {}

db.prepare(`
    INSERT OR IGNORE INTO profiles (name, background, cell_size, is_default, is_active)
    VALUES ('Стандартный', '#000000', 20, 1, 1)
`).run();

const hasActive = db.prepare('SELECT COUNT(*) as c FROM profiles WHERE is_active = 1').get();
if (hasActive.c === 0) {
    db.prepare('UPDATE profiles SET is_active = 1 WHERE is_default = 1').run();
}

// ── Data types ────────────────────────────────────────────────────────────────

db.exec(`
    CREATE TABLE IF NOT EXISTS data_types (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        name           TEXT    NOT NULL UNIQUE,
        default_format TEXT    NOT NULL DEFAULT ''
    )
`);

db.prepare('DELETE FROM data_types').run();
db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run('data_types');
const _seedDataTypes = [
    [1, 'time',   'HH:mm:ss'],
    [2, 'float',  '0000.00'],
    [3, 'short',  '0000'],
    [4, 'string', '""'],
];
const _insertDataType = db.prepare('INSERT INTO data_types (id, name, default_format) VALUES (?, ?, ?)');
for (const [id, name, fmt] of _seedDataTypes) _insertDataType.run(id, name, fmt);

// ── Parameters ────────────────────────────────────────────────────────────────

db.exec(`
    CREATE TABLE IF NOT EXISTS parameters (
        id      INTEGER PRIMARY KEY,
        name    TEXT    NOT NULL UNIQUE,
        type_id INTEGER
    )
`);

// Migration: rename type TEXT → type_id INTEGER (for databases created before this version)
const _paramCols = db.prepare('PRAGMA table_info(parameters)').all().map(c => c.name);
if (_paramCols.includes('type') && !_paramCols.includes('type_id')) {
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

// Seed drilling parameters and always sync type_id to current data_types
const _seedParams = [
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
const _getTypeId   = db.prepare('SELECT id FROM data_types WHERE name = ?');
const _insertParam = db.prepare('INSERT OR IGNORE INTO parameters (id, name, type_id) VALUES (?, ?, ?)');
const _updateParam = db.prepare('UPDATE parameters SET type_id = ? WHERE id = ?');
for (const [id, name, typeName] of _seedParams) {
    const dt = _getTypeId.get(typeName);
    _insertParam.run(id, name, dt ? dt.id : null);
    if (dt) _updateParam.run(dt.id, id);
}

// ── Indicators ────────────────────────────────────────────────────────────────

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
    "alarm_color  TEXT    NOT NULL DEFAULT '#ff0000'",
    "alarm_sound  TEXT    NOT NULL DEFAULT ''",
    'alarm_volume INTEGER NOT NULL DEFAULT 50',
    'alarm_delay  REAL    NOT NULL DEFAULT 2'
].forEach(col => {
    try { db.exec('ALTER TABLE indicators ADD COLUMN ' + col); } catch {}
});

// Migration: replace decimals column with format (recreate table if needed)
const _indCols = db.prepare('PRAGMA table_info(indicators)').all().map(c => c.name);
if (_indCols.includes('decimals') && !_indCols.includes('format')) {
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

// ── Alarm sounds ─────────────────────────────────────────────────────────────

db.exec(`
    CREATE TABLE IF NOT EXISTS alarm_sounds (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT    NOT NULL UNIQUE,
        file BLOB    NOT NULL
    )
`);


module.exports = {
    getProfiles() {
        return db.prepare('SELECT * FROM profiles ORDER BY is_default DESC, id ASC').all();
    },

    getProfile(id) {
        return db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
    },

    createProfile(name, background, cellSize) {
        return db.prepare(
            'INSERT INTO profiles (name, background, cell_size, alarm_volume, alarm_delay) VALUES (?, ?, ?, 50, 2)'
        ).run(name, background, cellSize);
    },

    getActiveProfile() {
        return db.prepare('SELECT * FROM profiles WHERE is_active = 1').get();
    },

    selectProfile(id) {
        return db.transaction(() => {
            db.prepare('UPDATE profiles SET is_active = 0').run();
            db.prepare('UPDATE profiles SET is_active = 1 WHERE id = ?').run(id);
            return db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
        })();
    },

    updateProfile(id, background, cellSize, alarmSoundId, alarmVolume, alarmDelay) {
        return db.transaction(() => {
            db.prepare('UPDATE profiles SET is_active = 0').run();
            return db.prepare(`
                UPDATE profiles
                SET background = ?, cell_size = ?, alarm_sound_id = ?, alarm_volume = ?, alarm_delay = ?, is_active = 1
                WHERE id = ?
            `).run(background, cellSize, alarmSoundId || null, alarmVolume, alarmDelay, id);
        })();
    },

    deleteProfile(id) {
        return db.prepare(
            'DELETE FROM profiles WHERE id = ? AND is_default = 0'
        ).run(id);
    },

    // ── Parameters ───────────────────────────────────────────────────────────

    getParameters() {
        return db.prepare(`
            SELECT p.id, p.name, p.type_id, dt.name AS type_name, dt.default_format
            FROM parameters p
            LEFT JOIN data_types dt ON p.type_id = dt.id
            ORDER BY p.id ASC
        `).all();
    },

    getParameter(id) {
        return db.prepare(`
            SELECT p.id, p.name, p.type_id, dt.name AS type_name
            FROM parameters p
            LEFT JOIN data_types dt ON p.type_id = dt.id
            WHERE p.id = ?
        `).get(id);
    },

    createParameter(id, name, typeId) {
        return db.prepare(
            'INSERT INTO parameters (id, name, type_id) VALUES (?, ?, ?)'
        ).run(id, name, typeId);
    },

    deleteParameter(id) {
        return db.prepare('DELETE FROM parameters WHERE id = ?').run(id);
    },

    // ── Data types ────────────────────────────────────────────────────────────

    getDataTypes() {
        return db.prepare('SELECT * FROM data_types ORDER BY id ASC').all();
    },

    getDataType(id) {
        return db.prepare('SELECT * FROM data_types WHERE id = ?').get(id);
    },

    createDataType(name, defaultFormat) {
        return db.prepare(
            'INSERT INTO data_types (name, default_format) VALUES (?, ?)'
        ).run(name, defaultFormat);
    },

    updateDataType(id, name, defaultFormat) {
        return db.prepare(
            'UPDATE data_types SET name = ?, default_format = ? WHERE id = ?'
        ).run(name, defaultFormat, id);
    },

    deleteDataType(id) {
        return db.prepare('DELETE FROM data_types WHERE id = ?').run(id);
    },

    // ── Indicators ────────────────────────────────────────────────────────────

    getIndicatorsByProfile(profileId) {
        return db.prepare(
            'SELECT * FROM indicators WHERE profile_id = ? ORDER BY id ASC'
        ).all(profileId);
    },

    saveIndicators(profileId, list) {
        db.transaction(() => {
            db.prepare('DELETE FROM indicators WHERE profile_id = ?').run(profileId);
            const insert = db.prepare(`
                INSERT INTO indicators
                    (param_id, profile_id, type, pos_left, pos_top, height, width,
                     header_text, header_color, header_bg, header_font, header_size,
                     format, value_color, value_bg, value_font, value_size,
                     range_min, range_max, alarm_min, alarm_max, alarm_color)
                VALUES
                    (@param_id, @profile_id, @type, @pos_left, @pos_top, @height, @width,
                     @header_text, @header_color, @header_bg, @header_font, @header_size,
                     @format, @value_color, @value_bg, @value_font, @value_size,
                     @range_min, @range_max, @alarm_min, @alarm_max, @alarm_color)
            `);
            for (const item of list) insert.run({ ...item, profile_id: profileId });
        })();
    },

    // ── Alarm sounds ──────────────────────────────────────────────────────────

    getAlarmSounds() {
        return db.prepare('SELECT id, name FROM alarm_sounds ORDER BY id ASC').all();
    },

    getAlarmSoundFile(id) {
        return db.prepare('SELECT file FROM alarm_sounds WHERE id = ?').get(id);
    },

    createAlarmSound(name, fileBuffer) {
        return db.prepare('INSERT INTO alarm_sounds (name, file) VALUES (?, ?)').run(name, fileBuffer);
    },

    deleteAlarmSound(id) {
        return db.prepare('DELETE FROM alarm_sounds WHERE id = ?').run(id);
    },

};

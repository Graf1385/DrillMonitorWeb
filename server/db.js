const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'data', 'profiles.db'));

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

// Add is_active column if migrating from older schema
try { db.exec('ALTER TABLE profiles ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0'); } catch {}

// Seed standard profile once
db.prepare(`
    INSERT OR IGNORE INTO profiles (name, background, cell_size, is_default, is_active)
    VALUES ('Стандартный', '#000000', 20, 1, 1)
`).run();

// Seed drilling parameters
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
    [10, 'Время сбора данных',             'datetime'],
];
const _insertParam = db.prepare('INSERT OR IGNORE INTO parameters (id, name, type) VALUES (?, ?, ?)');
for (const p of _seedParams) _insertParam.run(...p);

// Ensure at least one active profile exists
const hasActive = db.prepare('SELECT COUNT(*) as c FROM profiles WHERE is_active = 1').get();
if (hasActive.c === 0) {
    db.prepare('UPDATE profiles SET is_active = 1 WHERE is_default = 1').run();
}

db.exec(`
    CREATE TABLE IF NOT EXISTS parameters (
        id   INTEGER PRIMARY KEY,
        name TEXT    NOT NULL UNIQUE,
        type TEXT    NOT NULL
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS indicators (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        param_id     INTEGER,
        profile_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        type         TEXT    NOT NULL DEFAULT 'digitalIndicator',
        height       INTEGER,
        width        INTEGER,
        header_text  TEXT    NOT NULL DEFAULT '',
        header_color TEXT    NOT NULL DEFAULT '#c9d1d9',
        header_font  TEXT    NOT NULL DEFAULT 'monospace',
        header_size  INTEGER NOT NULL DEFAULT 14,
        decimals     INTEGER NOT NULL DEFAULT 1,
        value_color  TEXT    NOT NULL DEFAULT '#38bdf8',
        value_font   TEXT    NOT NULL DEFAULT 'monospace',
        value_size   INTEGER NOT NULL DEFAULT 48
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
            'INSERT INTO profiles (name, background, cell_size) VALUES (?, ?, ?)'
        ).run(name, background, cellSize);
    },

    getActiveProfile() {
        return db.prepare('SELECT * FROM profiles WHERE is_active = 1').get();
    },

    updateProfile(id, background, cellSize) {
        db.prepare('UPDATE profiles SET is_active = 0').run();
        return db.prepare(
            'UPDATE profiles SET background = ?, cell_size = ?, is_active = 1 WHERE id = ?'
        ).run(background, cellSize, id);
    },

    deleteProfile(id) {
        return db.prepare(
            'DELETE FROM profiles WHERE id = ? AND is_default = 0'
        ).run(id);
    },

    // ── Parameters ───────────────────────────────────────────────────────────

    getParameters() {
        return db.prepare('SELECT * FROM parameters ORDER BY id ASC').all();
    },

    getParameter(id) {
        return db.prepare('SELECT * FROM parameters WHERE id = ?').get(id);
    },

    createParameter(id, name, type) {
        return db.prepare(
            'INSERT INTO parameters (id, name, type) VALUES (?, ?, ?)'
        ).run(id, name, type);
    },

    deleteParameter(id) {
        return db.prepare('DELETE FROM parameters WHERE id = ?').run(id);
    },

    // ── Indicators ────────────────────────────────────────────────────────────

    getIndicatorsByProfile(profileId) {
        return db.prepare(
            'SELECT * FROM indicators WHERE profile_id = ? ORDER BY id ASC'
        ).all(profileId);
    },

    createIndicator(data) {
        return db.prepare(`
            INSERT INTO indicators
                (param_id, profile_id, type, height, width,
                 header_text, header_color, header_font, header_size,
                 decimals, value_color, value_font, value_size)
            VALUES
                (@param_id, @profile_id, @type, @height, @width,
                 @header_text, @header_color, @header_font, @header_size,
                 @decimals, @value_color, @value_font, @value_size)
        `).run(data);
    },

    updateIndicator(id, data) {
        return db.prepare(`
            UPDATE indicators SET
                param_id     = @param_id,
                profile_id   = @profile_id,
                type         = @type,
                height       = @height,
                width        = @width,
                header_text  = @header_text,
                header_color = @header_color,
                header_font  = @header_font,
                header_size  = @header_size,
                decimals     = @decimals,
                value_color  = @value_color,
                value_font   = @value_font,
                value_size   = @value_size
            WHERE id = @id
        `).run({ ...data, id });
    },

    deleteIndicator(id) {
        return db.prepare('DELETE FROM indicators WHERE id = ?').run(id);
    },

    deleteIndicatorsByProfile(profileId) {
        return db.prepare('DELETE FROM indicators WHERE profile_id = ?').run(profileId);
    }
};

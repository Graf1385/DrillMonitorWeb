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
    try { db.exec("ALTER TABLE profiles ADD COLUMN timezone TEXT NOT NULL DEFAULT '0'"); } catch {}

    // Одноразовые миграции (user_version). Повторный прогон испортил бы данные:
    // cell_size < 10 умножился бы ещё раз, а timezone = '' («локальное время
    // браузера») молча превращался в '0' (UTC) при каждом рестарте.
    const _schemaVer = db.pragma('user_version', { simple: true });
    if (_schemaVer < 1) {
        db.exec('UPDATE profiles SET cell_size = ROUND(cell_size * 20) WHERE cell_size < 10');
    }
    if (_schemaVer < 2) {
        db.exec("UPDATE profiles SET timezone = '0' WHERE timezone IS NULL");
        db.pragma('user_version = 2');
    }

    db.prepare(`
        INSERT OR IGNORE INTO profiles (name, background, cell_size, is_default, is_active)
        VALUES ('Стандартный', '#000000', 20, 1, 1)
    `).run();

    const hasActive = db.prepare('SELECT COUNT(*) as c FROM profiles WHERE is_active = 1').get();
    if (hasActive.c === 0) {
        db.prepare('UPDATE profiles SET is_active = 1 WHERE is_default = 1').run();
    }

    // ── Справочники переехали в BCS_DrillerMonitorLoader ──────────────────────
    //
    // Таблицы parameters, units и data_types табло не использовало ни для
    // показа, ни для приёма данных: заголовок и единицы хранятся в самом
    // индикаторе, а номер параметра — это просто номер слота в пакете. Жили они
    // здесь только чтобы отдать их обратно редактору Loader, то есть дублировали
    // то, что и так есть у него (каталог станции CDT200). Теперь справочники
    // хранит Loader рядом с собой (Services/ReferenceStore.cs), а табло их не
    // знает. Старые таблицы удаляем — на устройстве они уже выгружены в Loader.

    for (const dead of ['parameters', 'units', 'data_types']) {
        try { db.exec('DROP TABLE IF EXISTS ' + dead); } catch (_) {}
    }

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

    // ── Sessions ──────────────────────────────────────────────────────────────

    db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            token      TEXT    PRIMARY KEY,
            expires_at INTEGER NOT NULL
        )
    `);

    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

module.exports = { initSchema };

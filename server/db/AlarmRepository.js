// История тревог: одна строка на тревогу — от начала до конца.
//
// Раньше история жила в памяти вкладки киоска и стиралась любой его
// перезагрузкой. Теперь тревоги решает сервер (server/alarm.js) и пишет их
// сюда; Loader читает их обменом alarm.history.

/// Больше этого не храним: табло пишет годами, а строки нужны свежие.
const KEEP_ROWS = 5000;

class AlarmRepository {
    constructor(db) {
        this.db = db;
    }

    start(a) {
        return this.db.prepare(`
            INSERT INTO alarms (profile, param_id, name, alarm_min, alarm_max, color,
                                started_at, start_value, extreme_value)
            VALUES (@profile, @param_id, @name, @alarm_min, @alarm_max, @color,
                    @started_at, @start_value, @start_value)
        `).run(a).lastInsertRowid;
    }

    extreme(id, value) {
        return this.db.prepare('UPDATE alarms SET extreme_value = ? WHERE id = ?').run(value, id);
    }

    ack(id, at) {
        return this.db.prepare('UPDATE alarms SET acked_at = ? WHERE id = ? AND acked_at IS NULL').run(at, id);
    }

    end(id, at, value, reason) {
        return this.db.prepare(
            'UPDATE alarms SET ended_at = ?, end_value = ?, end_reason = ? WHERE id = ? AND ended_at IS NULL'
        ).run(at, value, reason, id);
    }

    /// Незакрытые строки — остались от прошлого запуска службы.
    closeOpen(at, reason) {
        return this.db.prepare(
            'UPDATE alarms SET ended_at = ?, end_reason = ? WHERE ended_at IS NULL'
        ).run(at, reason);
    }

    /// Последние тревоги, новые сверху.
    recent(limit) {
        return this.db.prepare('SELECT * FROM alarms ORDER BY id DESC LIMIT ?').all(limit);
    }

    count() {
        return this.db.prepare('SELECT COUNT(*) AS c FROM alarms').get().c;
    }

    trim() {
        return this.db.prepare(
            'DELETE FROM alarms WHERE id <= (SELECT id FROM alarms ORDER BY id DESC LIMIT 1 OFFSET ?)'
        ).run(KEEP_ROWS);
    }
}

module.exports = AlarmRepository;

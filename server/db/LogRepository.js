class LogRepository {
    constructor(db) {
        this.db = db;
    }

    createLog(message) {
        return this.db.prepare('INSERT INTO logs (timestamp, message) VALUES (?, ?)')
            .run(new Date().toISOString(), message);
    }

    getLogs() {
        return this.db.prepare('SELECT * FROM logs ORDER BY id DESC').all();
    }

    clearLogs() {
        return this.db.prepare('DELETE FROM logs').run();
    }

    deleteOldLogs() {
        const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        return this.db.prepare('DELETE FROM logs WHERE timestamp < ?').run(cutoff);
    }
}

module.exports = LogRepository;

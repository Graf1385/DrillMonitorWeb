class AlarmSoundRepository {
    constructor(db) {
        this.db = db;
    }

    getAlarmSounds() {
        return this.db.prepare('SELECT id, name FROM alarm_sounds ORDER BY id ASC').all();
    }

    getAlarmSoundFile(id) {
        return this.db.prepare('SELECT file FROM alarm_sounds WHERE id = ?').get(id);
    }

    createAlarmSound(name, fileBuffer) {
        return this.db.prepare('INSERT INTO alarm_sounds (name, file) VALUES (?, ?)').run(name, fileBuffer);
    }

    deleteAlarmSound(id) {
        return this.db.prepare('DELETE FROM alarm_sounds WHERE id = ?').run(id);
    }
}

module.exports = AlarmSoundRepository;

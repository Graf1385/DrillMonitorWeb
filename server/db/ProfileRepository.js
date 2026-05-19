class ProfileRepository {
    constructor(db) {
        this.db = db;
    }

    getProfiles() {
        return this.db.prepare('SELECT * FROM profiles ORDER BY is_default DESC, id ASC').all();
    }

    getProfile(id) {
        return this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
    }

    createProfile(name, background, cellSize) {
        return this.db.prepare(
            'INSERT INTO profiles (name, background, cell_size, alarm_volume, alarm_delay) VALUES (?, ?, ?, 50, 2)'
        ).run(name, background, cellSize);
    }

    getActiveProfile() {
        return this.db.prepare('SELECT * FROM profiles WHERE is_active = 1').get();
    }

    selectProfile(id) {
        return this.db.transaction(() => {
            this.db.prepare('UPDATE profiles SET is_active = 0').run();
            this.db.prepare('UPDATE profiles SET is_active = 1 WHERE id = ?').run(id);
            return this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
        })();
    }

    updateProfile(id, background, cellSize, alarmSoundId, alarmVolume, alarmDelay, wsWidth, wsHeight, sidebarTimeout, timezone) {
        return this.db.transaction(() => {
            this.db.prepare('UPDATE profiles SET is_active = 0').run();
            return this.db.prepare(`
                UPDATE profiles
                SET background = ?, cell_size = ?, alarm_sound_id = ?, alarm_volume = ?, alarm_delay = ?,
                    ws_width = ?, ws_height = ?, sidebar_timeout = ?, timezone = ?, is_active = 1
                WHERE id = ?
            `).run(background, cellSize, alarmSoundId || null, alarmVolume, alarmDelay,
                   wsWidth || 0, wsHeight || 0, sidebarTimeout != null ? parseInt(sidebarTimeout) : 20,
                   timezone || '', id);
        })();
    }

    deleteProfile(id) {
        return this.db.prepare(
            'DELETE FROM profiles WHERE id = ? AND is_default = 0'
        ).run(id);
    }
}

module.exports = ProfileRepository;

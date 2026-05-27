class SessionRepository {
    constructor(db) {
        this._insert  = db.prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)');
        this._get     = db.prepare('SELECT expires_at FROM sessions WHERE token = ?');
        this._delete  = db.prepare('DELETE FROM sessions WHERE token = ?');
        this._purge   = db.prepare('DELETE FROM sessions WHERE expires_at < ?');
    }

    create(token, expiresAt) {
        this._insert.run(token, expiresAt);
    }

    get(token) {
        return this._get.get(token) || null;
    }

    delete(token) {
        this._delete.run(token);
    }

    purgeExpired() {
        this._purge.run(Date.now());
    }
}

module.exports = SessionRepository;

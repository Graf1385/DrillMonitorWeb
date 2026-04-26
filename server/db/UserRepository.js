const crypto = require('crypto');

function _sha256(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
}

class UserRepository {
    constructor(db) {
        this.db = db;
    }

    getUser(name) {
        return this.db.prepare('SELECT * FROM users WHERE name = ?').get(name);
    }

    verifyUser(name, password) {
        const user = this.db.prepare('SELECT * FROM users WHERE name = ?').get(name);
        if (!user) return false;
        return user.password === _sha256(password);
    }

    updateUserPassword(name, newPassword) {
        return this.db.prepare('UPDATE users SET password = ? WHERE name = ?')
            .run(_sha256(newPassword), name);
    }
}

module.exports = UserRepository;

const pw = require('../utils/password');

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
        const result = pw.verify(password, user.password);
        if (!result.ok) return false;
        if (result.legacy) {
            this.db.prepare('UPDATE users SET password = ? WHERE name = ?')
                .run(pw.hash(password), name);
        }
        return true;
    }

    updateUserPassword(name, newPassword) {
        return this.db.prepare('UPDATE users SET password = ? WHERE name = ?')
            .run(pw.hash(newPassword), name);
    }
}

module.exports = UserRepository;

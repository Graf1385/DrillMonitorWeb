const crypto = require('crypto');

const LEGACY_RE = /^[a-f0-9]{64}$/;

function hash(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const h    = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
    return 'pbkdf2:100000:' + salt + ':' + h;
}

function verify(password, stored) {
    if (LEGACY_RE.test(stored)) {
        const attempt = crypto.createHash('sha256').update(password).digest('hex');
        return { ok: attempt === stored, legacy: true };
    }
    const parts = stored.split(':');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return { ok: false, legacy: false };
    const iters     = parseInt(parts[1]);
    const salt      = parts[2];
    const storedH   = parts[3];
    const h = crypto.pbkdf2Sync(password, salt, iters, 32, 'sha256').toString('hex');
    return { ok: h === storedH, legacy: false };
}

module.exports = { hash, verify };

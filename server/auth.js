const crypto = require('crypto');

const COOKIE_NAME = 'drillsid';
const SESSION_TTL = 24 * 60 * 60 * 1000;

const _sessions = new Map(); // token → expiry ms

function createSession() {
    const token = crypto.randomBytes(32).toString('hex');
    _sessions.set(token, Date.now() + SESSION_TTL);
    return token;
}

function destroySession(token) {
    _sessions.delete(token);
}

function _getToken(req) {
    const raw = req.headers.cookie || '';
    const m   = raw.match(/(?:^|;\s*)drillsid=([a-f0-9]{64})/);
    return m ? m[1] : null;
}

function isAuthenticated(req) {
    const token = _getToken(req);
    if (!token) return false;
    const exp = _sessions.get(token);
    if (!exp) return false;
    if (Date.now() > exp) { _sessions.delete(token); return false; }
    return true;
}

function requireAuth(req, res, next) {
    if (isAuthenticated(req)) return next();
    res.status(401).json({ error: 'Требуется аутентификация' });
}

function sessionCookie(token) {
    return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${24 * 60 * 60}`;
}

function clearCookie() {
    return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

module.exports = { createSession, destroySession, requireAuth, sessionCookie, clearCookie, _getToken };

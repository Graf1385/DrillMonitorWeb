const db = require('./db');

setInterval(function () { db.deleteOldLogs(); }, 24 * 60 * 60 * 1000);

function log(message) {
    try { db.createLog(message); } catch (e) { console.error('Logger error:', e); }
}

module.exports = { log };

'use strict';

const express = require('express');
const router  = express.Router();
const ingest  = require('../ingest');

// Rate limiter: max 5 push/data requests per second per IP
const _rlMap = new Map();
function _isRateLimited(ip) {
    const now   = Date.now();
    let   entry = _rlMap.get(ip);
    if (!entry || now > entry.reset) entry = { count: 0, reset: now + 1000 };
    entry.count++;
    _rlMap.set(ip, entry);
    return entry.count > 5;
}
setInterval(function () {
    const now = Date.now();
    for (const [k, v] of _rlMap) if (now > v.reset) _rlMap.delete(k);
}, 60 * 1000);

// Receive drill data record from BCS_Loader — auto-activates push mode on first call
router.post('/api/push/data', function (req, res) {
    if (_isRateLimited(req.ip || 'unknown'))
        return res.status(429).json({ error: 'Слишком много запросов' });

    const err = ingest.ingestRecord(req.body);
    if (err) return res.status(400).json({ error: err });
    res.json({ ok: true });
});

// Receive run-state notification from BCS_Loader (started / stopped)
router.post('/api/push/state', function (req, res) {
    ingest.ingestState(req.body);
    res.json({ ok: true });
});

module.exports = router;

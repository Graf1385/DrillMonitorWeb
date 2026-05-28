'use strict';

const express    = require('express');
const router     = express.Router();
const dataSource = require('../dataSource');
const sse        = require('../sse');
const db         = require('../db');

// Param IDs whose value should be overridden with the authoritative LST depth.
// Populated at startup from the DB by matching known depth-parameter names.
const _DEPTH_NAMES = ['глубина забоя', 'глубина долота'];
let _depthParamIds = [];
(function () {
    try {
        const rows = db.getParameters();
        rows.forEach(function (p) {
            if (p.name && _DEPTH_NAMES.indexOf(p.name.toLowerCase()) !== -1)
                _depthParamIds.push(p.id);
        });
    } catch (_) {}
})();

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

function _startPush() {
    dataSource.startPushMode(
        function (record) {
            sse.broadcast('drill-data', {
                recNo:  record.recNo,
                depth:  record.depth,
                time:   record.time,
                params: Object.fromEntries(record.params),
            });
        },
        {
            onStale:  (reason) => sse.broadcast('run-state', { running: false, reason: reason || null }),
            onResume: ()       => sse.broadcast('run-state', { running: true }),
        }
    );
    sse.broadcast('run-state', { running: true });
}

// Receive drill data record from BCS_Loader — auto-activates push mode on first call
router.post('/api/push/data', function (req, res) {
    if (_isRateLimited(req.ip || 'unknown'))
        return res.status(429).json({ error: 'Слишком много запросов' });

    if (!dataSource.isPushMode()) _startPush();

    const body = req.body;
    if (!body || typeof body.params !== 'object')
        return res.status(400).json({ error: 'Неверный формат пакета' });

    const params = new Map(
        Object.entries(body.params).map(([k, v]) => [parseInt(k, 10), v])
    );
    // Override depth params with authoritative LST depth from the file header
    const lstDepth = Number(body.depth);
    if (!isNaN(lstDepth) && lstDepth > 0)
        _depthParamIds.forEach(function (id) { params.set(id, lstDepth); });

    dataSource.receivePushRecord({
        recNo:  Number(body.recNo)  || 0,
        depth:  Number(body.depth)  || 0,
        time:   Number(body.time)   || 0,
        params,
    });
    res.json({ ok: true });
});

// Receive run-state notification from BCS_Loader (started / stopped)
router.post('/api/push/state', function (req, res) {
    const running = !!req.body.running;
    if (running) {
        if (!dataSource.isPushMode()) _startPush();
    } else {
        dataSource.stopPushMode();
        sse.broadcast('run-state', { running: false, reason: req.body.reason || null });
    }
    res.json({ ok: true });
});

module.exports = router;

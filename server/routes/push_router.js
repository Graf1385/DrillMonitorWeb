'use strict';

const express    = require('express');
const router     = express.Router();
const dataSource = require('../dataSource');
const sse        = require('../sse');
const auth       = require('../auth');

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

function _requireApiKey(req, res, next) {
    const key = dataSource.getApiKey();
    if (!key) return res.status(403).json({ error: 'API-ключ не настроен — сгенерируйте его в настройках' });
    if (req.headers['x-api-key'] !== key) return res.status(401).json({ error: 'Неверный API-ключ' });
    next();
}

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

// ── Admin endpoints (session auth) ────────────────────────────────────────────

router.get('/api/push/settings', auth.requireAuth, function (req, res) {
    const key = dataSource.getApiKey();
    res.json({ apiKey: key || null, active: dataSource.isPushMode() });
});

router.post('/api/push/settings/generate', auth.requireAuth, function (req, res) {
    const key = dataSource.generateApiKey();
    res.json({ ok: true, apiKey: key });
});

router.post('/api/push/deactivate', auth.requireAuth, function (req, res) {
    dataSource.stopPushMode();
    sse.broadcast('run-state', { running: false });
    res.json({ ok: true });
});

// ── BCS_Loader endpoints (API key auth) ───────────────────────────────────────

// Receive drill data record from BCS_Loader.
// Auto-activates push mode on first call if not already active.
router.post('/api/push/data', _requireApiKey, function (req, res) {
    if (_isRateLimited(req.ip || 'unknown')) {
        return res.status(429).json({ error: 'Слишком много запросов' });
    }

    if (!dataSource.isPushMode()) {
        if (dataSource.isPolling()) {
            return res.status(409).json({ error: 'Сервер в режиме опроса файлов. Остановите опрос через интерфейс.' });
        }
        _startPush();
    }

    const body = req.body;
    if (!body || typeof body.params !== 'object') {
        return res.status(400).json({ error: 'Неверный формат пакета' });
    }

    const params = new Map(
        Object.entries(body.params).map(([k, v]) => [parseInt(k, 10), v])
    );
    dataSource.receivePushRecord({
        recNo:  Number(body.recNo)  || 0,
        depth:  Number(body.depth)  || 0,
        time:   Number(body.time)   || 0,
        params,
    });
    res.json({ ok: true });
});

// Receive run-state notification from BCS_Loader (started / stopped)
router.post('/api/push/state', _requireApiKey, function (req, res) {
    const running = !!req.body.running;
    if (running) {
        if (!dataSource.isPushMode()) {
            if (dataSource.isPolling()) {
                return res.status(409).json({ error: 'Сервер в режиме опроса файлов' });
            }
            _startPush();
        }
    } else {
        dataSource.stopPushMode();
        sse.broadcast('run-state', { running: false, reason: req.body.reason || null });
    }
    res.json({ ok: true });
});

module.exports = router;

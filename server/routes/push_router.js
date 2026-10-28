'use strict';

const express = require('express');
const router  = express.Router();
const ingest  = require('../ingest');
const mono    = require('../monotonic');
const applyGuard = require('../applyGuard').shared;

// Не больше 5 записей в секунду с одного адреса. Часы монотонные: системные
// подводит timeSync по данным того же Loader, и прыжок назад растянул бы окно
// на минуты — поток данных начал бы получать 429 на ровном месте.
const _rlMap = new Map();
function _isRateLimited(ip) {
    const now   = mono.now();
    let   entry = _rlMap.get(ip);
    if (!entry || now > entry.reset) entry = { count: 0, reset: now + 1000 };
    entry.count++;
    _rlMap.set(ip, entry);
    return entry.count > 5;
}
setInterval(function () {
    const now = mono.now();
    for (const [k, v] of _rlMap) if (now > v.reset) _rlMap.delete(k);
}, 60 * 1000);

// Receive drill data record from BCS_Loader — auto-activates push mode on first call
router.post('/api/push/data', function (req, res) {
    if (_isRateLimited(req.ip || 'unknown'))
        return res.status(429).json({ error: 'Слишком много запросов' });

    // Сбой на одной записи не должен возвращаться HTML-страницей ошибки:
    // Loader показывает оператору текст ответа, и он должен быть читаемым
    let err;
    try { err = ingest.ingestRecord(req.body); }
    catch (e) { return res.status(500).json({ error: 'Сбой приёма записи: ' + (e.message || e) }); }
    if (err) return res.status(400).json({ error: err });
    res.json({ ok: true });
});

// Receive run-state notification from BCS_Loader (started / stopped)
router.post('/api/push/state', function (req, res) {
    try { ingest.ingestState(req.body); }
    catch (e) { return res.status(500).json({ error: 'Сбой смены состояния: ' + (e.message || e) }); }
    res.json({ ok: true });
});

// Receive monitor configuration from BCS_Loader (profile + indicators).
// Body: { config: { profile, indicators } }. Applies to DB and broadcasts over
// SSE so the live kiosk redraws without a reboot. Same payload travels over
// RS-485 as a {"config":…} frame (server/serialSource.js).
router.post('/api/push/config', function (req, res) {
    const cfg = req.body && req.body.config;

    // «Сохранить» повторяет запрос после таймаута, а на этой сети таймаут
    // случается и у запроса, который до табло доехал. Отсев общий с RS-485
    // (server/applyGuard.js): переписывать раскладку второй раз незачем —
    // киоск бы её перестроил, а в журнале это выглядит как два сохранения.
    // Повтор — не ошибка: отвечаем так же, как на применённую посылку.
    if (applyGuard.isRepeat('config', cfg)) return res.json({ ok: true, repeat: true });

    let err;
    try { err = ingest.ingestConfig(cfg); }
    catch (e) {
        applyGuard.failed();
        return res.status(500).json({ error: 'Сбой применения конфигурации: ' + (e.message || e) });
    }
    if (err) { applyGuard.failed(); return res.status(400).json({ error: err }); }
    applyGuard.applied('config', cfg);
    res.json({ ok: true });
});

module.exports = router;

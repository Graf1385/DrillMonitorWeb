'use strict';

// ── Тревоги для экрана табла ─────────────────────────────────────────────────
//
// Решает их сервер (server/alarm.js), киоск только рисует и квитирует.
// Состояние приходит по SSE «alarm-state»; этот маршрут — для экрана,
// открытого уже после начала тревоги.

const express = require('express');
const router  = express.Router();
const alarm   = require('../alarm');

router.get('/api/alarms/state', function (req, res) {
    res.json(alarm.snapshot());
});

// Квитирование — единственное действие оператора на самом табле. Входа не
// требует, как и раньше: у киоска нет клавиатуры, а глушит сирену тот, кто
// стоит у экрана. key не задан — квитировать все.
router.post('/api/alarms/ack', function (req, res) {
    const key = req.body && typeof req.body.key === 'string' ? req.body.key : null;
    alarm.ack(key);
    res.json({ ok: true });
});

module.exports = router;

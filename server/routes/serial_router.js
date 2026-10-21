'use strict';

const express      = require('express');
const router       = express.Router();
const auth         = require('../auth');
const logger       = require('../logger');
const serialSource = require('../serialSource');

// Состояние и настройки приёма по RS-485
router.get('/api/serial', function (req, res) {
    res.json(serialSource.status());
});

// Сохранить настройки и переоткрыть порт (перезагрузка устройства не нужна)
router.post('/api/serial', auth.requireAuth, function (req, res) {
    try {
        const b = req.body || {};
        const s = serialSource.saveSettings({
            enabled: b.enabled === true || b.enabled === 'true' || b.enabled === '1' || b.enabled === 1,
            port:    String(b.port || ''),
            baud:    parseInt(b.baud, 10),
        });
        logger.log('Настройки RS-485 изменены: ' + (s.enabled ? s.port + ' @ ' + s.baud : 'выключено'));
        res.json({ ok: true, settings: s });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Ошибка сохранения настроек RS-485' });
    }
});

module.exports = router;

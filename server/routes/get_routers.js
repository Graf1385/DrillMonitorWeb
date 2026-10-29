const express  = require('express');
const router   = express.Router();
const db         = require('../db');
const sse        = require('../sse');
const dataSource = require('../dataSource');
const pkg       = require('../../package.json');
const auth      = require('../auth');
const netConfig = require('../netConfig');
const selfCheck = require('../selfCheck');
const boardSettings = require('../boardSettings');
const updateMode    = require('../updateMode');

router.get('/', (req, res) =>{
    res.render('index');
});

// Служебная страница: журнал и состояние табла. На экран бурильщика она не
// выведена и из киоска недоступна — туда больше не ведёт ни одна кнопка.
// Нужна она инженеру с ноутбуком в той же сети, когда Loader почему-то не
// подключается: иначе единственным путём внутрь осталась бы линия RS-485.
router.get('/service', (req, res) => {
    res.render('service', { layout: false });
});

// Настройки табла, общие для всех профилей. Киоск читает отсюда часовой пояс:
// часы на буровой одни, какой профиль ни покажи.
router.get('/api/board-settings', (req, res) => {
    res.json(boardSettings.read());
});

router.get('/api/profiles', (req, res) => {
    try {
        res.status(200).json(db.getProfiles());
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/api/profiles/active', (req, res) => {
    try {
        const profile = db.getActiveProfile();
        res.status(200).json(profile || null);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/api/indicators/active', (req, res) => {
    try {
        res.status(200).json(db.getActiveIndicators());
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/api/profiles/:id/indicators', (req, res) => {
    try {
        res.status(200).json(db.getIndicatorsByProfile(parseInt(req.params.id)));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/api/logs', (req, res) => {
    try {
        res.status(200).json(db.getLogs());
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/api/logs/export', (req, res) => {
    try {
        const logs = db.getLogs();
        const filename = 'logs_' + new Date().toISOString().slice(0, 10) + '.json';
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
        res.send(JSON.stringify(logs, null, 2));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/api/fonts', (req, res) => {
    try {
        res.status(200).json(db.getFonts());
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/api/fonts/:id/file', (req, res) => {
    try {
        const row = db.getFontFile(parseInt(req.params.id));
        if (!row) return res.status(404).end();
        res.setHeader('Content-Type', row.mime_type || 'font/otf');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        res.send(row.font);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/api/alarm-sounds', (req, res) => {
    try {
        res.status(200).json(db.getAlarmSounds());
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/api/alarm-sounds/:id/file', (req, res) => {
    try {
        const row = db.getAlarmSoundFile(parseInt(req.params.id));
        if (!row) return res.status(404).end();
        res.setHeader('Content-Type', 'audio/mpeg');
        res.send(row.file);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});


// Сводка самодиагностики. `ok` означает «сервер отвечает» — по нему Loader
// проверяет связь, и смысл поля менять нельзя. Состояние подсистем — в
// `level`/`checks`, их показывает окно «Логи системы» и может читать Loader.
router.get('/api/health', (req, res) => {
    let diag = null;
    try { diag = selfCheck.snapshot(); } catch (e) { diag = { level: 'off', error: e.message }; }
    res.json(Object.assign({ ok: true, version: pkg.version }, diag));
});

// Самообновление с GitHub убрано: у табло нет ни шлюза, ни DNS. Новая версия
// приезжает из BCS_DrillerMonitorLoader — POST /api/update/package по TCP/IP
// или кадр {"upd":…} по RS-485, см. server/updatePackage.js.

router.get('/api/events', (req, res) => {
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.flushHeaders();

    res.write(':\n\n'); // initial ping

    // Send current run-state immediately so reconnecting clients restore banner/clear state
    const state = dataSource.getRunState();
    if (!state.running) {
        res.write(`event: run-state\ndata: ${JSON.stringify(state)}\n\n`);
    }
    // Состояние обновления шлём всегда, а не только когда оно идёт. Клиент мог
    // перезагрузиться посреди обновления — заставку надо вернуть; но важнее
    // обратное: клиент, переживший обрыв подписки во время обновления, иначе
    // остался бы с заставкой навсегда, и экран бурильщика закрыт до перезагрузки.
    res.write(`event: update-state\ndata: ${JSON.stringify(updateMode.state())}\n\n`);

    sse.addClient(res);
    req.on('close', () => sse.removeClient(res));
});

// ── Network settings ──────────────────────────────────────────────────────────

router.get('/api/network', auth.requireAuth, function(req, res) {
    try {
        res.json(netConfig.read());
    } catch(e) {
        res.status(500).json({ error: 'Ошибка чтения сетевых настроек' });
    }
});

module.exports = router;

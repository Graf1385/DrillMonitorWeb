const express     = require('express');
const router      = express.Router();
const db          = require('../db');
const sse         = require('../sse');
const multer      = require('multer');
const logger      = require('../logger');
const auth        = require('../auth');
const netConfig   = require('../netConfig');
const ingestAdmin = require('../ingestAdmin');
const updatePackage = require('../updatePackage');
const mono        = require('../monotonic');

// ── Login rate limiter ────────────────────────────────────────────────────────
// Часы монотонные: системные подводит timeSync, а запрет входа на 15 минут,
// растянутый прыжком часов, выглядел бы как «неверный пароль».
const _loginAttempts = new Map();
setInterval(function () {
    const now = mono.now();
    for (const [k, v] of _loginAttempts) if (now > v.reset) _loginAttempts.delete(k);
}, 5 * 60 * 1000);

function _loginRateLimited(ip) {
    const now   = mono.now();
    let   entry = _loginAttempts.get(ip);
    if (!entry || now > entry.reset) entry = { count: 0, reset: now + 15 * 60 * 1000 };
    entry.count++;
    _loginAttempts.set(ip, entry);
    return entry.count > 10;
}

const _upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'audio/mpeg' || file.originalname.endsWith('.mp3')) cb(null, true);
        else cb(new Error('Только MP3 файлы'));
    }
});

router.post('/api/auth/login', (req, res) => {
    if (_loginRateLimited(req.ip || 'unknown')) {
        return res.status(429).json({ ok: false, error: 'Слишком много попыток. Подождите 15 минут.' });
    }
    const { name, password } = req.body;
    if (db.verifyUser(name, password)) {
        logger.log('Вход в систему: пользователь "' + name + '"');
        const token = auth.createSession();
        res.setHeader('Set-Cookie', auth.sessionCookie(token));
        res.json({ ok: true });
    } else {
        logger.log('Неудачная попытка входа: пользователь "' + (name || '?') + '"');
        res.status(401).json({ ok: false });
    }
});

// Смена пароля для того, кто уже вошёл. Тот же раздел приходит и по RS-485
// кадром {"auth":…} — там это единственный способ задать пароль с нуля.
router.post('/api/auth/password', auth.requireAuth, (req, res) => {
    const err = ingestAdmin.ingestAuth(req.body || {});
    if (err) return res.status(400).json({ error: err });
    res.json({ ok: true });
});

router.post('/api/auth/logout', (req, res) => {
    const token = auth._getToken(req);
    if (token) auth.destroySession(token);
    res.setHeader('Set-Cookie', auth.clearCookie());
    res.json({ ok: true });
});

router.post('/api/profiles', (req, res) => {
    try {
        const { name, background, cellSize } = req.body;
        if (!name || !background || !cellSize) {
            return res.status(400).json({ error: 'name, background и cellSize обязательны' });
        }
        const result = db.createProfile(name, background, parseInt(cellSize));
        logger.log('Создан профиль "' + name + '" (id=' + result.lastInsertRowid + ')');
        res.status(201).json({ id: result.lastInsertRowid });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.put('/api/profiles/:id', (req, res) => {
    try {
        const { background, cellSize, alarmSoundId, alarmVolume, alarmDelay, wsWidth, wsHeight, sidebarTimeout, timezone } = req.body;
        if (!background || !cellSize) {
            return res.status(400).json({ error: 'background и cellSize обязательны' });
        }
        const result = db.updateProfile(
            parseInt(req.params.id),
            background,
            parseInt(cellSize),
            alarmSoundId ? parseInt(alarmSoundId) : null,
            parseInt(alarmVolume) || 50,
            parseFloat(alarmDelay) || 2,
            parseInt(wsWidth) || 0,
            parseInt(wsHeight) || 0,
            sidebarTimeout != null ? parseInt(sidebarTimeout) : 20,
            timezone || ''
        );
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Профиль не найден' });
        }
        logger.log('Обновлены настройки профиля id=' + req.params.id);
        res.status(200).json({ ok: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/api/profiles/:id/select', (req, res) => {
    try {
        const profile = db.selectProfile(parseInt(req.params.id));
        if (!profile) return res.status(404).json({ error: 'Профиль не найден' });
        logger.log('Активирован профиль "' + profile.name + '" (id=' + profile.id + ')');
        sse.broadcast('profile-selected', profile);
        res.status(200).json({ ok: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/api/profiles/:id/indicators', (req, res) => {
    try {
        const profileId = parseInt(req.params.id);
        const list = req.body.indicators;
        if (!Array.isArray(list)) {
            return res.status(400).json({ error: 'indicators must be an array' });
        }
        db.saveIndicators(profileId, list);
        const profile = db.getProfile(profileId);
        logger.log('Сохранены индикаторы профиля "' + (profile ? profile.name : profileId) + '" (' + list.length + ' шт.)');
        sse.broadcast('workspace-saved', profile);
        res.status(200).json({ ok: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/api/alarm-sounds', _upload.single('file'), (req, res) => {
    try {
        const { name } = req.body;
        if (!name || !req.file) {
            return res.status(400).json({ error: 'name и file обязательны' });
        }
        const result = db.createAlarmSound(name, req.file.buffer);
        logger.log('Загружен звук сигнализации "' + name + '"');
        res.status(201).json({ id: result.lastInsertRowid });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/api/logs', (req, res) => {
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'message обязателен' });
        logger.log(String(message));
        res.status(200).json({ ok: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.delete('/api/logs', auth.requireAuth, (req, res) => {
    try {
        db.clearLogs();
        res.status(200).json({ ok: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.delete('/api/alarm-sounds/:id', auth.requireAuth, (req, res) => {
    try {
        const result = db.deleteAlarmSound(parseInt(req.params.id));
        if (result.changes === 0) return res.status(404).json({ error: 'Звук не найден' });
        logger.log('Удалён звук сигнализации id=' + req.params.id);
        res.status(200).json({ ok: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.delete('/api/profiles/:id', auth.requireAuth, (req, res) => {
    try {
        const profile = db.getProfile(parseInt(req.params.id));
        const result = db.deleteProfile(parseInt(req.params.id));
        if (result.changes === 0) {
            return res.status(403).json({ error: 'Профиль не найден или является стандартным' });
        }
        logger.log('Удалён профиль "' + (profile ? profile.name : req.params.id) + '"');
        res.status(200).json({ ok: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// ── Network settings ──────────────────────────────────────────────────────────

router.post('/api/network', auth.requireAuth, function(req, res) {
    var wanted;
    try {
        wanted = netConfig.validate(req.body || {});
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }
    try {
        netConfig.apply(wanted);
        logger.log('Сетевые настройки изменены: ' + netConfig.describe(wanted));
        res.json({ ok: true });
        netConfig.reboot();
    } catch(e) {
        console.error('[network] apply error:', e.message);
        res.status(500).json({ error: e.message || 'Ошибка применения сетевых настроек' });
    }
});

// ── Обновление программы ──────────────────────────────────────────────────────

// Пакет приезжает телом запроса: архив tar.gz, имя и контрольная сумма — в
// заголовках. То же самое приходит по RS-485 кадром {"upd":…} (serialSource.js).
router.post('/api/update/package',
    auth.requireAuth,
    express.raw({ type: '*/*', limit: updatePackage.MAX_BYTES }),
    function (req, res) {
        const err = updatePackage.apply({
            name:    req.get('x-update-name'),
            sha256:  req.get('x-update-sha256'),
            channel: 'TCP/IP'
        }, req.body);
        if (err) return res.status(400).json({ error: err });
        res.json({ ok: true });
    });

module.exports = router;

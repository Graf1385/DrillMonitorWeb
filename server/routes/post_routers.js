const express     = require('express');
const router      = express.Router();
const db          = require('../db');
const sse         = require('../sse');
const multer      = require('multer');
const logger      = require('../logger');
const dataSource  = require('../dataSource');
const auth        = require('../auth');
const { execFileSync } = require('child_process');

const _upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'audio/mpeg' || file.originalname.endsWith('.mp3')) cb(null, true);
        else cb(new Error('Только MP3 файлы'));
    }
});

router.post('/api/auth/login', (req, res) => {
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
        dataSource.refreshWatchedParams();
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
        dataSource.refreshWatchedParams();
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

router.post('/api/parameters/import', (req, res) => {
    try {
        const params = req.body.parameters;
        if (!Array.isArray(params)) return res.status(400).json({ error: 'parameters must be an array' });
        db.importParameters(params);
        res.status(200).json({ ok: true, count: params.length });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/api/units', (req, res) => {
    try {
        const { name, symbol } = req.body;
        if (!name || !symbol) return res.status(400).json({ error: 'name и symbol обязательны' });
        const result = db.createUnit(name.trim(), symbol.trim());
        res.status(201).json({ id: result.lastInsertRowid });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/api/units/import', (req, res) => {
    try {
        const units = req.body.units;
        if (!Array.isArray(units)) return res.status(400).json({ error: 'units must be an array' });
        db.importUnits(units);
        res.status(200).json({ ok: true, count: units.length });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.put('/api/units/:id', (req, res) => {
    try {
        const { name, symbol } = req.body;
        if (!name || !symbol) return res.status(400).json({ error: 'name и symbol обязательны' });
        const result = db.updateUnit(parseInt(req.params.id), name.trim(), symbol.trim());
        if (result.changes === 0) return res.status(404).json({ error: 'Единица не найдена' });
        res.status(200).json({ ok: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.delete('/api/units/:id', (req, res) => {
    try {
        const result = db.deleteUnit(parseInt(req.params.id));
        if (result.changes === 0) return res.status(404).json({ error: 'Единица не найдена' });
        res.status(200).json({ ok: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/api/parameters', (req, res) => {
    try {
        const { id, name, typeId, unitId, size, accuracy, refUnit } = req.body;
        if (id == null || !name) return res.status(400).json({ error: 'id и name обязательны' });
        db.createParameter(
            parseInt(id), name.trim(),
            typeId != null ? parseInt(typeId) : null,
            unitId ? parseInt(unitId) : null,
            size != null ? parseInt(size) : undefined,
            accuracy != null ? parseInt(accuracy) : undefined,
            refUnit != null ? refUnit : undefined
        );
        res.status(201).json({ ok: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.put('/api/parameters/:id', (req, res) => {
    try {
        const { name, typeId, unitId } = req.body;
        if (!name) return res.status(400).json({ error: 'name обязателен' });
        const result = db.updateParameter(
            parseInt(req.params.id),
            name.trim(),
            typeId != null ? parseInt(typeId) : null,
            unitId ? parseInt(unitId) : null
        );
        if (result.changes === 0) return res.status(404).json({ error: 'Параметр не найден' });
        res.status(200).json({ ok: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.delete('/api/parameters/:id', (req, res) => {
    try {
        const result = db.deleteParameter(parseInt(req.params.id));
        if (result.changes === 0) return res.status(404).json({ error: 'Параметр не найден' });
        res.status(200).json({ ok: true });
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

router.delete('/api/logs', (req, res) => {
    try {
        db.clearLogs();
        res.status(200).json({ ok: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.delete('/api/alarm-sounds/:id', (req, res) => {
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

router.delete('/api/profiles/:id', (req, res) => {
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
    try {
        var mode = String(req.body.mode || '');
        if (mode === 'dhcp') {
            execFileSync('sudo', ['/opt/drillmonitor/scripts/set-network.sh', 'dhcp'], { timeout: 15000 });
        } else if (mode === 'static') {
            var address = String(req.body.address || '');
            var prefix  = parseInt(req.body.prefix, 10);
            var gateway = String(req.body.gateway || '');
            var dns     = String(req.body.dns || '8.8.8.8');
            var ipRe = /^(\d{1,3}\.){3}\d{1,3}$/;
            if (!ipRe.test(address)) return res.status(400).json({ error: 'Неверный IP-адрес' });
            if (!ipRe.test(gateway)) return res.status(400).json({ error: 'Неверный адрес шлюза' });
            if (isNaN(prefix) || prefix < 1 || prefix > 32) return res.status(400).json({ error: 'Неверная маска' });
            execFileSync('sudo', ['/opt/drillmonitor/scripts/set-network.sh', 'static', address + '/' + prefix, gateway, dns], { timeout: 15000 });
        } else {
            return res.status(400).json({ error: 'Неверный режим' });
        }
        logger.log('Сетевые настройки изменены: ' + mode);
        res.json({ ok: true });
    } catch(e) {
        console.error('[network] apply error:', e.message);
        res.status(500).json({ error: 'Ошибка применения сетевых настроек' });
    }
});

module.exports = router;

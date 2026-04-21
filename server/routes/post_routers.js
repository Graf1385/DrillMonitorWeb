const express = require('express');
const router = express.Router();
const helper = require('../helper');
const db = require('../db');
const sse = require('../sse');
const multer = require('multer');

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
        res.json({ ok: true });
    } else {
        res.status(401).json({ ok: false });
    }
});

router.post('/setSettings', (req, res) => {
    try {
        var settings = JSON.parse(req.body.settings)
        helper.saveSettings(settings);
        res.status(200).send();

    } catch (error) {
        res.status(400).send();
        console.log(error);
    }
});

router.post('/api/profiles', (req, res) => {
    try {
        const { name, background, cellSize } = req.body;
        if (!name || !background || !cellSize) {
            return res.status(400).json({ error: 'name, background и cellSize обязательны' });
        }
        const result = db.createProfile(name, background, parseInt(cellSize));
        res.status(201).json({ id: result.lastInsertRowid });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.put('/api/profiles/:id', (req, res) => {
    try {
        const { background, cellSize, alarmSoundId, alarmVolume, alarmDelay } = req.body;
        if (!background || !cellSize) {
            return res.status(400).json({ error: 'background и cellSize обязательны' });
        }
        const result = db.updateProfile(
            parseInt(req.params.id),
            background,
            parseInt(cellSize),
            alarmSoundId ? parseInt(alarmSoundId) : null,
            parseInt(alarmVolume) || 50,
            parseFloat(alarmDelay) || 2
        );
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Профиль не найден' });
        }
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
        sse.broadcast('workspace-saved', db.getProfile(profileId));
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
        res.status(201).json({ id: result.lastInsertRowid });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.delete('/api/alarm-sounds/:id', (req, res) => {
    try {
        const result = db.deleteAlarmSound(parseInt(req.params.id));
        if (result.changes === 0) return res.status(404).json({ error: 'Звук не найден' });
        res.status(200).json({ ok: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});


router.delete('/api/profiles/:id', (req, res) => {
    try {
        const result = db.deleteProfile(parseInt(req.params.id));
        if (result.changes === 0) {
            return res.status(403).json({ error: 'Профиль не найден или является стандартным' });
        }
        res.status(200).json({ ok: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
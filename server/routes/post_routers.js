const express = require('express');
const router = express.Router();
const helper = require('../helper');
const db = require('../db');
const sse = require('../sse');

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
        const { background, cellSize } = req.body;
        if (!background || !cellSize) {
            return res.status(400).json({ error: 'background и cellSize обязательны' });
        }
        const result = db.updateProfile(parseInt(req.params.id), background, parseInt(cellSize));
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Профиль не найден' });
        }
        sse.broadcast('profile-activated', db.getProfile(parseInt(req.params.id)));
        res.status(200).json({ ok: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.post('/api/profiles/:id/select', (req, res) => {
    try {
        const profile = db.getProfile(parseInt(req.params.id));
        if (!profile) return res.status(404).json({ error: 'Профиль не найден' });
        sse.broadcast('profile-selected', profile);
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
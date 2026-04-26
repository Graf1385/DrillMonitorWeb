const express = require('express');
const router = express.Router();
const helper = require('../helper');
const db = require('../db');
const sse = require('../sse');

router.get('/', (req, res) =>{
    res.render('index');
});

router.get('/getSettings',(req, res) =>{
    try {
        var settings = helper.getSettings();
        res.status(200).send(JSON.stringify(settings));
    } catch (error) {
        console.log(error);
        res.status(400).json({ error: error.message });
    }
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

router.get('/api/units', (req, res) => {
    try {
        res.status(200).json(db.getUnits());
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/api/parameters', (req, res) => {
    try {
        res.status(200).json(db.getParameters());
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

router.get('/api/data-types', (req, res) => {
    try {
        res.status(200).json(db.getDataTypes());
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


router.get('/api/events', (req, res) => {
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.flushHeaders();

    res.write(':\n\n'); // initial ping

    sse.addClient(res);
    req.on('close', () => sse.removeClient(res));
});

module.exports = router;
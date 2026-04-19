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

router.get('/api/parameters', (req, res) => {
    try {
        res.status(200).json(db.getParameters());
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
'use strict';

const express    = require('express');
const router     = express.Router();
const dataSource = require('../dataSource');

router.get('/api/data-source/settings', function (req, res) {
    res.json(dataSource.getSettings());
});

router.post('/api/data-source/settings', function (req, res) {
    try {
        res.json({ ok: true, settings: dataSource.saveSettings(req.body) });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/data-source/check-path', function (req, res) {
    res.json(dataSource.checkPath(req.body && req.body.storePath));
});

module.exports = router;

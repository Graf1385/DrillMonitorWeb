'use strict';

const express    = require('express');
const router     = express.Router();
const dataSource = require('../dataSource');
const sse        = require('../sse');

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

router.post('/api/data-source/start', function (req, res) {
    const settings = dataSource.setRunning(true);
    dataSource.startPolling(function (record) {
        sse.broadcast('drill-data', {
            recNo:  record.recNo,
            depth:  record.depth,
            time:   record.time,
            params: Object.fromEntries(record.params),
        });
    });
    res.json({ ok: true, settings });
});

router.post('/api/data-source/stop', function (req, res) {
    dataSource.stopPolling();
    const settings = dataSource.setRunning(false);
    res.json({ ok: true, settings });
});

module.exports = router;

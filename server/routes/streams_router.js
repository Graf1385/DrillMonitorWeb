const express       = require('express');
const router        = express.Router();
const path          = require('path');
const fs            = require('fs');
const streamManager = require('../streams/StreamManager');

const STREAM_KEY_RE = /^[a-zA-Z0-9_-]{1,64}$/;

router.post('/api/streams/start', (req, res) => {
    try {
        const { streamKey, rtspUrl, host, port, username, password, channel, substream } = req.body;
        if (!streamKey || !STREAM_KEY_RE.test(streamKey)) return res.status(400).json({ error: 'Invalid streamKey' });
        const url = streamManager.buildRtspUrl({ rtspUrl, host, port, username, password, channel, substream });
        streamManager.start(streamKey, url);
        res.json({ ok: true, hlsUrl: `/api/streams/${streamKey}/index.m3u8` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/api/streams/stop', (req, res) => {
    try {
        const { streamKey } = req.body;
        if (streamKey) streamManager.stop(streamKey);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/streams/:key/index.m3u8', (req, res) => {
    if (!STREAM_KEY_RE.test(req.params.key)) return res.status(400).end();
    const hlsDir = streamManager.getHlsDir(req.params.key);
    if (!hlsDir) return res.status(404).json({ error: 'Stream not active' });
    const file = path.join(hlsDir, 'index.m3u8');
    if (!fs.existsSync(file)) return res.status(503).json({ error: 'Stream not ready yet' });
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(file);
});

router.get('/api/streams/:key/:segment', (req, res) => {
    const { key, segment } = req.params;
    if (!STREAM_KEY_RE.test(key)) return res.status(400).end();
    if (!/^[a-zA-Z0-9_-]+\.ts$/.test(segment)) return res.status(400).end();
    const hlsDir = streamManager.getHlsDir(key);
    if (!hlsDir) return res.status(404).end();
    const file = path.join(hlsDir, segment);
    if (!file.startsWith(hlsDir + path.sep) && file !== hlsDir) return res.status(400).end();
    if (!fs.existsSync(file)) return res.status(404).end();
    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(file);
});

module.exports = router;

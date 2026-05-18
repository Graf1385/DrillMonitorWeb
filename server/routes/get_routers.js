const express  = require('express');
const https    = require('https');
const fs       = require('fs');
const { exec } = require('child_process');
const path     = require('path');
const router   = express.Router();
const db       = require('../db');
const sse      = require('../sse');
const pkg      = require('../../package.json');

const ROOT_DIR = path.join(__dirname, '..', '..');

// ── Rate limiter ──────────────────────────────────────────────────────────────

const _rlMap = new Map();
function _isRateLimited(ip, max, windowMs) {
    const now   = Date.now();
    let   entry = _rlMap.get(ip);
    if (!entry || now > entry.reset) entry = { count: 0, reset: now + windowMs };
    entry.count++;
    _rlMap.set(ip, entry);
    return entry.count > max;
}
setInterval(function () {
    const now = Date.now();
    for (const [k, v] of _rlMap) if (now > v.reset) _rlMap.delete(k);
}, 5 * 60 * 1000);

// ── Update checker ────────────────────────────────────────────────────────────

const GITHUB_REPO  = 'Graf1385/DrillMonitorWeb';
const UPDATE_TTL   = 60 * 60 * 1000; // 1 hour cache
let _updateCache   = null;
let _updateCacheAt = 0;

function _semverGt(a, b) {
    var ap = a.split('.').map(Number);
    var bp = b.split('.').map(Number);
    for (var i = 0; i < 3; i++) {
        if ((ap[i] || 0) > (bp[i] || 0)) return true;
        if ((ap[i] || 0) < (bp[i] || 0)) return false;
    }
    return false;
}

function _fetchLatestRelease(cb) {
    var options = {
        hostname: 'api.github.com',
        path:     '/repos/' + GITHUB_REPO + '/releases/latest',
        headers:  { 'User-Agent': 'DrillMonitorWeb/' + pkg.version }
    };
    var req = https.get(options, function (res) {
        var raw = '';
        res.on('data', function (c) { raw += c; });
        res.on('end', function () {
            try {
                var data    = JSON.parse(raw);
                var tag     = (data.tag_name || '').replace(/^v/, '');
                var current = pkg.version;
                cb(null, {
                    current:    current,
                    latest:     tag || null,
                    hasUpdate:  !!(tag && _semverGt(tag, current)),
                    releaseUrl: data.html_url || null
                });
            } catch (e) { cb(e); }
        });
    });
    req.setTimeout(6000, function () { req.destroy(); });
    req.on('error', cb);
}

router.get('/', (req, res) =>{
    res.render('index');
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

router.get('/api/profiles/:id/indicators/active', (req, res) => {
    try {
        res.status(200).json(db.getActiveIndicatorsByProfile(parseInt(req.params.id)));
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


router.get('/api/update/check', function (req, res) {
    if (_isRateLimited(req.ip || 'unknown', 20, 60 * 1000)) {
        return res.status(429).json({ error: 'Слишком много запросов' });
    }
    var now = Date.now();
    if (_updateCache && (now - _updateCacheAt) < UPDATE_TTL) {
        return res.json(_updateCache);
    }
    _fetchLatestRelease(function (err, result) {
        if (err) {
            return res.status(503).json({ error: 'GitHub недоступен' });
        }
        _updateCache   = result;
        _updateCacheAt = Date.now();
        res.json(result);
    });
});

router.get('/api/health', (req, res) => {
    res.json({ ok: true, version: pkg.version });
});

// ── Auto-updater ──────────────────────────────────────────────────────────────

let _updateInProgress = false;

function _runCmd(cmd, opts) {
    return new Promise(function (resolve, reject) {
        exec(cmd, opts, function (err, stdout, stderr) {
            if (err) reject(new Error(stderr || err.message));
            else resolve(stdout.trim());
        });
    });
}

function _getTarballUrl(token) {
    return new Promise(function (resolve, reject) {
        var opts = {
            hostname: 'api.github.com',
            path:     '/repos/' + GITHUB_REPO + '/releases/latest',
            headers:  { 'Authorization': 'token ' + token, 'User-Agent': 'DrillMonitorWeb/' + pkg.version }
        };
        https.get(opts, function (res) {
            var raw = '';
            res.on('data', function (c) { raw += c; });
            res.on('end', function () {
                try {
                    var data = JSON.parse(raw);
                    if (!data.tarball_url) return reject(new Error('tarball_url не найден'));
                    resolve(data.tarball_url);
                } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

function _downloadFile(url, dest, token, hops) {
    return new Promise(function (resolve, reject) {
        if ((hops || 0) > 5) return reject(new Error('Слишком много редиректов'));
        var p    = new URL(url);
        var hdrs = { 'User-Agent': 'DrillMonitorWeb/' + pkg.version };
        if (token) hdrs['Authorization'] = 'token ' + token;
        https.get({ hostname: p.hostname, path: p.pathname + p.search, headers: hdrs }, function (res) {
            if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
                res.resume();
                return _downloadFile(res.headers.location, dest, null, (hops || 0) + 1)
                    .then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
            var file = fs.createWriteStream(dest);
            res.pipe(file);
            file.on('finish', function () { file.close(resolve); });
            file.on('error', reject);
            res.on('error', reject);
        }).on('error', reject);
    });
}

router.post('/api/update/apply', async (req, res) => {
    if (_updateInProgress) {
        return res.status(409).json({ error: 'Обновление уже выполняется' });
    }
    _updateInProgress = true;

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
        _updateInProgress = false;
        return res.status(500).json({ error: 'GITHUB_TOKEN не настроен' });
    }

    const WORK_DIR = '/tmp/drillmonitor-update';
    const TARBALL  = '/tmp/drillmonitor-update.tar.gz';

    try {
        const tarballUrl = await _getTarballUrl(token);
        await _downloadFile(tarballUrl, TARBALL, token, 0);

        await _runCmd('rm -rf ' + WORK_DIR + ' && mkdir -p ' + WORK_DIR, { timeout: 10000 });
        await _runCmd('tar xzf ' + TARBALL + ' -C ' + WORK_DIR + ' --strip-components=1', { timeout: 30000 });

        await _runCmd(
            'rsync -a --delete' +
            ' --exclude=".git/"' +
            ' --exclude=".env"' +
            ' --exclude="node_modules/"' +
            ' --exclude="server/data/"' +
            ' ' + WORK_DIR + '/ ' + ROOT_DIR + '/',
            { timeout: 30000 }
        );

        await _runCmd('npm install --omit=dev --no-fund --no-audit', { cwd: ROOT_DIR, timeout: 120000 });
        await _runCmd('rm -rf ' + WORK_DIR + ' ' + TARBALL, { timeout: 10000 });

        _updateCache   = null;
        _updateCacheAt = 0;
        res.json({ ok: true });

        setTimeout(function () {
            exec('pm2 restart DrillMonitor', function (err) {
                if (err) {
                    console.error('[update] pm2 restart failed:', err.message);
                    process.exit(0);
                }
            });
        }, 800);

    } catch (e) {
        _updateInProgress = false;
        console.error('[update] apply error:', e.message);
        exec('rm -rf ' + WORK_DIR + ' ' + TARBALL);
        res.status(500).json({ error: e.message });
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
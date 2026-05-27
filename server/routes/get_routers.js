const express  = require('express');
const https    = require('https');
const fs       = require('fs');
const { exec, execFileSync } = require('child_process');
const path     = require('path');
const router   = express.Router();
const db         = require('../db');
const sse        = require('../sse');
const dataSource = require('../dataSource');
const pkg      = require('../../package.json');
const auth     = require('../auth');

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

const GITHUB_REPO = 'Graf1385/DrillMonitorWeb';
let _updateCache  = null;

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
    var token = process.env.GITHUB_TOKEN;
    var hdrs  = { 'User-Agent': 'DrillMonitorWeb/' + pkg.version };
    if (token) hdrs['Authorization'] = 'token ' + token;
    var options = {
        hostname: 'api.github.com',
        path:     '/repos/' + GITHUB_REPO + '/releases/latest',
        headers:  hdrs
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

router.get('/api/indicators/active', (req, res) => {
    try {
        res.status(200).json(db.getActiveIndicators());
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
    _fetchLatestRelease(function (err, result) {
        if (err) {
            return res.status(503).json({ error: 'GitHub недоступен' });
        }
        _updateCache = result;
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

function _spawnDetached(cmd, args, opts) {
    const { spawn } = require('child_process');
    const child = spawn(cmd, args, Object.assign({ detached: true, stdio: 'ignore', env: process.env }, opts));
    child.unref();
}

router.post('/api/update/apply', auth.requireAuth, async (req, res) => {
    if (_updateInProgress) {
        return res.status(409).json({ error: 'Обновление уже выполняется' });
    }
    _updateInProgress = true;

    try {
        const token = process.env.GITHUB_TOKEN;
        const fetchCmd = token
            ? 'git fetch --tags https://x-access-token:' + token + '@github.com/' + GITHUB_REPO
            : 'git fetch --tags origin';

        await _runCmd(fetchCmd, { cwd: ROOT_DIR, timeout: 30000 });

        // Reset to release tag; fall back to origin/main if tag unknown
        const tag = (_updateCache && _updateCache.latest) ? ('v' + _updateCache.latest) : 'origin/main';
        await _runCmd('git reset --hard ' + tag,                    { cwd: ROOT_DIR, timeout: 15000  });
        await _runCmd('npm install --omit=dev --no-fund --no-audit', { cwd: ROOT_DIR, timeout: 120000 });

        _updateCache = null;
        res.json({ ok: true });

        setTimeout(function () {
            exec('sudo /sbin/reboot', function (err) {
                if (err) {
                    console.error('[update] reboot failed, trying pm2:', err.message);
                    exec('pm2 restart DrillMonitor', function (err2) {
                        if (err2) {
                            _spawnDetached(process.execPath, [path.join(ROOT_DIR, 'app.js')], { cwd: ROOT_DIR });
                            process.exit(0);
                        }
                    });
                }
            });
        }, 800);

    } catch (e) {
        _updateInProgress = false;
        console.error('[update] apply error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

router.get('/api/events', (req, res) => {
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.flushHeaders();

    res.write(':\n\n'); // initial ping

    // Send current run-state immediately so reconnecting clients restore banner/clear state
    const state = dataSource.getRunState();
    if (!state.running) {
        res.write(`event: run-state\ndata: ${JSON.stringify(state)}\n\n`);
    }

    sse.addClient(res);
    req.on('close', () => sse.removeClient(res));
});

// ── Network settings ──────────────────────────────────────────────────────────

router.get('/api/network', auth.requireAuth, function(req, res) {
    try {
        var out = execFileSync('nmcli', [
            '-t', '-f', 'ipv4.method,ipv4.addresses,ipv4.gateway,ipv4.dns',
            'con', 'show', 'Wired connection 1'
        ], { timeout: 5000 }).toString().trim();
        var data = {};
        out.split('\n').forEach(function(line) {
            var idx = line.indexOf(':');
            if (idx !== -1) data[line.slice(0, idx)] = line.slice(idx + 1);
        });
        var addr  = data['ipv4.addresses'] || '';
        var parts = addr.split('/');
        res.json({
            mode:    data['ipv4.method'] === 'manual' ? 'static' : 'dhcp',
            address: parts[0] || '',
            prefix:  parts[1] || '24',
            gateway: data['ipv4.gateway'] || '',
            dns:     data['ipv4.dns'] || ''
        });
    } catch(e) {
        res.status(500).json({ error: 'Ошибка чтения сетевых настроек' });
    }
});

module.exports = router;
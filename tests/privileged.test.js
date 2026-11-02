'use strict';

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const { execFileSync, spawnSync } = require('child_process');

// Root-помощники (scripts/apply-update.py, scripts/set-network.sh) запускаются
// через sudo, и вызвать их может любой код службы — поэтому каждый сам
// проверяет то, что ему дали. Здесь проверяется именно это, без root:
// установщик — в режиме --check, сетевой скрипт — на аргументах, которые он
// должен отклонить до обращения к nmcli.

const SCRIPTS = path.join(__dirname, '..', 'scripts');
const UPDATE  = path.join(SCRIPTS, 'apply-update.py');
const NETWORK = path.join(SCRIPTS, 'set-network.sh');

function has(cmd) {
    return spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0;
}
const linux    = process.platform === 'linux';
const noPython = !linux || !has('python3');
const noBash   = !linux || !has('bash');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-priv-test-'));
after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} });

let _n = 0;
/// Собрать tar.gz из каталога, наполненного fill(dir).
function pack(fill, entries) {
    const dir = path.join(tmp, 'pkg' + (++_n));
    fs.mkdirSync(dir, { recursive: true });
    fill(dir);
    const out = path.join(tmp, 'pkg' + _n + '.tgz');
    execFileSync('tar', ['-czf', out, '-C', dir].concat(entries || ['.']), { timeout: 60000 });
    return out;
}

function write(dir, rel, text) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
}

function check(file) {
    const r = spawnSync('python3', [UPDATE, '--check', file], { encoding: 'utf8' });
    return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}

const base = (d) => {
    write(d, 'package.json', JSON.stringify({ name: 'drillmonitorweb', version: '9.9.9' }));
    write(d, 'server/server.js', '// сервер');
};

describe('apply-update.py --check', { skip: noPython && 'нужны Linux и python3' }, () => {
    test('принимает обычный пакет, в том числе с «./» в корне', () => {
        const r = check(pack(base));
        assert.equal(r.code, 0, r.err);
        const info = JSON.parse(r.out);
        assert.equal(info.version, '9.9.9');
    });

    test('рабочее состояние табло не ставится', () => {
        const r = check(pack((d) => {
            base(d);
            write(d, 'server/data/profiles.db', 'SQLite format 3');
            write(d, 'server/data/parameters.json', '[]');
        }));
        assert.equal(r.code, 0, r.err);
        assert.deepEqual(JSON.parse(r.out).skipped, ['server/data/profiles.db']);
    });

    test('отклоняет ссылку за пределы установки', () => {
        const r = check(pack((d) => {
            base(d);
            fs.symlinkSync('/etc/shadow', path.join(d, 'server', 'evil'));
        }));
        assert.equal(r.code, 1);
        assert.match(r.err, /за пределы установки/);
    });

    test('отклоняет относительную ссылку, уходящую наверх', () => {
        const r = check(pack((d) => {
            base(d);
            fs.symlinkSync('../../etc', path.join(d, 'server', 'up'));
        }));
        assert.equal(r.code, 1);
        assert.match(r.err, /за пределы установки/);
    });

    test('пропускает ссылку внутри установки (node_modules/.bin)', () => {
        const r = check(pack((d) => {
            base(d);
            write(d, 'node_modules/semver/bin/semver.js', '');
            fs.mkdirSync(path.join(d, 'node_modules', '.bin'));
            fs.symlinkSync('../semver/bin/semver.js', path.join(d, 'node_modules', '.bin', 'semver'));
        }));
        assert.equal(r.code, 0, r.err);
    });

    test('отклоняет «..» в пути', () => {
        // Системный tar при упаковке такие имена чистит — собираем архив сами
        const out = path.join(tmp, 'dotdot.tgz');
        execFileSync('python3', ['-c', [
            'import io, sys, tarfile',
            'with tarfile.open(sys.argv[1], "w:gz") as t:',
            '    for name, data in (("package.json", b"{}"), ("server/../../evil", b"x")):',
            '        ti = tarfile.TarInfo(name); ti.size = len(data)',
            '        t.addfile(ti, io.BytesIO(data))',
        ].join('\n'), out]);
        const r = check(out);
        assert.equal(r.code, 1);
        assert.match(r.err, /Недопустимый путь/);
    });

    test('отклоняет посторонний архив', () => {
        const r = check(pack((d) => write(d, 'readme.txt', 'не тот пакет'), ['readme.txt']));
        assert.equal(r.code, 1);
        assert.match(r.err, /не пакет DrillMonitorWeb/);
    });

    test('без --check и не от root ничего не ставит', { skip: process.getuid && process.getuid() === 0 }, () => {
        const r = spawnSync('python3', [UPDATE, pack(base)], { encoding: 'utf8' });
        assert.equal(r.status, 1);
        assert.match(r.stderr, /требует root/);
    });
});

describe('set-network.sh', { skip: noBash && 'нужны Linux и bash' }, () => {
    function run(args) {
        return spawnSync('bash', [NETWORK].concat(args), { encoding: 'utf8' });
    }

    test('отклоняет неизвестную команду', () => {
        assert.equal(run(['fix-ownership']).status, 1);
        assert.equal(run([]).status, 1);
    });

    test('вне Linux и у новой установки прежних путей нет', () => {
        const privileged = require('../server/privileged');
        if (!privileged.isLegacy()) {
            assert.equal(privileged.NETWORK, path.join(privileged.DIR, 'set-network.sh'));
            assert.equal(privileged.TIME,    path.join(privileged.DIR, 'set-time.sh'));
        }
    });

    test('migrate работает только из старой установки', () => {
        const r = run(['migrate']);
        assert.equal(r.status, 1);
        assert.match(r.stderr, /только из старой установки/);
    });

    test('все скрипты разбираются bash', () => {
        for (const f of fs.readdirSync(SCRIPTS).filter((f) => f.endsWith('.sh'))) {
            const r = spawnSync('bash', ['-n', path.join(SCRIPTS, f)], { encoding: 'utf8' });
            assert.equal(r.status, 0, f + ': ' + r.stderr);
        }
    });

    test('отклоняет кривой адрес до обращения к nmcli', () => {
        for (const bad of ['', '10.0.0.1', '10.0.0.256/24', '10.0.0.1/33', '10.0.0.1/0',
                           '10.0.0.1/24;reboot', '-h', 'a.b.c.d/24']) {
            const r = run(['static', bad]);
            assert.equal(r.status, 1, 'адрес «' + bad + '» должен быть отклонён');
            assert.match(r.stderr, /bad (address|prefix)/);
        }
    });
});

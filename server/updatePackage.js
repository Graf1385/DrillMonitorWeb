'use strict';

// ── Обновление программы табло из BCS_DrillerMonitorLoader ────────────────────
//
// В интернет табло не ходит (ни шлюза, ни DNS — см. netConfig.js), поэтому новая
// версия приезжает из Loader: по TCP — POST /api/update/package с телом-архивом,
// по RS-485 — кадром {"upd":{…}} с архивом в base64, нарезанным на части cfgSeq.
//
// Архив — обычный tar.gz, распаковывает его системный tar поверх установки.
// Файлы, удалённые в новом релизе, на диске остаются: так распаковка не может
// снести server/data с базой профилей. npm install не запускаем — без интернета
// он невозможен, поэтому пакет без node_modules и с другими зависимостями
// отклоняется: ставить его было бы нечем.

const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const crypto  = require('crypto');
const { execFileSync } = require('child_process');

const logger    = require('./logger');
const netConfig = require('./netConfig');

const ROOT        = path.join(__dirname, '..');
const BACKUP_DIR  = path.join(ROOT, 'backup');
const KEEP_BACKUPS = 3;

/// Потолок пакета: полный с node_modules — около 35 МБ, запас троекратный.
const MAX_BYTES = 100 * 1024 * 1024;

/// Каталоги установки, которые имеет смысл сохранять перед распаковкой.
const BACKUP_PATHS = ['app.js', 'package.json', 'package-lock.json', 'server', 'public', 'scripts'];

// Рабочее состояние устройства: база профилей и настройки, нажитые на месте.
// В пакет они попадать не должны, но архив легко собрать из рабочего дерева
// вместе с ними — тогда табло потеряет свою базу или скорость линии. Поэтому
// такие файлы при распаковке пропускаются (список — это .gitignore проекта).
const RUNTIME_STATE = /^server\/data\/([^/]*\.db(-shm|-wal)?|serial-settings\.json|data-source-settings\.json)$/;

// ── Разбор и проверка архива ──────────────────────────────────────────────────

function _list(file) {
    return execFileSync('tar', ['-tzf', file], { timeout: 120000, maxBuffer: 64 * 1024 * 1024 })
        .toString()
        .split('\n')
        .map(function (s) { return s.trim().replace(/\\/g, '/'); })
        .filter(Boolean);
}

/// Выглядит ли список путей как корень установки DrillMonitorWeb.
function _looksLikeRoot(list) {
    return list.some(function (p) {
        return p === 'package.json' || p === 'app.js' ||
               p.indexOf('server/') === 0 || p.indexOf('public/') === 0;
    });
}

/// Общий верхний каталог («Graf1385-DrillMonitorWeb-9f3c1/») или null.
function _commonTop(list) {
    const top = list[0].split('/')[0];
    if (!top) return null;
    const all = list.every(function (p) { return p === top || p.indexOf(top + '/') === 0; });
    return all ? top : null;
}

/// Сколько компонентов пути снимать при распаковке; -1 — архив не наш.
function _stripDepth(list) {
    if (_looksLikeRoot(list)) return 0;
    const top = _commonTop(list);
    if (!top) return -1;
    const inner = list
        .filter(function (p) { return p.length > top.length + 1; })
        .map(function (p) { return p.slice(top.length + 1); });
    return _looksLikeRoot(inner) ? 1 : -1;
}

function _badEntry(list) {
    for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p.charAt(0) === '/' || /(^|\/)\.\.(\/|$)/.test(p))
            return 'Недопустимый путь в архиве: ' + p;
    }
    return null;
}

/// Ключи --exclude для tar: он сверяет их с именем до --strip-components.
function _excludeArgs(skipped, strip) {
    const args = [];
    skipped.forEach(function (rel) {
        args.push('--exclude=' + rel);
        if (strip) args.push('--exclude=*/' + rel);
    });
    return args;
}

/// Содержимое одного файла из архива (или null, если его там нет).
function _readFromArchive(file, entry) {
    try {
        return execFileSync('tar', ['-xzOf', file, entry], { timeout: 60000, maxBuffer: 8 * 1024 * 1024 })
            .toString();
    } catch (_) {
        return null;
    }
}

/// package.json в этом проекте лежит с BOM — JSON.parse на нём спотыкается.
function _parseJson(text) {
    try { return JSON.parse(String(text).replace(/^﻿/, '')); }
    catch (_) { return null; }
}

function _sortedDeps(pkg) {
    const d = (pkg && pkg.dependencies) || {};
    const out = {};
    Object.keys(d).sort().forEach(function (k) { out[k] = d[k]; });
    return JSON.stringify(out);
}

/**
 * Разобрать архив, не распаковывая его: сколько компонентов пути снимать, есть
 * ли в нём зависимости, какая версия. Возвращает { error } либо
 * { strip, withModules, version, entries }. Вынесено отдельно, чтобы проверять
 * опасную часть (пути, подмена базы, смена зависимостей) без записи на диск.
 */
function inspect(file) {
    let list;
    try { list = _list(file); }
    catch (e) { return { error: 'Не удалось прочитать архив: ' + (e.message || e) }; }
    if (!list.length) return { error: 'Архив пуст' };

    const strip = _stripDepth(list);
    if (strip < 0) return { error: 'Это не пакет DrillMonitorWeb: в архиве нет ни package.json, ни server/' };

    const bad = _badEntry(list);
    if (bad) return { error: bad };

    const rel = strip
        ? list.map(function (p) { return p.split('/').slice(strip).join('/'); })
        : list;
    const withModules = rel.some(function (p) { return p.indexOf('node_modules/') === 0; });
    const skipped     = rel.filter(function (p) { return RUNTIME_STATE.test(p); });

    let version = null;
    const idx = rel.indexOf('package.json');
    if (idx >= 0) {
        const fresh = _parseJson(_readFromArchive(file, list[idx]));
        if (!fresh) return { error: 'В архиве испорченный package.json' };
        version = fresh.version || null;

        // Зависимости менять нечем: npm install без интернета не отработает
        if (!withModules) {
            let cur = null;
            try { cur = _parseJson(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')); }
            catch (_) {}
            if (cur && _sortedDeps(cur) !== _sortedDeps(fresh))
                return { error: 'В новой версии другие зависимости, а node_modules в пакете нет: ' +
                                'без интернета установить их нечем — пришлите полный пакет' };
        }
    }

    return { strip: strip, withModules: withModules, version: version,
             skipped: skipped, entries: list };
}

// ── Сохранение прежней версии ─────────────────────────────────────────────────

function _backup(withModules) {
    try {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    } catch (_) { /* уже есть */ }

    const paths = BACKUP_PATHS.filter(function (p) { return fs.existsSync(path.join(ROOT, p)); });
    if (withModules && fs.existsSync(path.join(ROOT, 'node_modules'))) paths.push('node_modules');
    if (!paths.length) return null;

    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const name  = path.join(BACKUP_DIR, 'before-' + stamp + '.tgz');
    execFileSync('tar', ['-czf', name, '-C', ROOT, '--exclude=server/data/*.db*'].concat(paths),
                 { timeout: 300000 });

    // Держим только последние снимки: диска много, но не бесконечно
    const old = fs.readdirSync(BACKUP_DIR)
        .filter(function (f) { return /^before-\d{14}\.tgz$/.test(f); })
        .sort()
        .slice(0, -KEEP_BACKUPS);
    old.forEach(function (f) { try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch (_) {} });

    return name;
}

// ── Применение ────────────────────────────────────────────────────────────────

/// Пакет уже применяли — устройство перезагружается, повторы игнорируем.
let _latched = false;

/**
 * Применить пакет обновления. meta: { name, sha256, channel }.
 * Возвращает null при успехе или текст ошибки для оператора.
 * При успехе устройство перезагружается: другого способа поднять киоск на новой
 * версии нет, а `systemctl restart` этой службе не разрешён в sudoers.
 */
function apply(meta, buf) {
    if (_latched) return null;
    if (!Buffer.isBuffer(buf) || buf.length === 0) return 'Пустой пакет обновления';
    if (buf.length > MAX_BYTES)
        return 'Пакет больше ' + Math.round(MAX_BYTES / 1024 / 1024) + ' МБ';

    meta = meta || {};
    if (meta.sha256) {
        const got = crypto.createHash('sha256').update(buf).digest('hex');
        if (got.toLowerCase() !== String(meta.sha256).toLowerCase())
            return 'Пакет повреждён при передаче (контрольная сумма не сошлась)';
    }

    const file = path.join(os.tmpdir(), 'dm-update-' + Date.now() + '.tgz');
    try {
        fs.writeFileSync(file, buf);

        const info = inspect(file);
        if (info.error) return info.error;
        const strip = info.strip, withModules = info.withModules, version = info.version;

        let backup = null;
        try { backup = _backup(withModules); }
        catch (e) { return 'Не удалось сохранить прежнюю версию: ' + (e.message || e); }

        const args = ['-xzf', file, '-C', ROOT].concat(_excludeArgs(info.skipped, strip));
        if (strip) args.push('--strip-components=' + strip);
        try { execFileSync('tar', args, { timeout: 300000 }); }
        catch (e) { return 'Ошибка распаковки: ' + (e.message || e); }

        // Бит исполнения у скриптов возвращаем сами: без него перестанет
        // работать set-network.sh, а это единственный разрешённый путь к reboot
        try {
            const dir = path.join(ROOT, 'scripts');
            fs.readdirSync(dir)
                .filter(function (f) { return /\.sh$/.test(f); })
                .forEach(function (f) { fs.chmodSync(path.join(dir, f), 0o755); });
        } catch (_) { /* каталога может не быть в пакете */ }

        _latched = true;
        logger.log('Обновление' + (version ? ' до ' + version : '') + ' принято' +
                   (meta.channel ? ' по ' + meta.channel : '') +
                   ' (' + Math.round(buf.length / 1024) + ' КБ' +
                   (withModules ? ', с зависимостями' : '') + ')' +
                   (backup ? ', прежняя версия в ' + path.basename(backup) : '') +
                   (info.skipped.length
                       ? ', своё оставлено: ' + info.skipped.join(', ') : '') +
                   ' — перезагрузка');
        netConfig.reboot(1500);
        return null;
    } catch (e) {
        return 'Ошибка обновления: ' + (e.message || e);
    } finally {
        try { fs.unlinkSync(file); } catch (_) {}
    }
}

/// Кадр {"upd":{name,sha256,size,data}} с линии RS-485.
function ingestUpdate(upd) {
    if (!upd || typeof upd !== 'object') return 'Неверный формат пакета обновления';
    if (typeof upd.data !== 'string' || !upd.data) return 'В пакете обновления нет данных';

    let buf;
    try { buf = Buffer.from(upd.data, 'base64'); }
    catch (e) { return 'Пакет обновления не раскодировался'; }

    const size = parseInt(upd.size, 10);
    if (!isNaN(size) && size !== buf.length)
        return 'Пакет пришёл не целиком (' + buf.length + ' из ' + size + ' байт)';

    return apply({ name: upd.name, sha256: upd.sha256, channel: 'RS-485' }, buf);
}

module.exports = { apply, ingestUpdate, inspect, MAX_BYTES };

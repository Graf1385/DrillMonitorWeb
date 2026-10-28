'use strict';

// ── Самодиагностика табло ────────────────────────────────────────────────────
//
// К монитору на буровой доступа почти нет: клавиатуры у него нет, сети часто
// тоже — только линия RS-485 от Loader. Значит, неисправность должна либо
// чиниться сама, либо дождаться в логе того, кто однажды подключится.
//
// Раз в CHECK_MS опрашиваем подсистемы. В лог пишем только ПЕРЕХОДЫ — когда
// стало плохо и когда стало хорошо (с длительностью). Постоянная неисправность
// занимает в журнале одну строку, а не строку в пять секунд.
//
// Там, где починка возможна, делаем её сами и тоже записываем: переоткрыть
// порт RS-485, подчистить диск. Остальное — наблюдение: причина, по которой
// табло вело себя странно, должна остаться в логе.
//
// Сводку отдаёт GET /api/health: её читает и веб-интерфейс («Логи системы»),
// и Loader по TCP, когда сеть есть.

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const mono = require('./monotonic');

const ROOT          = path.join(__dirname, '..');
const WATCHDOG_LOG  = path.join(__dirname, 'data', 'watchdog.log');

const CHECK_MS      = 5000;
const INCIDENTS_MAX = 30;
const RECOVERIES_MAX = 15;

// RS-485
const NO_DATA_MS     = 2 * 60 * 1000;   // порт открыт, а кадров не было ни одного
const SILENCE_WARN_MS = 60 * 1000;      // линия была жива и замолчала
const SILENCE_FAIL_MS = 5 * 60 * 1000;
const REOPEN_MIN_MS   = 10 * 60 * 1000; // не переоткрывать порт чаще
/// Столько попыток на одно молчание: не помогло трижды — дело не в порте, и
/// долбить его всю ночь, пока выключен Loader, незачем
const REOPEN_TRIES    = 3;

// Диск
const DISK_WARN_PCT = 10, DISK_FAIL_PCT = 4;
const DISK_WARN_MB  = 300, DISK_FAIL_MB = 100;
const DISK_CLEAN_MIN_MS = 60 * 60 * 1000;

// Память
const MEM_WARN_PCT = 10, MEM_FAIL_PCT = 4;

/// Раньше этой даты системные часы заведомо не выставлены (NTP в сети буровой нет)
const MIN_EPOCH_MS = 1700000000000;     // 2023-11-14

// Видео. Сегмент HLS пишется раз в секунду (hls_time=1), поэтому пауза в
// пятнадцать секунд — это уже не задержка, а молчание. На первый сегмент
// после запуска даём больше: камере нужно время на отклик.
const VIDEO_SILENT_MS = 15 * 1000;
const VIDEO_WARMUP_MS = 20 * 1000;

const RANK = { ok: 0, off: 0, warn: 1, fail: 2 };

// ── Внешние зависимости (в тестах подменяются) ───────────────────────────────

let _logFn = null;
const _deps = {
    now:      function () { return Date.now(); },
    // Выдержки и паузы меряем монотонными часами: системные подводит timeSync
    // по данным Loader, и прыжок часов не должен смазывать диагностику
    mono:     function () { return mono.now(); },
    serial:   function () { return require('./serialSource').status(); },
    reopenSerial: function () { require('./serialSource').restart(); },
    pushMode: function () { return require('./dataSource').isPushMode(); },
    runState: function () { return require('./dataSource').getRunState(); },
    streams:  function () { return require('./streams/StreamManager').diag(); },
    cleanDisk: _cleanDisk,
    watchdogLog: WATCHDOG_LOG,
    statfs:   function (p) { return fs.statfsSync(p); },
    memory:   _readMemory,
    log:      function (msg) {
        // Логгер открывает БД и ставит таймеры — в тестах это лишнее
        if (!_logFn) _logFn = require('./logger').log;
        _logFn(msg);
    },
};

function _setDeps(partial) { Object.assign(_deps, partial); }

function _mono() { return _deps.mono(); }

function _log(msg) {
    try { _deps.log(msg); } catch (_) {}
    console.log('[diag] ' + msg);
}

// ── Форматирование ───────────────────────────────────────────────────────────

function _dur(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60)   return s + ' с';
    if (s < 3600) return Math.round(s / 60) + ' мин';
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    return h + ' ч' + (m ? ' ' + m + ' мин' : '');
}

function _mb(bytes) {
    const mb = bytes / (1024 * 1024);
    return mb >= 1024 ? (mb / 1024).toFixed(1) + ' ГБ' : Math.round(mb) + ' МБ';
}

// ── Состояние ────────────────────────────────────────────────────────────────

const _state      = new Map();   // id → { level, detail, sinceMono, sinceIso }
const _pending    = new Map();   // id → { level, detail, sinceMono } — ждёт подтверждения
const _open       = new Map();   // id → открытое происшествие
const _recoverAt  = new Map();   // ключ починки → когда делали в последний раз
const _incidents  = [];
const _recoveries = [];
let _timer       = null;
let _startedAt   = null;
let _serialTries = 0;    // попыток переоткрыть порт на текущее молчание линии

/**
 * Попытка самостоятельной починки. Одна и та же починка повторяется не чаще
 * minIntervalMs: если она не помогает, долбить ею систему бессмысленно.
 */
function _recover(key, what, minIntervalMs, fn) {
    const last = _recoverAt.has(key) ? _recoverAt.get(key) : -Infinity;
    if (_mono() - last < minIntervalMs) return false;
    _recoverAt.set(key, _mono());

    let err = null;
    try { fn(); } catch (e) { err = e && e.message ? e.message : String(e); }

    _recoveries.push({ at: new Date(_deps.now()).toISOString(), what: what, ok: !err, error: err });
    if (_recoveries.length > RECOVERIES_MAX) _recoveries.shift();
    _log('Самовосстановление: ' + what + (err ? ' — не удалось: ' + err : ''));
    return true;
}

/// Зафиксировать новый результат проверки: подтвердить, записать переход, залогировать.
function _record(probe, result) {
    const id  = probe.id;
    const lvl = result.level;

    // До первого замера считаем, что всё в порядке: неисправность, застигнутая
    // при запуске, пройдёт ту же выдержку, что и любая другая. Иначе каждая
    // загрузка табло писала бы в журнал пару «порт не найден / норма» — USB
    // перечисляется медленнее, чем поднимается служба.
    let prev = _state.get(id);
    if (!prev) {
        prev = { level: 'ok', detail: null, sinceMono: _mono(),
                 sinceIso: new Date(_deps.now()).toISOString() };
        _state.set(id, prev);
    }

    if (lvl === prev.level) {
        prev.detail = result.detail;     // подробность меняется молча (идут минуты тишины)
        _pending.delete(id);
        return;
    }

    // Ухудшение подтверждаем выдержкой: мигание не должно попадать в журнал
    if (RANK[lvl] > RANK[prev.level] && probe.confirmMs) {
        const p = _pending.get(id);
        if (!p || p.level !== lvl) {
            _pending.set(id, { level: lvl, detail: result.detail, sinceMono: _mono() });
            return;
        }
        p.detail = result.detail;
        if (_mono() - p.sinceMono < probe.confirmMs) return;
    }
    _pending.delete(id);

    const wasBad = RANK[prev.level] > 0;
    const heldMs = _mono() - prev.sinceMono;
    _state.set(id, { level: lvl, detail: result.detail,
                     sinceMono: _mono(), sinceIso: new Date(_deps.now()).toISOString() });

    if (RANK[lvl] > 0) {
        _openIncident(probe, result);
    } else if (wasBad) {
        _closeIncident(probe, heldMs);
        _log(probe.title + ': норма' + (result.detail ? ' — ' + result.detail : '') +
             ' (неисправность длилась ' + _dur(heldMs) + ')');
    }
}

function _openIncident(probe, result) {
    _log(probe.title + ': ' + result.detail);
    const inc = {
        id: probe.id, title: probe.title, level: result.level, detail: result.detail,
        startedAt: new Date(_deps.now()).toISOString(), endedAt: null, durationSec: null,
    };
    _open.set(probe.id, inc);
    _incidents.push(inc);
    if (_incidents.length > INCIDENTS_MAX) _incidents.shift();
}

function _closeIncident(probe, heldMs) {
    const inc = _open.get(probe.id);
    if (!inc) return;
    inc.endedAt     = new Date(_deps.now()).toISOString();
    inc.durationSec = Math.round(heldMs / 1000);
    _open.delete(probe.id);
}

// ── Проверки ─────────────────────────────────────────────────────────────────

/**
 * Приём по RS-485. Сторож порта (serialSource) чинит пропажу устройства сам;
 * здесь мы смотрим шире: линия может молчать и при живом, открытом порте —
 * выключили Loader, оборвался кабель, сбился преобразователь. Молчание после
 * работавшего обмена один раз за REOPEN_MIN_MS лечим переоткрытием порта.
 */
function _probeSerial() {
    const st = _deps.serial();
    if (!st)         return { level: 'off',  detail: 'сведений нет' };
    if (!st.enabled) return { level: 'off',  detail: 'приём по линии выключен в настройках' };

    // Данные идут — значит они идут по сети: кадры с линии попадают в тот же
    // push-режим, и при живом обмене по RS-485 молчания на ней не бывает.
    // Линия тогда просто не используется, и это не отказ табло.
    const overNetwork = _deps.pushMode() && _deps.runState().running;

    if (!st.open) {
        return { level: overNetwork ? 'warn' : 'fail',
                 detail: st.error || ('порт ' + st.port + ' не открыт') };
    }

    const where = (st.activePort && st.activePort !== st.port)
        ? st.activePort + ' (вместо ' + st.port + ')' : st.port;

    if (st.silenceMs == null) {
        if ((st.openMs || 0) > NO_DATA_MS)
            return { level: overNetwork ? 'off' : 'warn',
                     detail: overNetwork
                         ? 'линия не используется — данные идут по сети'
                         : 'порт ' + where + ' открыт ' + _dur(st.openMs) + ', кадров не было ни одного' };
        return { level: 'ok', detail: 'порт ' + where + ', ' + st.baud + ' бод' };
    }

    if (st.silenceMs > SILENCE_FAIL_MS) {
        // Переоткрывать порт, в который никто и не пишет, незачем: данные идут
        // по сети, а попытки восстановления только засоряют журнал
        if (overNetwork)
            return { level: 'off', detail: 'линия не используется — данные идут по сети' };
        if (_serialTries < REOPEN_TRIES &&
            _recover('serial-reopen', 'переоткрытие порта ' + where + ' после ' + _dur(st.silenceMs) + ' тишины',
                     REOPEN_MIN_MS, _deps.reopenSerial))
            _serialTries++;
        return { level: 'fail', detail: 'кадров с линии нет ' + _dur(st.silenceMs) };
    }
    if (st.silenceMs > SILENCE_WARN_MS)
        return { level: 'warn', detail: 'кадров с линии нет ' + _dur(st.silenceMs) };

    _serialTries = 0;   // кадры пошли — следующее молчание лечим заново
    return { level: 'ok', detail: 'порт ' + where + ', ' + st.baud + ' бод, кадров ' + st.framesOk };
}

/// Поступление данных — общее для обоих транспортов (TCP push и RS-485).
function _probeData() {
    if (!_deps.pushMode()) return { level: 'off', detail: 'данные ещё не поступали' };
    const rs = _deps.runState();
    if (rs.running) return { level: 'ok', detail: 'данные поступают' };
    return { level: 'fail', detail: 'данные не поступают' };
}

/**
 * Свободное место. Полный диск — тихий убийца киоска: SQLite перестаёт писать,
 * HLS-сегменты не удаляются, обновление не распаковывается. Чистим сами.
 */
function _probeDisk() {
    const points = [{ name: ROOT, path: ROOT }, { name: os.tmpdir(), path: os.tmpdir() }];
    let worst = null;

    points.forEach(function (pt) {
        let st;
        try { st = _deps.statfs(pt.path); } catch (_) { return; }
        const free  = Number(st.bavail) * Number(st.bsize);
        const total = Number(st.blocks) * Number(st.bsize);
        if (!(total > 0)) return;
        const pct = free / total * 100;
        if (!worst || pct < worst.pct) worst = { name: pt.name, free: free, pct: pct };
    });

    if (!worst) return { level: 'off', detail: 'сведений о диске нет' };

    const freeMb = worst.free / (1024 * 1024);
    const detail = 'свободно ' + _mb(worst.free) + ' (' + worst.pct.toFixed(0) + '%) на ' + worst.name;

    if (worst.pct < DISK_FAIL_PCT || freeMb < DISK_FAIL_MB) {
        _recover('disk-clean', 'очистка временных файлов, старых логов и резервных копий',
                 DISK_CLEAN_MIN_MS, _deps.cleanDisk);
        return { level: 'fail', detail: detail };
    }
    if (worst.pct < DISK_WARN_PCT || freeMb < DISK_WARN_MB)
        return { level: 'warn', detail: detail };
    return { level: 'ok', detail: detail };
}

/// Доступная память по /proc/meminfo: os.freemem() на Linux не считает кэш и
/// пугает без причины.
function _readMemory() {
    try {
        const txt = fs.readFileSync('/proc/meminfo', 'utf8');
        const avail = /MemAvailable:\s+(\d+) kB/.exec(txt);
        const total = /MemTotal:\s+(\d+) kB/.exec(txt);
        if (avail && total)
            return { available: Number(avail[1]) * 1024, total: Number(total[1]) * 1024 };
    } catch (_) {}
    return { available: os.freemem(), total: os.totalmem() };
}

function _probeMemory() {
    const m = _deps.memory();
    if (!m || !(m.total > 0)) return { level: 'off', detail: 'сведений о памяти нет' };
    const pct    = m.available / m.total * 100;
    const detail = 'свободно ' + _mb(m.available) + ' (' + pct.toFixed(0) + '%), процесс занимает ' +
                   _mb(process.memoryUsage().rss);
    if (pct < MEM_FAIL_PCT) return { level: 'fail', detail: detail };
    if (pct < MEM_WARN_PCT) return { level: 'warn', detail: detail };
    return { level: 'ok', detail: detail };
}

/// Часы. RTC у табло не держит время, NTP в сети буровой нет — часы подводит
/// timeSync по данным Loader. Пока данных не было, отметки времени в логе врут.
function _probeClock() {
    const now = _deps.now();
    if (now < MIN_EPOCH_MS)
        return { level: 'warn',
                 detail: 'часы не выставлены (' + new Date(now).toISOString().slice(0, 19) +
                         '), ждём время от Loader' };
    return { level: 'ok', detail: 'идут' };
}

/// Видеопотоки. Перезапуском упавшего ffmpeg занимается StreamManager; здесь —
/// видимость: сколько потоков просили и сколько из них сейчас живы.
function _probeVideo() {
    const list = _deps.streams();
    if (!list || !list.length) return { level: 'off', detail: 'видеопотоки не запускались' };

    const now  = _deps.now();
    const down = list.filter(function (s) { return !s.running; });

    // Процесс жив, а сегментов нет — обычная картина при недоступной камере:
    // ffmpeg висит на подключении и молчит. Раньше такой поток считался
    // исправным, и табло показывало чёрный прямоугольник при зелёной проверке.
    //
    // Выдержку на первый сегмент отсчитываем от начала потока (openedAt), а не
    // от последнего запуска ffmpeg: с недоступной камерой он падает и встаёт
    // каждые несколько секунд, startedAt всё время свежий — и выдержка не
    // истекала никогда.
    const mute = list.filter(function (s) {
        if (!s.running) return false;
        const since = s.openedAt || s.startedAt;
        return s.playlistAt
            ? now - s.playlistAt > VIDEO_SILENT_MS
            : now - since        > VIDEO_WARMUP_MS;
    });

    const names = function (a) { return a.map(function (s) { return s.key; }).join(', '); };
    if (down.length && mute.length)
        return { level: 'warn',
                 detail: 'не идёт ' + down.length + ' из ' + list.length + ': ' + names(down) +
                         '; без кадров: ' + names(mute) };
    if (down.length)
        return { level: 'warn',
                 detail: 'не идёт ' + down.length + ' из ' + list.length + ': ' + names(down) };
    if (mute.length)
        return { level: 'warn',
                 detail: 'нет кадров с камеры (' + names(mute) + ') — проверьте адрес и сеть' };
    return { level: 'ok', detail: 'потоков ' + list.length };
}

const PROBES = [
    { id: 'serial', title: 'RS-485',             confirmMs: 10000, run: _probeSerial },
    { id: 'data',   title: 'Поступление данных', confirmMs: 15000, run: _probeData   },
    { id: 'disk',   title: 'Место на диске',     confirmMs: 0,     run: _probeDisk   },
    { id: 'memory', title: 'Память',             confirmMs: 30000, run: _probeMemory },
    { id: 'clock',  title: 'Часы',               confirmMs: 0,     run: _probeClock  },
    { id: 'video',  title: 'Видеопотоки',        confirmMs: 10000, run: _probeVideo  },
];

// ── Уборка диска ─────────────────────────────────────────────────────────────

function _cleanDisk() {
    const streams = require('./streams/StreamManager');

    // Брошенные каталоги HLS: остаются, если процесс упал, не успев прибрать
    try {
        const base   = streams.hlsBase();
        const active = streams.activeKeys();
        fs.readdirSync(base).forEach(function (name) {
            if (active.indexOf(name) !== -1) return;
            fs.rmSync(path.join(base, name), { recursive: true, force: true });
        });
    } catch (_) {}

    // Резервные копии прежних версий — оставляем самую свежую
    try {
        const dir   = path.join(ROOT, 'backup');
        const files = fs.readdirSync(dir).filter(function (f) { return /\.tgz$/.test(f); }).sort();
        files.slice(0, -1).forEach(function (f) {
            try { fs.unlinkSync(path.join(dir, f)); } catch (_) {}
        });
    } catch (_) {}

    try { require('./db').deleteOldLogs(); } catch (_) {}
}

// ── Записи внешнего сторожа ──────────────────────────────────────────────────

/**
 * scripts/healthcheck.sh перезапускает службу, когда она перестала отвечать, и
 * оставляет строку в файле: сама служба в этот момент записать ничего не могла.
 * Забираем эти строки в общий журнал — иначе перезапуск остался бы незаметен.
 */
function _ingestWatchdogLog() {
    const file = _deps.watchdogLog;
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return; }
    const lines = text.split('\n').map(function (l) { return l.trim(); })
                      .filter(function (l) { return l.length; });
    if (!lines.length) return;
    lines.slice(-20).forEach(function (l) { _log('Внешний сторож: ' + l); });
    try { fs.writeFileSync(file, ''); } catch (_) {}
}

// ── Публичный интерфейс ──────────────────────────────────────────────────────

function tick() {
    PROBES.forEach(function (p) {
        let r;
        try { r = p.run(); }
        catch (e) { r = { level: 'warn', detail: 'проверка не выполнена: ' + (e && e.message ? e.message : e) }; }
        if (!r || !RANK.hasOwnProperty(r.level)) r = { level: 'warn', detail: 'проверка вернула пустой ответ' };
        _record(p, r);
    });
}

function start() {
    if (_timer) return;
    _startedAt = new Date(_deps.now()).toISOString();
    _ingestWatchdogLog();
    tick();
    _timer = setInterval(tick, CHECK_MS);
    _timer.unref();
}

function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
}

function snapshot() {
    const nowMono = _mono();
    const checks  = PROBES.map(function (p) {
        const s = _state.get(p.id);
        if (!s) return { id: p.id, title: p.title, level: 'off', detail: 'ещё не проверялось', since: null, forSec: 0 };
        return {
            id: p.id, title: p.title, level: s.level, detail: s.detail,
            since: s.sinceIso, forSec: Math.round((nowMono - s.sinceMono) / 1000),
        };
    });
    const worst = checks.reduce(function (acc, c) { return RANK[c.level] > RANK[acc] ? c.level : acc; }, 'ok');
    return {
        level:      worst,
        healthy:    worst !== 'fail',
        startedAt:  _startedAt,
        uptimeSec:  Math.round(process.uptime()),
        checks:     checks,
        incidents:  _incidents.slice().reverse(),
        recoveries: _recoveries.slice().reverse(),
    };
}

/// Сброс состояния (тесты)
function _reset() {
    stop();
    _state.clear(); _pending.clear(); _open.clear(); _recoverAt.clear();
    _incidents.length = 0; _recoveries.length = 0;
    _startedAt = null; _serialTries = 0;
}

module.exports = { start, stop, tick, snapshot, _setDeps, _reset, _dur, _ingestWatchdogLog, PROBES };

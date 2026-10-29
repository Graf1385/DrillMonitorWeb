'use strict';

// ── Обмены с BCS_DrillerMonitorLoader: один словарь на оба канала ─────────────
//
// Loader настраивает табло по TCP/IP (POST /api/rpc) и по RS-485 (кадр
// {"req":…}, ответ кадром {"res":…}). Чтобы «успешно или нет» звучало на обоих
// каналах одинаково, разбор и выполнение живут здесь, а каналы занимаются
// только доставкой.
//
//   запрос  { id: 17, op: "profile.save", data: {…} }
//   ответ   { id: 17, ok: true,  data: {…} }
//           { id: 17, ok: false, error: "Профиля «СПО» на табло нет" }
//
// Сюда не попадают две вещи. Поток данных — он односторонний, ответов не имеет
// и идёт своим путём (server/ingest.js). Обновление программы — пакет двоичный,
// в кадр не укладывается и везётся отдельно (server/updatePackage.js).
//
// Повторный запрос с тем же id не выполняется второй раз: ответ хранится
// RESPONSE_TTL и отдаётся повторно. Теряется ведь не только запрос, но и ответ
// на него, а повторить удаление профиля из-за потерянного «готово» — это
// удалить второй профиль.

const db          = require('./db');
const ingest      = require('./ingest');
const ingestAdmin = require('./ingestAdmin');
const netConfig   = require('./netConfig');
const logger      = require('./logger');
const pkg         = require('../package.json');

const RESPONSE_TTL      = 120000;
const KEEP_RESPONSES    = 16;
const LOG_LIMIT_DEFAULT = 200;
const LOG_LIMIT_MAX     = 2000;

function _log(msg) { try { logger.log(msg); } catch (_) {} }

// ── Представление профиля и индикаторов ───────────────────────────────────────
//
// Отдаём ровно то, что принимает profile.save: Loader прочитал, поправил,
// вернул — и ничего по дороге не потерялось. Часового пояса и таймаута боковой
// панели здесь нет: пояс общий для всех профилей и переезжает в настройки
// табло, панель убирается совсем. Пока они живут в строке профиля, их бережёт
// ingestConfig — профиль, сохранённый без них, их не затирает.

function _profileOut(p) {
    return {
        name:         p.name,
        background:   p.background,
        cellSize:     p.cell_size,
        wsWidth:      p.ws_width,
        wsHeight:     p.ws_height,
        alarmSoundId: p.alarm_sound_id,
        alarmVolume:  p.alarm_volume,
        alarmDelay:   p.alarm_delay,
    };
}

/// Столбцы индикатора из контракта конфигурации (server/ingest.js:_normIndicator).
const INDICATOR_COLUMNS = [
    'param_id', 'type', 'pos_left', 'pos_top', 'height', 'width',
    'header_text', 'header_color', 'header_bg', 'header_font', 'header_size',
    'format', 'value_color', 'value_bg', 'value_font', 'value_size',
    'range_min', 'range_max',
    'alarm_enabled', 'alarm_min', 'alarm_max', 'alarm_color',
    'units', 'zone_colors', 'ticker_speed', 'value_bg_opacity', 'extra_data',
];

function _indicatorOut(row) {
    const out = {};
    INDICATOR_COLUMNS.forEach(function (c) { out[c] = row[c] === undefined ? null : row[c]; });
    return out;
}

/**
 * Состояние табло: активный профиль с раскладкой, список остальных профилей и
 * версия программы. Этим одним ответом Loader и подключается: пришёл — связь
 * есть и редактор знает всё, что ему нужно.
 *
 * Справочники шрифтов и звуков (только имена — сами файлы уже на табло) едут
 * с подключением, но не со сменой профиля: они общие для всех профилей, а на
 * линии 57600 бод список из 87 шрифтов — это почти секунда эфира впустую.
 */
function boardState(withRefs) {
    const p = db.getActiveProfile();
    if (!p) return null;

    const state = {
        version:    pkg.version,
        profile:    _profileOut(p),
        indicators: db.getIndicatorsByProfile(p.id).map(_indicatorOut),
        profiles:   db.getProfiles().map(function (x) {
            return { name: x.name, active: !!x.is_active, isDefault: !!x.is_default };
        }),
    };
    if (withRefs) {
        state.fonts  = db.getFonts().map(function (f) { return { id: f.id, name: f.name }; });
        state.sounds = db.getAlarmSounds().map(function (s) { return { id: s.id, name: s.name }; });
    }
    return state;
}

function _byName(name) {
    const n = String(name == null ? '' : name).trim();
    if (!n) return null;
    return db.getProfiles().find(function (x) { return x.name === n; }) || null;
}

// ── Обработчики ───────────────────────────────────────────────────────────────
//
// Каждый возвращает данные ответа либо бросает Error с текстом для оператора.

function opProfileGet() {
    const state = boardState(true);
    if (!state) throw new Error('На табло нет активного профиля');
    return state;
}

function opProfileSelect(data) {
    const err = ingest.selectProfile((data && data.name) || '');
    if (err) throw new Error(err);
    return boardState();
}

function opProfileCreate(data) {
    const name = String((data && data.name) || '').trim();
    if (!name)        throw new Error('Профиль без имени');
    if (_byName(name)) throw new Error('Профиль «' + name + '» на табло уже есть');

    // За образец берём либо названный профиль, либо текущий: новый профиль с
    // чужим разрешением экрана и чужим часовым поясом показал бы кашу.
    const src = (data && data.copyFrom) ? _byName(data.copyFrom) : db.getActiveProfile();
    if (data && data.copyFrom && !src)
        throw new Error('Профиля «' + data.copyFrom + '», с которого копировать, на табло нет');

    const base = src || { background: '#000000', cell_size: 20, alarm_sound_id: null,
                          alarm_volume: 50, alarm_delay: 2, ws_width: 0, ws_height: 0,
                          sidebar_timeout: 20, timezone: '0' };

    const id = db.createProfile(name, base.background, base.cell_size).lastInsertRowid;
    // updateProfile заодно делает профиль активным
    db.updateProfile(id, base.background, base.cell_size, base.alarm_sound_id,
                     base.alarm_volume, base.alarm_delay, base.ws_width, base.ws_height,
                     base.sidebar_timeout, base.timezone);

    // Копируем раскладку только если об этом просили: «создать новый» обычно
    // значит пустое поле, а не копию текущего
    const copied = (data && data.copyFrom && src)
        ? db.getIndicatorsByProfile(src.id).map(_indicatorOut) : [];
    db.saveIndicators(id, copied);

    _log('Создан профиль "' + name + '"' +
         (copied.length ? ' копией "' + src.name + '" (' + copied.length + ' индикаторов)' : '') +
         ' из BCS_DrillerMonitorLoader');
    return boardState();
}

function opProfileDelete(data) {
    const p = _byName(data && data.name);
    if (!p) throw new Error('Профиля «' + ((data && data.name) || '') + '» на табло нет');
    if (p.is_default) throw new Error('Стандартный профиль удалить нельзя: табло нужно хоть одно рабочее поле');

    const res = db.deleteProfile(p.id);
    if (!res || !res.changes) throw new Error('Профиль «' + p.name + '» удалить не удалось');

    _log('Удалён профиль "' + p.name + '" из BCS_DrillerMonitorLoader');
    // deleteProfile сам включает стандартный, если удалили активный — отдаём
    // то рабочее поле, которое теперь на экране
    return boardState();
}

function opProfileSave(data) {
    const cfg = data || {};
    const err = ingest.ingestConfig({ profile: cfg.profile, indicators: cfg.indicators });
    if (err) throw new Error(err);
    return {
        saved:      cfg.profile && cfg.profile.name,
        indicators: Array.isArray(cfg.indicators) ? cfg.indicators.length : 0,
    };
}

// ── настройки табло ───────────────────────────────────────────────────────────
//
// Общее для всех профилей: сеть и приём по RS-485. Всё, что оператор видит и
// слышит на табло — фон, раскладка, тревога — это профиль, и живёт оно там.

function opSettingsGet() {
    const serialSource = require('./serialSource');

    let network = null, networkError = null;
    try { network = netConfig.read(); }
    catch (e) { networkError = 'Сетевые настройки не прочитаны: ' + (e.message || e); }

    const s = serialSource.status();
    return {
        version: pkg.version,
        time:    Date.now(),
        network: network,
        networkError: networkError,
        serial: {
            enabled: s.enabled, port: s.port, baud: s.baud,
            ports:   s.ports,   bauds: s.bauds,
            open:    s.open,    error: s.error,
        },
    };
}

function opSettingsSave(data) {
    const d = data || {};
    if (!d.serial && !d.network) throw new Error('В настройках нечего менять');

    const applied = [];

    // Порядок не случаен: сначала линия, сеть последней. Смена сети
    // перезагружает табло, и всё, что отправлено после неё, уехало бы в никуда.
    if (d.serial) {
        const err = ingestAdmin.ingestSerial(d.serial);
        if (err) throw new Error(err);
        applied.push('RS-485');
    }

    let reboot = false;
    if (d.network) {
        const err = ingestAdmin.ingestNetwork(d.network);
        if (err) throw new Error(err);
        applied.push('сеть');
        // ingestNetwork перезагружает табло, только если что-то изменилось
        try { reboot = netConfig.describe(netConfig.validate(d.network)) !== netConfig.describe(netConfig.read()); }
        catch (_) { reboot = true; }
    }

    return { applied: applied, reboot: reboot };
}

// ── Журнал ────────────────────────────────────────────────────────────────────

function opLogGet(data) {
    let limit = parseInt((data && data.limit), 10);
    if (isNaN(limit) || limit <= 0) limit = LOG_LIMIT_DEFAULT;
    if (limit > LOG_LIMIT_MAX)      limit = LOG_LIMIT_MAX;

    const all = db.getLogs();            // новые сверху
    return {
        total:   all.length,
        entries: all.slice(0, limit).map(function (r) {
            return { time: r.timestamp, message: r.message };
        }),
    };
}

function opLogClear() {
    db.clearLogs();
    // Первая же запись в пустом журнале — о том, кто его очистил
    _log('Журнал очищен из BCS_DrillerMonitorLoader');
    return { ok: true };
}

// ── Словарь ───────────────────────────────────────────────────────────────────
//
// auth: обмен меняет устройство необратимо или показывает его настройки — по
// TCP/IP на него нужен вход в систему, как и на такой же маршрут веб-интерфейса.
// По RS-485 входа нет и быть не может: кто добрался до линии, тот стоит у табло.

const OPS = {
    'profile.get':    { fn: opProfileGet,    auth: false },
    'profile.select': { fn: opProfileSelect, auth: false },
    'profile.create': { fn: opProfileCreate, auth: false },
    'profile.save':   { fn: opProfileSave,   auth: false },
    'profile.delete': { fn: opProfileDelete, auth: true  },
    'settings.get':   { fn: opSettingsGet,   auth: true  },
    'settings.save':  { fn: opSettingsSave,  auth: true  },
    'log.get':        { fn: opLogGet,        auth: false },
    'log.clear':      { fn: opLogClear,      auth: true  },
};

function ops() { return Object.keys(OPS); }

// ── Хранилище ответов ─────────────────────────────────────────────────────────

let _recent = [];

function _now() { return Date.now(); }

function _find(id, op, json) {
    const t = _now();
    for (let i = 0; i < _recent.length; i++) {
        const r = _recent[i];
        if (r.id === id && r.op === op && r.json === json && (t - r.at) < RESPONSE_TTL) return r;
    }
    return null;
}

function _remember(id, op, json, res) {
    _recent.push({ id: id, op: op, json: json, res: res, at: _now() });
    if (_recent.length > KEEP_RESPONSES) _recent = _recent.slice(-KEEP_RESPONSES);
}

/// Забыть сохранённые ответы (проверки).
function reset() { _recent = []; }

// ── Точка входа ───────────────────────────────────────────────────────────────

/**
 * Выполнить обмен. req: { id, op, data }, ctx: { channel, authed }.
 * Возвращает ответ целиком — { id, ok, data } либо { id, ok: false, error }.
 * Не бросает: канал должен уметь ответить на что угодно, даже на мусор.
 */
function handle(req, ctx) {
    const r  = req || {};
    const id = Number.isInteger(r.id) ? r.id : null;
    const op = typeof r.op === 'string' ? r.op : '';

    if (id === null) return { id: null, ok: false, error: 'В запросе нет номера' };

    const entry = OPS[op];
    if (!entry) return { id: id, ok: false, error: 'Неизвестный обмен: ' + (op || '(пусто)') };

    const c = ctx || {};
    // code: отказ из-за входа Loader узнаёт по признаку, а не по тексту — он
    // входит в систему и повторяет обмен сам
    if (entry.auth && c.channel !== 'rs485' && !c.authed)
        return { id: id, ok: false, code: 'auth', error: 'Требуется вход в систему табло' };

    // Повтор (потерялся ответ, а не запрос) — отдаём тот же ответ, не выполняя
    let json;
    try { json = JSON.stringify(r.data === undefined ? null : r.data); }
    catch (_) { json = null; }
    if (json !== null) {
        const was = _find(id, op, json);
        if (was) return Object.assign({}, was.res, { repeat: true });
    }

    let res;
    try {
        res = { id: id, ok: true, data: entry.fn(r.data) };
    } catch (e) {
        res = { id: id, ok: false, error: (e && e.message) ? e.message : String(e) };
    }

    // Запоминаем и неудачу: повторять нечего, ошибка повторится той же
    if (json !== null) _remember(id, op, json, res);
    return res;
}

module.exports = { handle, ops, boardState, reset, RESPONSE_TTL };

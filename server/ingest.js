'use strict';

// ── Приём записей данных от BCS_DrillerMonitorLoader ─────────────────────────
// Единая точка для обоих транспортов: HTTP push (/api/push/*) и RS-485
// (server/serialSource.js). Здесь — проверка пакета, подмена глубины, запуск
// push-режима, рассылка по SSE и синхронизация часов.

const dataSource = require('./dataSource');
const sse        = require('./sse');
const db         = require('./db');
const timeSync   = require('./timeSync');
const logger     = require('./logger');

// Параметры, значение которых подменяется достоверной глубиной из заголовка
// записи (LST). Список строится при старте по именам из справочника.
const _DEPTH_NAMES = ['глубина забоя', 'глубина долота'];
let _depthParamIds = [];
(function () {
    try {
        db.getParameters().forEach(function (p) {
            if (p.name && _DEPTH_NAMES.indexOf(p.name.toLowerCase()) !== -1)
                _depthParamIds.push(p.id);
        });
    } catch (_) {}
})();

function startPush() {
    dataSource.startPushMode(
        function (record) {
            sse.broadcast('drill-data', {
                recNo:  record.recNo,
                depth:  record.depth,
                time:   record.time,
                params: Object.fromEntries(record.params),
            });
        },
        {
            onStale:  (reason) => sse.broadcast('run-state', { running: false, reason: reason || null }),
            onResume: ()       => sse.broadcast('run-state', { running: true }),
        }
    );
    sse.broadcast('run-state', { running: true });
}

// body: { recNo, depth, time, params: { "<id>": value } }
// Возвращает null при успехе или текст ошибки.
function ingestRecord(body) {
    if (!body || typeof body.params !== 'object' || body.params === null)
        return 'Неверный формат пакета';

    if (!dataSource.isPushMode()) startPush();

    const params = new Map(
        Object.entries(body.params)
            .map(([k, v]) => [parseInt(k, 10), v])
            .filter(([k]) => Number.isInteger(k))
    );
    const lstDepth = Number(body.depth);
    if (!isNaN(lstDepth) && lstDepth > 0)
        _depthParamIds.forEach(function (id) { params.set(id, lstDepth); });

    const recTime = Number(body.time) || 0;
    dataSource.receivePushRecord({
        recNo:  Number(body.recNo) || 0,
        depth:  Number(body.depth) || 0,
        time:   recTime,
        params,
    });
    // BCS_Loader — единственный источник времени в изолированной сети
    if (recTime > 0) timeSync.consider(recTime);
    return null;
}

// ── Применение конфигурации монитора (профиль + индикаторы) ───────────────────
// Источник: HTTP POST /api/push/config и RS-485 (кадр {"config":…} целиком или
// сборка из частей {"cfgSeq":…}, см. server/configReassembler.js). Loader строит
// конфигурацию в редакторе-канве и шлёт её сюда. Профиль ищется/создаётся по
// имени, обновляется и активируется; индикаторы переписываются целиком
// (идемпотентно). Живой киоск и подключённый Loader перечитывают раскладку по
// SSE без перезагрузки — те же события, что при сохранении из веб-интерфейса.

function _num(v, def) { const n = Number(v);       return isNaN(n) ? def : n; }
function _int(v, def) { const n = parseInt(v, 10); return isNaN(n) ? def : n; }
function _str(v, def) { return (v === undefined || v === null) ? def : String(v); }
function _nnum(v) { if (v === undefined || v === null || v === '') return null; const n = Number(v);       return isNaN(n) ? null : n; }
function _nint(v) { if (v === undefined || v === null || v === '') return null; const n = parseInt(v, 10); return isNaN(n) ? null : n; }
function _bit(v)  { return (v === true || v === 1 || v === '1') ? 1 : 0; }

// Нормализация индикатора к набору столбцов saveIndicators. better-sqlite3
// требует все именованные параметры и не биндит boolean/undefined — приводим
// типы и подставляем значения по умолчанию из schema.js.
function _normIndicator(it) {
    it = it || {};
    return {
        param_id:         _nint(it.param_id),
        type:             _str(it.type, 'digitalIndicator'),
        // Позиция и размер — ПРОЦЕНТЫ рабочего поля и дробные (items.js:966-969),
        // округлять до целых нельзя: шаг 1 % — это ~19 px при ширине 1920.
        pos_left:         _num(it.pos_left, 0),
        pos_top:          _num(it.pos_top, 0),
        height:           _nnum(it.height),
        width:            _nnum(it.width),
        header_text:      _str(it.header_text, ''),
        header_color:     _str(it.header_color, '#c9d1d9'),
        header_bg:        _str(it.header_bg, '#161b22'),
        header_font:      _int(it.header_font, 0),
        header_size:      _int(it.header_size, 14),
        format:           _str(it.format, ''),
        value_color:      _str(it.value_color, '#38bdf8'),
        value_bg:         _str(it.value_bg, '#0d1117'),
        value_font:       _int(it.value_font, 0),
        value_size:       _int(it.value_size, 48),
        range_min:        _nnum(it.range_min),
        range_max:        _nnum(it.range_max),
        alarm_enabled:    _bit(it.alarm_enabled),
        alarm_min:        _nnum(it.alarm_min),
        alarm_max:        _nnum(it.alarm_max),
        alarm_color:      _str(it.alarm_color, '#ff0000'),
        units:            _str(it.units, ''),
        zone_colors:      _bit(it.zone_colors),
        ticker_speed:     _num(it.ticker_speed, 12),
        value_bg_opacity: _num(it.value_bg_opacity, 0),
        extra_data:       (it.extra_data === undefined || it.extra_data === null) ? null : String(it.extra_data),
    };
}

// cfg: { profile: {...}, indicators: [...] }
// Возвращает null при успехе или текст ошибки.
function ingestConfig(cfg) {
    if (!cfg || typeof cfg !== 'object')  return 'Неверный формат конфигурации';
    const p = cfg.profile;
    if (!p || typeof p !== 'object')      return 'Нет профиля в конфигурации';
    if (!Array.isArray(cfg.indicators))   return 'Нет списка индикаторов';

    const name = _str(p.name, '').trim();
    if (!name) return 'Профиль без имени';

    const background     = _str(p.background, '#000000');
    const cellSize       = _int(p.cellSize       !== undefined ? p.cellSize       : p.cell_size,       20);
    const alarmSoundId   = _nint(p.alarmSoundId  !== undefined ? p.alarmSoundId   : p.alarm_sound_id);
    const alarmVolume    = _int(p.alarmVolume    !== undefined ? p.alarmVolume    : p.alarm_volume,    50);
    const alarmDelay     = _num(p.alarmDelay     !== undefined ? p.alarmDelay     : p.alarm_delay,      2);
    const wsWidth        = _int(p.wsWidth        !== undefined ? p.wsWidth        : p.ws_width,         0);
    const wsHeight       = _int(p.wsHeight       !== undefined ? p.wsHeight       : p.ws_height,        0);
    const sidebarTimeout = _int(p.sidebarTimeout !== undefined ? p.sidebarTimeout : p.sidebar_timeout, 20);
    const timezone       = _str(p.timezone, '0');

    // upsert профиля по имени
    const existing = db.getProfiles().find(function (x) { return x.name === name; });
    const id = existing ? existing.id : db.createProfile(name, background, cellSize).lastInsertRowid;

    // updateProfile обновляет поля и делает профиль активным (is_active=1)
    db.updateProfile(id, background, cellSize, alarmSoundId, alarmVolume, alarmDelay,
                     wsWidth, wsHeight, sidebarTimeout, timezone);

    const list = cfg.indicators.map(_normIndicator);
    db.saveIndicators(id, list);

    const saved = db.getProfile(id);
    sse.broadcast('profile-selected', saved);
    sse.broadcast('workspace-saved',  saved);

    try { logger.log('Конфигурация профиля "' + name + '" применена (' + list.length + ' индикаторов)'); } catch (_) {}
    return null;
}

// body: { running: bool, reason?: string }
function ingestState(body) {
    const b       = body || {};
    const running = !!b.running;
    if (running) {
        if (!dataSource.isPushMode()) startPush();
    } else {
        dataSource.stopPushMode();
        sse.broadcast('run-state', { running: false, reason: b.reason || null });
    }
}

module.exports = { ingestRecord, ingestState, ingestConfig, startPush };

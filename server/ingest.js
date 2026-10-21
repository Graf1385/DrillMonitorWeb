'use strict';

// ── Приём записей данных от BCS_DrillerMonitorLoader ─────────────────────────
// Единая точка для обоих транспортов: HTTP push (/api/push/*) и RS-485
// (server/serialSource.js). Здесь — проверка пакета, подмена глубины, запуск
// push-режима, рассылка по SSE и синхронизация часов.

const dataSource = require('./dataSource');
const sse        = require('./sse');
const db         = require('./db');
const timeSync   = require('./timeSync');

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

module.exports = { ingestRecord, ingestState, startPush };

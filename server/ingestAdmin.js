'use strict';

// ── Настройка самого устройства из BCS_DrillerMonitorLoader ───────────────────
//
// Три раздела, которые на мониторе правятся через веб-интерфейс, а на буровой
// доступны только по линии RS-485: сетевые настройки, приём по RS-485 и
// справочники параметров/единиц. По TCP Loader пользуется обычным REST
// (со входом в систему), по RS-485 — кадрами {"net":…}, {"serial":…}, {"refs":…},
// которые приходят сюда из server/serialSource.js.
//
// Все функции возвращают null при успехе или текст ошибки — как ingestConfig.

const db        = require('./db');
const logger    = require('./logger');
const netConfig = require('./netConfig');

function _log(msg) { try { logger.log(msg); } catch (_) {} }

// ── Сетевые настройки ─────────────────────────────────────────────────────────

// Сеть уже меняли — устройство перезагружается, повторные кадры игнорируем.
let _netLatched = false;

function ingestNetwork(net) {
    if (!net || typeof net !== 'object') return 'Неверный формат сетевых настроек';
    if (_netLatched) return null;

    let wanted;
    try { wanted = netConfig.validate(net); }
    catch (e) { return e.message; }

    // Уже настроено так же — незачем перезагружать устройство
    try {
        const cur  = netConfig.read();
        const same = cur.mode === wanted.mode && (wanted.mode === 'dhcp' ||
            (cur.address === wanted.address &&
             String(cur.prefix) === String(wanted.prefix) &&
             cur.gateway === wanted.gateway));
        if (same) {
            _log('RS-485: сеть уже настроена как запрошено (' + netConfig.describe(wanted) + ')');
            return null;
        }
    } catch (_) { /* nmcli недоступен — применяем вслепую */ }

    try { netConfig.apply(wanted); }
    catch (e) { return 'Ошибка применения сетевых настроек: ' + (e.message || e); }

    _netLatched = true;
    _log('Сетевые настройки изменены по RS-485: ' + netConfig.describe(wanted) + ' — перезагрузка');
    netConfig.reboot();
    return null;
}

// ── Приём по RS-485 ───────────────────────────────────────────────────────────

function ingestSerial(ser) {
    if (!ser || typeof ser !== 'object') return 'Неверный формат настроек RS-485';

    // require по месту: serialSource требует этот модуль (циклическая зависимость)
    const serialSource = require('./serialSource');
    const cur = serialSource.getSettings();

    const enabled = ser.enabled === undefined ? cur.enabled
        : (ser.enabled === true || ser.enabled === 1 || ser.enabled === '1' || ser.enabled === 'true');
    const port = ser.port !== undefined && ser.port !== null && String(ser.port).length > 0
        ? String(ser.port) : cur.port;
    const baud = ser.baud !== undefined ? parseInt(ser.baud, 10) : cur.baud;

    if (serialSource.BAUD_RATES.indexOf(baud) === -1)
        return 'Недопустимая скорость ' + ser.baud;
    // Выключить приём командой, пришедшей по этой же линии, нельзя: включить
    // обратно будет нечем. Это делается только из веб-интерфейса монитора.
    if (!enabled)
        return 'Выключить приём по RS-485 можно только из веб-интерфейса монитора';

    if (cur.enabled === enabled && cur.port === port && cur.baud === baud) return null;

    serialSource.saveSettings({ enabled: enabled, port: port, baud: baud });
    _log('Настройки RS-485 изменены по RS-485: ' + port + ' @ ' + baud + ' бод');
    return null;
}

// ── Справочники параметров и единиц ───────────────────────────────────────────
//
// refs: {
//   units:            [{id?, name, symbol}],
//   parameters:       [{id, name, typeId?, unitId?, size?, accuracy?}],
//   deleteUnits:      [id],
//   deleteParameters: [id]
// }
// Любой раздел необязателен. Применение идемпотентно: единицы и параметры
// переписываются по id, повтор кадра ничего не портит.

function _ids(list) {
    const out = [];
    (list || []).forEach(function (v) {
        const n = parseInt(v, 10);
        if (!isNaN(n)) out.push(n);
    });
    return out;
}

function _validateUnits(list) {
    for (let i = 0; i < list.length; i++) {
        const u = list[i] || {};
        if (!String(u.name   || '').trim()) return 'Единица #' + (i + 1) + ': пустое название';
        if (!String(u.symbol || '').trim()) return 'Единица #' + (i + 1) + ': пустой символ';
    }
    return null;
}

function _validateParams(list) {
    for (let i = 0; i < list.length; i++) {
        const p = list[i] || {};
        if (parseInt(p.id, 10) !== parseInt(p.id, 10)) return 'Параметр #' + (i + 1) + ': нет id';
        if (!String(p.name || '').trim())              return 'Параметр id=' + p.id + ': пустое название';
    }
    return null;
}

function ingestRefs(refs) {
    if (!refs || typeof refs !== 'object') return 'Неверный формат справочников';

    const units     = Array.isArray(refs.units)      ? refs.units      : null;
    const params    = Array.isArray(refs.parameters) ? refs.parameters : null;
    const delUnits  = _ids(refs.deleteUnits);
    const delParams = _ids(refs.deleteParameters);

    if (!units && !params && !delUnits.length && !delParams.length)
        return 'Справочники пусты';

    if (units)  { const e = _validateUnits(units);   if (e) return e; }
    if (params) { const e = _validateParams(params); if (e) return e; }

    // Строка, помеченная на удаление, не должна приехать обратно в том же кадре:
    // Loader шлёт список целиком, и забытая в нём строка отменила бы удаление.
    const delUnitSet  = new Set(delUnits);
    const delParamSet = new Set(delParams);
    const unitsUp  = units  ? units.filter(function (u)  { return !delUnitSet.has(parseInt(u.id, 10)); })  : null;
    const paramsUp = params ? params.filter(function (p) { return !delParamSet.has(parseInt(p.id, 10)); }) : null;

    // Удаления идут первыми: освобождают символ единицы, который мог переехать
    // на другую строку при переименовании (units.symbol — UNIQUE).
    const parts = [];
    try {
        delParams.forEach(function (id) { db.deleteParameter(id); });
        delUnits.forEach(function (id)  { db.deleteUnit(id); });
        if (delParams.length) parts.push('удалено параметров: ' + delParams.length);
        if (delUnits.length)  parts.push('удалено единиц: '     + delUnits.length);

        if (unitsUp)  { db.upsertUnits(unitsUp);       parts.push('единиц: '     + unitsUp.length); }
        if (paramsUp) { db.importParameters(paramsUp); parts.push('параметров: ' + paramsUp.length); }
    } catch (e) {
        return 'Ошибка записи справочников: ' + (e.message || e);
    }

    // Список id параметров глубины строится по именам — после правки справочника
    // его надо перечитать, иначе подмена глубины уйдёт не в тот индикатор.
    try { require('./ingest').refreshDepthParams(); } catch (_) {}

    _log('Справочники обновлены (' + parts.join(', ') + ')');
    return null;
}

module.exports = { ingestNetwork, ingestSerial, ingestRefs };

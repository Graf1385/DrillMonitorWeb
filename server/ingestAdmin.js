'use strict';

// ── Настройка самого устройства из BCS_DrillerMonitorLoader ───────────────────
//
// Разделы, которые на мониторе правятся через веб-интерфейс, а на буровой
// доступны только по линии RS-485: сетевые настройки, приём по RS-485,
// справочники параметров/единиц и пароль учётной записи. По TCP Loader
// пользуется обычным REST (со входом в систему), по RS-485 — кадрами
// {"net":…}, {"serial":…}, {"auth":…}, которые приходят сюда из
// server/serialSource.js.
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
             String(cur.prefix) === String(wanted.prefix)));
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

// ── Учётная запись монитора ───────────────────────────────────────────────────
//
// Пароль admin создаётся случайным при первом запуске и больше нигде не виден,
// поэтому без этого раздела Loader не может войти по TCP ни одним способом.
// Задаётся он по той же линии RS-485: она физическая, и тот, кто до неё добрался,
// и так может переписать мониторy сеть, справочники и всё рабочее поле.

const MIN_PASSWORD = 4;

function ingestAuth(a) {
    if (!a || typeof a !== 'object') return 'Неверный формат учётной записи';

    const name     = String(a.user || 'admin').trim();
    const password = a.password == null ? '' : String(a.password);

    if (!name)                          return 'Пустое имя пользователя';
    if (password.length < MIN_PASSWORD) return 'Пароль короче ' + MIN_PASSWORD + ' символов';

    try {
        if (!db.getUser(name)) return 'На мониторе нет пользователя «' + name + '»';
        db.updateUserPassword(name, password);
    } catch (e) {
        return 'Ошибка смены пароля: ' + (e.message || e);
    }

    _log('Пароль пользователя "' + name + '" задан из BCS_DrillerMonitorLoader');
    return null;
}

module.exports = { ingestNetwork, ingestSerial, ingestAuth };

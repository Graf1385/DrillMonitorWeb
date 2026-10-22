'use strict';

// ── Сетевые настройки устройства (NetworkManager) ─────────────────────────────
// Общий код для обоих каналов настройки: HTTP (/api/network, требует входа) и
// RS-485 (кадр {"net":…}, см. server/serialSource.js). Применение всегда
// заканчивается перезагрузкой — другого способа гарантированно переподнять
// киоск с новым адресом нет.
//
// Шлюза и DNS у табло нет: в интернет оно не ходит, обновления приходят с
// BCS_DrillerMonitorLoader по RS-485 или TCP/IP. Задаётся только собственный
// адрес, маршрут по умолчанию и серверы имён скрипт гасит (set-network.sh).
// Ключи gateway/dns от старых версий Loader молча игнорируются.

const { execFileSync, exec } = require('child_process');

const CONNECTION = 'Wired connection 1';
const SCRIPT     = '/opt/drillmonitor/scripts/set-network.sh';

function _validIp(s) {
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(s)) return false;
    return s.split('.').every(function (o) { return Number(o) <= 255; });
}

/// Текущие настройки соединения; бросает, если nmcli недоступен.
function read() {
    const out = execFileSync('nmcli', [
        '-t', '-f', 'ipv4.method,ipv4.addresses',
        'con', 'show', CONNECTION
    ], { timeout: 5000 }).toString().trim();

    const data = {};
    out.split('\n').forEach(function (line) {
        const idx = line.indexOf(':');
        if (idx !== -1) data[line.slice(0, idx)] = line.slice(idx + 1);
    });
    const parts = (data['ipv4.addresses'] || '').split('/');
    return {
        mode:    data['ipv4.method'] === 'manual' ? 'static' : 'dhcp',
        address: parts[0] || '',
        prefix:  parts[1] || '24'
    };
}

/// Проверка и нормализация; бросает Error с текстом для оператора.
function validate(body) {
    const mode = String((body && body.mode) || '');
    if (mode === 'dhcp') return { mode: 'dhcp' };
    if (mode !== 'static') throw new Error('Неверный режим');

    const address = String(body.address || '');
    const prefix  = parseInt(body.prefix, 10);

    if (!_validIp(address))                         throw new Error('Неверный IP-адрес');
    if (isNaN(prefix) || prefix < 1 || prefix > 32) throw new Error('Неверная маска');

    return { mode: mode, address: address, prefix: prefix };
}

/// Применяет настройки (без перезагрузки); бросает Error. Возвращает применённое.
function apply(body) {
    const s = validate(body);
    if (s.mode === 'dhcp') {
        execFileSync('sudo', [SCRIPT, 'dhcp'], { timeout: 15000 });
    } else {
        execFileSync('sudo', [SCRIPT, 'static', s.address + '/' + s.prefix], { timeout: 15000 });
    }
    return s;
}

/// Перезагрузка устройства — единственный разрешённый в sudoers путь к reboot.
function reboot(delayMs) {
    setTimeout(function () { exec('sudo ' + SCRIPT + ' reboot'); }, delayMs || 800);
}

/// Описание для журнала: «статический 10.10.10.250/24» или «DHCP».
function describe(s) {
    return s.mode === 'dhcp' ? 'DHCP' : 'статический ' + s.address + '/' + s.prefix;
}

module.exports = { read, validate, apply, reboot, describe, CONNECTION };

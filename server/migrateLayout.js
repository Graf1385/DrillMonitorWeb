'use strict';

// ── Перевод табло старой установки на новые права ────────────────────────────
//
// Табло на буровой не переустановить: ни клавиатуры, ни SSH. Поэтому перевод
// (DEPLOY.txt, раздел 17) приезжает с обычным пакетом обновления: табло старой
// установки распаковывает его по-старому, перезагружается, и новая служба,
// увидев, что код всё ещё принадлежит ей (privileged.isLegacy), один раз просит
// прежний scripts/set-network.sh запустить scripts/migrate-layout.sh от root.
// Тот переводит табло и перезапускает службу; следующий запуск уже видит
// новую установку, и здесь ничего не происходит.
//
// Если sudo недоступен (в юните NoNewPrivileges, нет sudoers), перевод
// невозможен — об этом остаётся запись в журнале, табло работает по-старому.

const fs         = require('fs');
const path       = require('path');
const { execFile } = require('child_process');
const privileged = require('./privileged');

/// Не сразу после запуска: табло только что поднялось после обновления, пусть
/// сначала покажет данные; перевод перезапустит службу ещё раз.
const DELAY_MS = 30000;

let _started = false;
let _timer   = null;

function _log(msg) {
    try { require('./logger').log(msg); } catch (_) {}
    console.log('[migrate] ' + msg);
}

function _run() {
    const script  = path.join(privileged.LEGACY_DIR, 'set-network.sh');
    const migrate = path.join(privileged.LEGACY_DIR, 'migrate-layout.sh');
    if (!privileged.isLegacy() || !fs.existsSync(script) || !fs.existsSync(migrate)) return;

    execFile('sudo', ['-n', script, 'migrate'], { timeout: 20000 }, function (err, stdout, stderr) {
        if (err) {
            _log('Перевод табло на новые права не запущен: ' +
                 String(stderr || err.message || err).trim() +
                 ' — нужен запуск install.sh на месте (DEPLOY.txt, раздел 17)');
            return;
        }
        _log('Перевод табло на новые права запущен — служба будет перезапущена');
    });
}

function start() {
    if (_started) return;
    _started = true;
    if (!privileged.isLegacy()) return;
    _timer = setTimeout(_run, DELAY_MS);
    _timer.unref();
}

function stop() {
    if (_timer) { clearTimeout(_timer); _timer = null; }
}

module.exports = { start, stop };

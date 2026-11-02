'use strict';

// ── Действия от root ─────────────────────────────────────────────────────────
//
// Служба работает от drillmonitor и root получает только через эти скрипты
// (sudo NOPASSWD, /etc/sudoers.d/drillmonitor). Они лежат вне каталога
// программы и принадлежат root: служба не может их заменить, и пакет
// обновления их не трогает. Раньше они лежали в /opt/drillmonitor/scripts,
// который принадлежал службе, — то есть служба сама решала, что исполнит
// root. Ставит и обновляет их install.sh, а на табло старой установки —
// однократный перевод (server/migrateLayout.js).
//
// Каждый скрипт сам проверяет свои аргументы: вызвать его может любой код,
// работающий от имени службы.
//
// Пока табло не переведено, sudoers разрешает только прежние пути, и сеть,
// часы и перезагрузка идут по ним — иначе непереведённое табло на буровой
// осталось бы без них.

const fs   = require('fs');
const path = require('path');

const DIR        = '/usr/local/lib/drillmonitor';
const LEGACY_DIR = path.join(__dirname, '..', 'scripts');
const ROOT       = path.join(__dirname, '..');

/**
 * Табло ещё старой установки: код программы принадлежит самой службе. Только
 * в этом случае действуют прежние пути и прежняя распаковка обновлений — в
 * такой установке они ничего не ухудшают, а root-помощник обновлений в такое
 * дерево писать откажется. Признак — владелец кода, а не наличие помощников:
 * перевод (scripts/migrate-layout.sh) ставит помощников раньше, чем меняет
 * владельца, и оборвавшийся посередине перевод не должен оставить табло ни
 * без сети, ни без обновлений.
 */
function isLegacy() {
    if (process.platform !== 'linux') return false;
    try { return fs.statSync(ROOT).uid === process.getuid(); }
    catch (_) { return false; }
}

function _pick(name) {
    return path.join(isLegacy() ? LEGACY_DIR : DIR, name);
}

module.exports = {
    DIR,
    LEGACY_DIR,
    isLegacy,
    get NETWORK() { return _pick('set-network.sh'); },   // dhcp | static a.b.c.d/p | reboot
    get TIME()    { return _pick('set-time.sh'); },      // <epoch>
    UPDATE: path.join(DIR, 'apply-update.py'),           // <пакет.tgz>
};

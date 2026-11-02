#!/bin/bash
# DrillMonitorWeb: однократный перевод табло старой установки на новые права
# (DEPLOY.txt, раздел 17) — то же, что делает install.sh, но без доступа к
# табло: на буровой ни клавиатуры, ни SSH.
#
# Запускается от root вне песочницы службы: служба после обновления видит
# старую установку (server/migrateLayout.js) и вызывает по sudo прежний
# scripts/set-network.sh migrate, а тот отдаёт этот скрипт systemd-run —
# внутри службы /etc и /usr только для чтения (ProtectSystem=full), а
# переписать нужно sudoers и юниты.
#
# В старой установке служба и так владеет скриптами, которые запускает от
# root, поэтому этот путь ничего не ухудшает — а после перевода его уже нет:
# sudoers больше не разрешает прежние пути.
#
# Ничего не меняет, пока не проверено всё, без чего перевод не довести до
# конца. Итог — строка в журнале службы (через watchdog.log) и в journald.
set -uo pipefail

APP_DIR="/opt/drillmonitor"
APP_USER="drillmonitor"
SERVICE="drillmonitor"
HELPER_DIR="/usr/local/lib/${SERVICE}"
SUDOERS_FILE="/etc/sudoers.d/${SERVICE}"
UNIT="/etc/systemd/system/${SERVICE}.service"
WD_UNIT="/etc/systemd/system/${SERVICE}-watchdog.service"
LOG_FILE="${APP_DIR}/server/data/watchdog.log"
HELPERS=(set-network.sh set-time.sh healthcheck.sh apply-update.py)

say() {
    logger -t "${SERVICE}-migrate" "$1" 2>/dev/null || true
    # Служба при запуске переносит эти строки в свой журнал (server/selfCheck.js).
    # Пишем от её имени: каталог её, и root по подложенной ссылке не пойдёт.
    runuser -u "$APP_USER" -- /bin/sh -c 'printf "%s\n" "$2" >> "$1"' \
        sh "$LOG_FILE" "$(date '+%Y-%m-%d %H:%M:%S') $1" 2>/dev/null || true
}

fail() {
    say "перевод на новые права не выполнен: $1 — запустите на табло: cd ${APP_DIR} && sudo bash install.sh"
    exit 1
}

[[ $EUID -eq 0 ]] || fail "нужен root"

# Уже переведено — делать нечего (повторный вызов безвреден)
if [[ -x "${HELPER_DIR}/apply-update.py" ]] && [[ "$(stat -c %u "$APP_DIR")" == 0 ]]; then
    exit 0
fi

# ── Проверки: до них ничего не меняется ──────────────────────────────────────
command -v python3 >/dev/null 2>&1 || fail "нет python3 (нужен установщику обновлений)"
command -v visudo  >/dev/null 2>&1 || fail "нет visudo"
id "$APP_USER" >/dev/null 2>&1     || fail "нет пользователя ${APP_USER}"
[[ -f "$UNIT" ]]                    || fail "нет юнита ${UNIT}"
for f in "${HELPERS[@]}"; do
    [[ -f "${APP_DIR}/scripts/${f}" && ! -L "${APP_DIR}/scripts/${f}" ]] || fail "в пакете нет scripts/${f}"
done

STAGE=$(mktemp -d) || fail "не создан временный каталог"
trap 'rm -rf "$STAGE"' EXIT

# Помощники копируем сначала к себе: исходники пока принадлежат службе
for f in "${HELPERS[@]}"; do
    cp --no-dereference "${APP_DIR}/scripts/${f}" "${STAGE}/${f}" || fail "не скопирован ${f}"
done
python3 -I -m py_compile "${STAGE}/apply-update.py" 2>/dev/null || fail "apply-update.py не компилируется"
rm -rf "${STAGE}/__pycache__"

# Два sudoers: на время перевода разрешены и прежние, и новые пути, в конце —
# только новые. Служба выбирает пути по тому, кому принадлежит код
# (server/privileged.js), и при обрыве на любом шаге у табло остаются и сеть,
# и обновления: в худшем случае — прежнее состояние, а не табло без связи.
NEW_PATHS="${HELPER_DIR}/set-network.sh, ${HELPER_DIR}/set-time.sh, ${HELPER_DIR}/apply-update.py"
OLD_PATHS="${APP_DIR}/scripts/set-network.sh, ${APP_DIR}/scripts/set-time.sh"
echo "${APP_USER} ALL=(root) NOPASSWD: ${NEW_PATHS}, ${OLD_PATHS}" > "${STAGE}/sudoers.both"
echo "${APP_USER} ALL=(root) NOPASSWD: ${NEW_PATHS}"               > "${STAGE}/sudoers.final"
visudo -cf "${STAGE}/sudoers.both"  >/dev/null 2>&1 || fail "переходный sudoers не прошёл проверку"
visudo -cf "${STAGE}/sudoers.final" >/dev/null 2>&1 || fail "новый sudoers не прошёл проверку"

# ── Перевод ──────────────────────────────────────────────────────────────────
install -d -m 0755 -o root -g root "$HELPER_DIR" || fail "не создан ${HELPER_DIR}"
for f in "${HELPERS[@]}"; do
    install -m 0755 -o root -g root "${STAGE}/${f}" "${HELPER_DIR}/${f}" || fail "не установлен ${f}"
done
install -m 0440 -o root -g root "${STAGE}/sudoers.both" "$SUDOERS_FILE" || fail "не записан ${SUDOERS_FILE}"

chown -R root:root "$APP_DIR"                         || fail "не сменён владелец ${APP_DIR}"
chmod -R u=rwX,go=rX "$APP_DIR"
mkdir -p "${APP_DIR}/server/data"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}/server/data" || fail "не отдан службе server/data"
chmod 0750 "${APP_DIR}/server/data"

# Код теперь root — прежние пути из sudoers уходят
install -m 0440 -o root -g root "${STAGE}/sudoers.final" "$SUDOERS_FILE" \
    || fail "не записан итоговый ${SUDOERS_FILE} (остался переходный: прежние пути ещё открыты)"

# Оповещатель на Digispark: /dev/hidraw* отдать службе (то же, что в install.sh).
# Не критично для перевода — без правила звук просто идёт динамиком
cat > "/etc/udev/rules.d/99-${SERVICE}-annunciator.rules" <<EOF || say "правило udev для оповещателя не записано"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="16c0", ATTRS{idProduct}=="05df", ATTRS{product}=="Annunciator", GROUP="${APP_USER}", MODE="0660"
EOF
udevadm control --reload-rules 2>/dev/null || true
udevadm trigger --subsystem-match=hidraw 2>/dev/null || true

# Под NoNewPrivileges sudo не запускается; сторож — из каталога помощников
sed -i '/^NoNewPrivileges=yes$/d' "$UNIT"
[[ -f "$WD_UNIT" ]] && sed -i "s|^ExecStart=.*healthcheck\.sh$|ExecStart=${HELPER_DIR}/healthcheck.sh|" "$WD_UNIT"
systemctl daemon-reload

say "табло переведено на новые права: код — root, помощники в ${HELPER_DIR}, sudoers обновлён"
# Служба подхватит юнит без NoNewPrivileges только после перезапуска
systemctl restart "$SERVICE"
exit 0

#!/usr/bin/env bash
# Внешний сторож службы drillmonitor.
#
# Сама служба чинит то, что видит: порт RS-485, видеопоток, диск. Но процесс
# может быть жив и не отвечать — заклинивший цикл событий, зависший системный
# вызов, нехватка памяти. Изнутри такое не починить, а доступа к табло на
# буровой нет. Поэтому снаружи, раз в минуту, спрашиваем у сервера, жив ли он,
# и после трёх неудач подряд перезапускаем службу.
#
# Ставится install.sh как drillmonitor-watchdog.service + .timer (от root).
# Строку о перезапуске кладём в файл: служба подберёт её при следующем запуске
# и перенесёт в общий журнал (server/selfCheck.js) — иначе перезапуск остался
# бы виден только в journalctl.

set -uo pipefail

APP_DIR="${APP_DIR:-/opt/drillmonitor}"
APP_USER="${APP_USER:-drillmonitor}"
SERVICE="${SERVICE:-drillmonitor}"
UNIT_FILE="/etc/systemd/system/${SERVICE}.service"
STATE_DIR="/run/${SERVICE}-watchdog"
LOG_FILE="${APP_DIR}/server/data/watchdog.log"

FAILS_BEFORE_RESTART=3
# Чаще этого не перезапускаем: если дело не в зависании, перезапуск по кругу
# только мешает — пусть лучше останется запись в журнале
MIN_RESTART_INTERVAL=600

PORT=$(grep -oP '^Environment=PORT=\K[0-9]+' "$UNIT_FILE" 2>/dev/null || true)
PORT="${PORT:-80}"

mkdir -p "$STATE_DIR"
FAILS=$(cat "${STATE_DIR}/fails" 2>/dev/null || echo 0)
[[ "$FAILS" =~ ^[0-9]+$ ]] || FAILS=0

note() {
    local msg="$1"
    logger -t "${SERVICE}-watchdog" "$msg" 2>/dev/null || true
    # Служба не поднимается совсем — файл не должен расти без предела
    if [[ -f "$LOG_FILE" ]] && [[ $(stat -c %s "$LOG_FILE" 2>/dev/null || echo 0) -gt 65536 ]]; then
        tail -n 50 "$LOG_FILE" > "${LOG_FILE}.tmp" 2>/dev/null && mv "${LOG_FILE}.tmp" "$LOG_FILE"
    fi
    echo "$(date '+%Y-%m-%d %H:%M:%S') $msg" >> "$LOG_FILE" 2>/dev/null || true
    # Файл читает и очищает сама служба — она работает не под root
    chown "${APP_USER}:${APP_USER}" "$LOG_FILE" 2>/dev/null || true
}

if curl -sf --max-time 5 -o /dev/null "http://127.0.0.1:${PORT}/api/health"; then
    if [[ "$FAILS" -gt 0 ]]; then
        note "сервер снова отвечает (неудачных проверок подряд было ${FAILS})"
    fi
    echo 0 > "${STATE_DIR}/fails"
    exit 0
fi

FAILS=$((FAILS + 1))
echo "$FAILS" > "${STATE_DIR}/fails"

if [[ "$FAILS" -lt "$FAILS_BEFORE_RESTART" ]]; then
    logger -t "${SERVICE}-watchdog" "нет ответа на /api/health (${FAILS}/${FAILS_BEFORE_RESTART})"
    exit 0
fi

NOW=$(date +%s)
LAST=$(cat "${STATE_DIR}/restarted" 2>/dev/null || echo 0)
[[ "$LAST" =~ ^[0-9]+$ ]] || LAST=0
if [[ $((NOW - LAST)) -lt "$MIN_RESTART_INTERVAL" ]]; then
    logger -t "${SERVICE}-watchdog" "нет ответа, но перезапуск был $((NOW - LAST)) с назад — жду"
    exit 0
fi

note "сервер не отвечает на /api/health (${FAILS} проверки подряд) — перезапуск службы"
echo "$NOW" > "${STATE_DIR}/restarted"
echo 0 > "${STATE_DIR}/fails"
systemctl restart "$SERVICE"

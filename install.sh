#!/usr/bin/env bash
# DrillMonitorWeb — установочный скрипт для Ubuntu 20.04 / 22.04 / 24.04
# Запуск: sudo bash install.sh

set -euo pipefail

# ── Конфигурация ─────────────────────────────────────────────────────────────
APP_DIR="/opt/drillmonitor"
APP_USER="drillmonitor"
SERVICE_NAME="drillmonitor"
# Порт: явный $PORT > порт из существующего юнита (при обновлении) > 3000
if [[ -z "${PORT:-}" && -f "/etc/systemd/system/${SERVICE_NAME}.service" ]]; then
    PORT=$(grep -oP '^Environment=PORT=\K[0-9]+' "/etc/systemd/system/${SERVICE_NAME}.service" || true)
fi
PORT="${PORT:-3000}"
NODE_VERSION="20"
# ─────────────────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()      { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── Проверка прав ─────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
    error "Запустите скрипт от имени root: sudo bash install.sh"
fi

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║          DrillMonitorWeb — Установка сервиса                 ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── Определяем источник файлов приложения ────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── 1. Обновление системы ─────────────────────────────────────────────────────
info "Обновление списка пакетов..."
apt-get update -qq
ok "Список пакетов обновлён"

# ── 2. Базовые утилиты ────────────────────────────────────────────────────────
info "Установка базовых утилит..."
# python3 — для установщика обновлений (scripts/apply-update.py), rsync — для копирования
apt-get install -y -qq curl git ca-certificates gnupg lsb-release python3 rsync
ok "Базовые утилиты установлены"

# ── 3. Node.js ────────────────────────────────────────────────────────────────
if command -v node &>/dev/null; then
    CURRENT_NODE=$(node --version | sed 's/v//' | cut -d. -f1)
    if [[ "$CURRENT_NODE" -ge 18 ]]; then
        ok "Node.js $(node --version) уже установлен"
    else
        warn "Node.js $(node --version) слишком старый. Устанавливаем v${NODE_VERSION}..."
        curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
        apt-get install -y -qq nodejs
        ok "Node.js $(node --version) установлен"
    fi
else
    info "Установка Node.js v${NODE_VERSION}..."
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
    apt-get install -y -qq nodejs
    ok "Node.js $(node --version) установлен"
fi

# ── 4. FFmpeg ─────────────────────────────────────────────────────────────────
if command -v ffmpeg &>/dev/null; then
    ok "FFmpeg $(ffmpeg -version 2>&1 | head -1 | awk '{print $3}') уже установлен"
else
    info "Установка FFmpeg..."
    apt-get install -y -qq ffmpeg
    ok "FFmpeg установлен"
fi

# ── 5. Директория приложения ──────────────────────────────────────────────────
info "Подготовка директории приложения: ${APP_DIR}"

if [[ "$SCRIPT_DIR" == "$APP_DIR" ]]; then
    ok "Скрипт запущен из ${APP_DIR}, копирование не требуется"
else
    mkdir -p "$APP_DIR"
    info "Копирование файлов из ${SCRIPT_DIR} в ${APP_DIR}..."
    rsync -a --exclude='.git' --exclude='node_modules' \
          "${SCRIPT_DIR}/" "${APP_DIR}/"
    ok "Файлы скопированы"
fi

# ── 6. npm install ────────────────────────────────────────────────────────────
info "Установка зависимостей Node.js..."
cd "$APP_DIR"
npm install --omit=dev --silent
ok "Зависимости установлены"

# ── 7. Системный пользователь ─────────────────────────────────────────────────
if id "$APP_USER" &>/dev/null; then
    ok "Пользователь '${APP_USER}' уже существует"
else
    info "Создание системного пользователя '${APP_USER}'..."
    useradd --system --no-create-home --shell /usr/sbin/nologin "$APP_USER"
    ok "Пользователь '${APP_USER}' создан"
fi

# ── 8. Права доступа ──────────────────────────────────────────────────────────
# Код программы принадлежит root, служба его только читает. Пишет она лишь в
# server/data (база, настройки) и /tmp/drillmonitor_hls. Раньше весь каталог
# принадлежал службе, а в нём лежали скрипты, которые она же запускала от root
# через sudo: любой её сбой или пакет обновления давал root на устройстве.
# Повторный запуск install.sh переводит на эти права и прежние установки.
info "Настройка прав доступа..."
chown -R root:root "$APP_DIR"
chmod -R u=rwX,go=rX "$APP_DIR"
mkdir -p "$APP_DIR/server/data"
chown -R "${APP_USER}:${APP_USER}" "$APP_DIR/server/data"
chmod 0750 "$APP_DIR/server/data"
ok "Права настроены: код — root, server/data — ${APP_USER}"

# ── 8a. Root-помощники и sudoers ─────────────────────────────────────────────
# set-network.sh — смена IP/DHCP и reboot; set-time.sh — подстройка часов под
# время данных BCS_Loader (в сети буровой нет NTP); apply-update.py — установка
# пакета обновления; healthcheck.sh — внешний сторож (запускает systemd).
# Лежат вне каталога программы и принадлежат root: служба не может их
# заменить, пакет обновления их не трогает. Новые версии ставит только этот
# скрипт.
HELPER_DIR="/usr/local/lib/${SERVICE_NAME}"
info "Установка root-помощников в ${HELPER_DIR}..."
install -d -m 0755 -o root -g root "$HELPER_DIR"
for f in set-network.sh set-time.sh healthcheck.sh apply-update.py; do
    install -m 0755 -o root -g root "${APP_DIR}/scripts/${f}" "${HELPER_DIR}/${f}"
done
# Каталог программы и пользователь службы в установщике обновлений — те же, что здесь
sed -i -e "s|^ROOT *= .*|ROOT         = '${APP_DIR}'|" \
       -e "s|^APP_USER *= .*|APP_USER     = '${APP_USER}'|" "${HELPER_DIR}/apply-update.py"
ok "Помощники установлены"

info "Настройка sudoers для '${APP_USER}'..."
SUDOERS_FILE="/etc/sudoers.d/${SERVICE_NAME}"
SUDOERS_TMP=$(mktemp)
cat > "$SUDOERS_TMP" <<EOF
${APP_USER} ALL=(root) NOPASSWD: ${HELPER_DIR}/set-network.sh, ${HELPER_DIR}/set-time.sh, ${HELPER_DIR}/apply-update.py
EOF
if visudo -cf "$SUDOERS_TMP" >/dev/null 2>&1; then
    install -m 0440 -o root -g root "$SUDOERS_TMP" "$SUDOERS_FILE"
    rm -f "$SUDOERS_TMP"
    ok "sudoers установлен: ${SUDOERS_FILE}"
else
    rm -f "$SUDOERS_TMP"
    # Оставлять прежний файл нельзя: он разрешает root скриптам из каталога,
    # который раньше принадлежал службе
    rm -f "$SUDOERS_FILE"
    error "Некорректный файл sudoers — прежний удалён, установка прервана"
fi

# ── 8b. Оповещатель на Digispark ─────────────────────────────────────────────
# Плата — HID-устройство (firmware/annunciator), сервер читает её как файл
# /dev/hidraw*. По умолчанию это файл root — правило отдаёт его службе. Пара
# 16c0:05df общая для V-USB, поэтому сверяем и название устройства.
info "Правило udev для оповещателя..."
cat > /etc/udev/rules.d/99-${SERVICE_NAME}-annunciator.rules <<EOF
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="16c0", ATTRS{idProduct}=="05df", ATTRS{product}=="Annunciator", GROUP="${APP_USER}", MODE="0660"
EOF
udevadm control --reload-rules 2>/dev/null || true
udevadm trigger --subsystem-match=hidraw 2>/dev/null || true
ok "Правило udev установлено"

# ── 9. Временная директория для HLS ──────────────────────────────────────────
info "Подготовка временной директории HLS..."
mkdir -p /tmp/drillmonitor_hls
chown "${APP_USER}:${APP_USER}" /tmp/drillmonitor_hls
# /tmp очищается при перезагрузке — tmpfiles.d пересоздаёт каталог при загрузке
echo "d /tmp/drillmonitor_hls 0775 ${APP_USER} ${APP_USER} -" > /etc/tmpfiles.d/${SERVICE_NAME}.conf
ok "Временная директория /tmp/drillmonitor_hls создана (+ tmpfiles.d)"

# ── 10. systemd-сервис ────────────────────────────────────────────────────────
info "Создание systemd-сервиса '${SERVICE_NAME}'..."

NODE_BIN=$(command -v node)

# Порты ниже 1024 требуют CAP_NET_BIND_SERVICE для непривилегированного пользователя
CAP_LINE=""
if [[ "$PORT" -lt 1024 ]]; then
    CAP_LINE="AmbientCapabilities=CAP_NET_BIND_SERVICE"
fi

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=DrillMonitorWeb — система мониторинга бурения
Documentation=file://${APP_DIR}/DEPLOY.txt
After=network.target
Wants=network.target
# Счётчик неудачных запусков не должен однажды оставить табло выключенным
StartLimitIntervalSec=0

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
ExecStart=${NODE_BIN} app.js
# Доступа к табло на буровой нет: служба должна подниматься после любого
# завершения, и systemd не должен «сдаваться» после нескольких неудач подряд —
# лучше пробовать вечно, чем оставить бурильщика перед тёмным экраном.
Restart=always
RestartSec=5
# Обновление и смена сети штатно перезагружают устройство, и каждая лишняя
# секунда — это тёмный экран у бурильщика. Страховка на случай, если процесс
# снова зависнет на выходе (так было, пока чтение RS-485 держало поток пула
# libuv в блокирующем read() — см. server/serialSource.js).
KillMode=mixed
TimeoutStopSec=15
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

Environment=PORT=${PORT}
Environment=NODE_ENV=production

# Ограничения безопасности. NoNewPrivileges здесь быть не может: сеть, часы,
# перезагрузку и установку обновлений служба делает через sudo, а под этим
# флагом sudo не запускается. Root служба получает только через помощники в
# ${HELPER_DIR}: они принадлежат root и сами проверяют аргументы.
${CAP_LINE}
PrivateTmp=no
ProtectSystem=full
ReadWritePaths=${APP_DIR}/server/data -/tmp/drillmonitor_hls

[Install]
WantedBy=multi-user.target
EOF

ok "Файл сервиса создан: /etc/systemd/system/${SERVICE_NAME}.service"

# ── 10a. Внешний сторож службы ───────────────────────────────────────────────
# Сама служба чинит то, что видит (порт RS-485, видеопоток, диск). Случай
# «процесс жив, но не отвечает» изнутри не чинится — раз в минуту спрашиваем
# снаружи и после трёх неудач подряд перезапускаем. Подробности —
# scripts/healthcheck.sh (ставится в ${HELPER_DIR}) и server/selfCheck.js.
info "Установка сторожа службы..."

cat > "/etc/systemd/system/${SERVICE_NAME}-watchdog.service" <<EOF
[Unit]
Description=Проверка отклика ${SERVICE_NAME} и перезапуск при зависании

[Service]
Type=oneshot
Environment=APP_DIR=${APP_DIR}
Environment=APP_USER=${APP_USER}
Environment=SERVICE=${SERVICE_NAME}
ExecStart=${HELPER_DIR}/healthcheck.sh
EOF

cat > "/etc/systemd/system/${SERVICE_NAME}-watchdog.timer" <<EOF
[Unit]
Description=Ежеминутная проверка отклика ${SERVICE_NAME}

[Timer]
OnBootSec=3min
OnUnitActiveSec=1min
AccuracySec=10s

[Install]
WantedBy=timers.target
EOF

ok "Сторож установлен: ${SERVICE_NAME}-watchdog.timer"

# ── 10b. Журнал, переживающий перезагрузку ───────────────────────────────────
# К табло доступа почти нет: причину вчерашнего сбоя читать будет некому, если
# journald держит записи только в памяти и теряет их при перезагрузке.
info "Настройка системного журнала..."
mkdir -p /var/log/journal
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/${SERVICE_NAME}.conf <<EOF
[Journal]
Storage=persistent
SystemMaxUse=200M
SystemMaxFileSize=20M
EOF
systemctl restart systemd-journald 2>/dev/null || true
ok "Журнал сохраняется на диск (до 200 МБ)"

# ── 11. Запуск сервиса ────────────────────────────────────────────────────────
info "Перезагрузка systemd и запуск сервиса..."
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
systemctl enable --now "${SERVICE_NAME}-watchdog.timer" >/dev/null 2>&1 || \
    warn "Не удалось включить ${SERVICE_NAME}-watchdog.timer"

sleep 2

if systemctl is-active --quiet "$SERVICE_NAME"; then
    ok "Сервис '${SERVICE_NAME}' запущен и работает"
else
    warn "Сервис не запустился. Проверьте логи:"
    echo "    sudo journalctl -u ${SERVICE_NAME} -n 30"
    exit 1
fi

# ── 12. Настройка UFW (если установлен) ──────────────────────────────────────
if command -v ufw &>/dev/null; then
    UFW_STATUS=$(ufw status | head -1)
    if [[ "$UFW_STATUS" == *"active"* ]]; then
        info "UFW активен. Открываем порт ${PORT}/tcp..."
        ufw allow "${PORT}/tcp" > /dev/null
        ok "Порт ${PORT}/tcp открыт в UFW"
    else
        info "UFW установлен, но не активен. Пропускаем настройку брандмауэра."
    fi
else
    info "UFW не установлен. Настройте брандмауэр вручную (порт ${PORT}/tcp)."
fi

# ── Итог ──────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                   Установка завершена!                       ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo -e "  Приложение : ${GREEN}http://$(hostname -I | awk '{print $1}'):${PORT}${NC}"
echo -e "  Директория : ${CYAN}${APP_DIR}${NC}"
echo -e "  Статус     : sudo systemctl status ${SERVICE_NAME}"
echo -e "  Логи       : sudo journalctl -u ${SERVICE_NAME} -f"
echo ""
echo -e "${YELLOW}  Для видео с регистратора убедитесь, что ffmpeg доступен:${NC}"
echo -e "    ffmpeg -version"
echo ""

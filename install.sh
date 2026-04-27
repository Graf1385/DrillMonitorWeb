#!/usr/bin/env bash
# DrillMonitorWeb — установочный скрипт для Ubuntu 20.04 / 22.04 / 24.04
# Запуск: sudo bash install.sh

set -euo pipefail

# ── Конфигурация ─────────────────────────────────────────────────────────────
APP_DIR="/opt/drillmonitor"
APP_USER="drillmonitor"
SERVICE_NAME="drillmonitor"
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
apt-get install -y -qq curl git ca-certificates gnupg lsb-release
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
info "Настройка прав доступа..."
chown -R "${APP_USER}:${APP_USER}" "$APP_DIR"
chmod -R 755 "$APP_DIR"
# База данных и данные должны быть доступны для записи
chmod -R 775 "$APP_DIR/server/data" 2>/dev/null || true
ok "Права настроены"

# ── 9. Временная директория для HLS ──────────────────────────────────────────
info "Подготовка временной директории HLS..."
mkdir -p /tmp/drillmonitor_hls
chown "${APP_USER}:${APP_USER}" /tmp/drillmonitor_hls
ok "Временная директория /tmp/drillmonitor_hls создана"

# ── 10. systemd-сервис ────────────────────────────────────────────────────────
info "Создание systemd-сервиса '${SERVICE_NAME}'..."

NODE_BIN=$(command -v node)

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=DrillMonitorWeb — система мониторинга бурения
Documentation=file://${APP_DIR}/DEPLOY.txt
After=network.target
Wants=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}
ExecStart=${NODE_BIN} app.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}

Environment=PORT=${PORT}
Environment=NODE_ENV=production

# Ограничения безопасности
NoNewPrivileges=yes
PrivateTmp=no
ProtectSystem=full
ReadWritePaths=${APP_DIR}/server/data /tmp/drillmonitor_hls

[Install]
WantedBy=multi-user.target
EOF

ok "Файл сервиса создан: /etc/systemd/system/${SERVICE_NAME}.service"

# ── 11. Запуск сервиса ────────────────────────────────────────────────────────
info "Перезагрузка systemd и запуск сервиса..."
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

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

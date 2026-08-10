#!/usr/bin/env bash
# DrillMonitorWeb: перевод на порт 80 + киоск-режим (Xorg + Openbox + Chromium)
set -euo pipefail

KIOSK_USER="bcs"
KIOSK_HOME="/home/${KIOSK_USER}"
APP_URL="http://localhost/"
UNIT="/etc/systemd/system/drillmonitor.service"

echo "=== 1. Порт 80 для drillmonitor ==="
sed -i 's/^Environment=PORT=.*/Environment=PORT=80/' "$UNIT"
if ! grep -q '^AmbientCapabilities=' "$UNIT"; then
    sed -i '/^NoNewPrivileges=yes/a AmbientCapabilities=CAP_NET_BIND_SERVICE' "$UNIT"
fi
systemctl daemon-reload
systemctl restart drillmonitor
sleep 2
systemctl is-active drillmonitor || { journalctl -u drillmonitor -n 20 --no-pager; exit 1; }
curl -sf -o /dev/null http://localhost:80/ && echo "PORT80_OK"

ufw allow 80/tcp >/dev/null
ufw delete allow 3000/tcp >/dev/null 2>&1 || true
echo "UFW_OK"

echo "=== 2. Пакеты для киоска ==="
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq xorg xinit openbox x11-xserver-utils
command -v snap >/dev/null || apt-get install -y -qq snapd
snap list chromium >/dev/null 2>&1 || snap install chromium
echo "PKGS_OK"

# Политика Chromium: отключаем всплывающее меню перевода страницы
# (флага --disable-features=Translate недостаточно в новых версиях)
mkdir -p /etc/chromium/policies/managed /etc/chromium-browser/policies/managed
printf '%s\n' '{ "TranslateEnabled": false }' \
    | tee /etc/chromium/policies/managed/kiosk.json \
    > /etc/chromium-browser/policies/managed/kiosk.json
echo "POLICY_OK"

echo "=== 3. Автологин на tty1 ==="
mkdir -p /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf <<EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin ${KIOSK_USER} --noclear %I \$TERM
EOF

echo "=== 4. Автостарт X и Chromium ==="
cat > "${KIOSK_HOME}/.bash_profile" <<'EOF'
# Киоск: на tty1 сразу стартуем X
if [ -z "${DISPLAY:-}" ] && [ "$(tty)" = "/dev/tty1" ]; then
    exec startx -- -nocursor >/dev/null 2>&1
fi
EOF

cat > "${KIOSK_HOME}/.xinitrc" <<'EOF'
#!/bin/sh
xset s off
xset -dpms
xset s noblank
openbox &
# Chromium перезапускается сам, если упал или был закрыт
while true; do
    chromium --kiosk --noerrdialogs --disable-infobars \
        --disable-session-crashed-bubble \
        --disable-features=Translate,TranslateUI \
        --no-first-run --no-default-browser-check --lang=ru \
        --overscroll-history-navigation=0 \
        --autoplay-policy=no-user-gesture-required \
        --check-for-update-interval=31536000 \
        http://localhost/
    sleep 2
done
EOF

chown "${KIOSK_USER}:${KIOSK_USER}" "${KIOSK_HOME}/.bash_profile" "${KIOSK_HOME}/.xinitrc"
chmod +x "${KIOSK_HOME}/.xinitrc"

systemctl daemon-reload
systemctl set-default graphical.target >/dev/null
echo "KIOSK_CONF_OK"

echo "=== 5. Запуск киоска (перезапуск tty1) ==="
systemctl restart getty@tty1
sleep 15
if pgrep -u "${KIOSK_USER}" -f 'chromium.*--kiosk' >/dev/null; then
    echo "KIOSK_RUNNING"
else
    echo "KIOSK_NOT_STARTED_YET (проверьте после перезагрузки)"
fi

echo "=== ГОТОВО ==="

#!/usr/bin/env bash
# DrillMonitorWeb: преобразователь интерфейсов WCH CH343 (USB Single Serial)
# на мониторе бурильщика. Запуск: sudo bash scripts/setup-serial.sh
#
# Ядро Ubuntu 24.04 (6.8) подхватывает CH343 штатным драйвером cdc_acm и
# создаёт /dev/ttyACM<N>; отдельный драйвер WCH нужен только для нестандартных
# скоростей/аппаратного управления потоком. Скрипт делает порт удобным:
#   • стабильное имя /dev/ttyCH343 (udev, по VID:PID 1a86:55d3);
#   • доступ к порту для пользователей сервиса и киоска (группа dialout).
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Запустите от root: sudo bash $0" >&2; exit 1; }

RULE=/etc/udev/rules.d/99-bcs-ch343.rules
USERS="${SERIAL_USERS:-drillmonitor bcs}"

cat > "$RULE" <<'EOF'
# BCS: преобразователь интерфейсов WCH CH343 (USB Single Serial) -> стабильное имя
SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="55d3", SYMLINK+="ttyCH343", GROUP="dialout", MODE="0660"
EOF
chmod 0644 "$RULE"
udevadm control --reload-rules
udevadm trigger --subsystem-match=tty
echo "udev: $RULE"

for u in $USERS; do
    if id "$u" &>/dev/null; then
        usermod -aG dialout "$u"
        echo "dialout: $u"
    fi
done

sleep 1
if [[ -e /dev/ttyCH343 ]]; then
    echo "порт: /dev/ttyCH343 -> $(readlink /dev/ttyCH343)"
    stty -F /dev/ttyCH343 -a 2>/dev/null | head -1
else
    echo "CH343 сейчас не подключён — имя появится при подключении"
fi

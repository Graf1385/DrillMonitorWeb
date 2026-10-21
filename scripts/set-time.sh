#!/bin/bash
# DrillMonitorWeb: установка системного времени из данных BCS_Loader.
# Вызывается сервером через sudo (см. /etc/sudoers.d/drillmonitor):
#   sudo /opt/drillmonitor/scripts/set-time.sh <epoch_seconds_utc>
set -euo pipefail

EPOCH="${1:-}"
# Строго 10 цифр и правдоподобный диапазон (2023-11 … 2100-01)
[[ "$EPOCH" =~ ^[0-9]{10}$ ]] || { echo "bad epoch: '$EPOCH'" >&2; exit 1; }
(( EPOCH > 1700000000 && EPOCH < 4102444800 )) || { echo "epoch out of range: $EPOCH" >&2; exit 1; }

date -u -s "@${EPOCH}" >/dev/null
# RTC может отсутствовать или быть неисправен — это не ошибка
hwclock --systohc 2>/dev/null || true
echo "ok $(date -u '+%Y-%m-%d %H:%M:%S')"

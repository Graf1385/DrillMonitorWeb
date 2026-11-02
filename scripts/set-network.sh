#!/bin/bash
# DrillMonitorWeb: сеть устройства и перезагрузка. Запускается сервером от
# root через sudo (см. /etc/sudoers.d/drillmonitor). Ставится install.sh в
# /usr/local/lib/drillmonitor и принадлежит root: служба не может ни заменить
# его, ни подложить свой — пакет обновления сюда не пишет.
#
# Аргументы проверяются здесь, а не только в сервере: по sudo этот скрипт
# может вызвать любой код, работающий от имени службы.
set -euo pipefail
CON="Wired connection 1"
case "${1:-}" in
    # Табло не выходит в интернет: маршрут по умолчанию и серверы имён гасим в
    # обоих режимах — даже если их выдаёт DHCP-сервер сети буровой.
    dhcp)
        nmcli con mod "$CON" ipv4.method auto ipv4.addresses "" ipv4.gateway "" ipv4.dns "" \
              ipv4.never-default yes ipv4.ignore-auto-dns yes
        nmcli con up "$CON"
        ;;
    static)
        ADDR="${2:-}"
        [[ "$ADDR" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})/([0-9]{1,2})$ ]] \
            || { echo "bad address: '$ADDR'" >&2; exit 1; }
        for i in 1 2 3 4; do
            (( BASH_REMATCH[i] <= 255 )) || { echo "bad address: '$ADDR'" >&2; exit 1; }
        done
        (( BASH_REMATCH[5] >= 1 && BASH_REMATCH[5] <= 32 )) || { echo "bad prefix: '$ADDR'" >&2; exit 1; }
        nmcli con mod "$CON" ipv4.method manual ipv4.addresses "$ADDR" ipv4.gateway "" ipv4.dns "" \
              ipv4.never-default yes ipv4.ignore-auto-dns yes
        nmcli con up "$CON"
        ;;
    reboot)
        /sbin/reboot
        ;;
    # Перевод старой установки на новые права (scripts/migrate-layout.sh). Только
    # из прежнего места: там sudoers старой установки и разрешает этот скрипт.
    # Установленный в /usr/local/lib помощник этого не делает.
    migrate)
        SELF="$(readlink -f "$0")"
        [[ "$SELF" == /opt/drillmonitor/scripts/set-network.sh ]] \
            || { echo "migrate: только из старой установки" >&2; exit 1; }
        # Вне песочницы службы: внутри неё /etc и /usr только для чтения
        systemd-run --unit=drillmonitor-migrate --collect --quiet \
            /bin/bash "$(dirname "$SELF")/migrate-layout.sh"
        ;;
    *)
        echo "usage: $0 dhcp | static <a.b.c.d/prefix> | reboot | migrate" >&2
        exit 1
        ;;
esac

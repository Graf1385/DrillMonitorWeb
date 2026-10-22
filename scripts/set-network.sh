#!/bin/bash
set -euo pipefail
CON="Wired connection 1"
case "$1" in
    fix-ownership)
        chown -R drillmonitor:drillmonitor /opt/drillmonitor/scripts
        ;;
    # Табло не выходит в интернет: маршрут по умолчанию и серверы имён гасим в
    # обоих режимах — даже если их выдаёт DHCP-сервер сети буровой.
    dhcp)
        nmcli con mod "$CON" ipv4.method auto ipv4.addresses "" ipv4.gateway "" ipv4.dns "" \
              ipv4.never-default yes ipv4.ignore-auto-dns yes
        nmcli con up "$CON"
        ;;
    static)
        nmcli con mod "$CON" ipv4.method manual ipv4.addresses "$2" ipv4.gateway "" ipv4.dns "" \
              ipv4.never-default yes ipv4.ignore-auto-dns yes
        nmcli con up "$CON"
        ;;
    reboot)
        /sbin/reboot
        ;;
    *)
        exit 1
        ;;
esac

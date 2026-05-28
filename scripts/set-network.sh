#!/bin/bash
set -euo pipefail
CON="Wired connection 1"
case "$1" in
    fix-ownership)
        chown -R drillmonitor:drillmonitor /opt/drillmonitor/scripts
        ;;
    dhcp)
        nmcli con mod "$CON" ipv4.method auto ipv4.addresses "" ipv4.gateway "" ipv4.dns ""
        nmcli con up "$CON"
        ;;
    static)
        nmcli con mod "$CON" ipv4.method manual ipv4.addresses "$2" ipv4.gateway "$3" ipv4.dns "$4"
        nmcli con up "$CON"
        ;;
    *)
        exit 1
        ;;
esac

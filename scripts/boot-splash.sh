#!/usr/bin/env bash
# BCS: загрузочный splash-экран Plymouth с логотипом BCS_logo.svg
# Использование: sudo bash boot-splash.sh /путь/к/BCS_logo.svg
set -euo pipefail

SVG="${1:-/tmp/BCS_logo.svg}"
THEME_DIR=/usr/share/plymouth/themes/bcs

[[ -f "$SVG" ]] || { echo "Логотип не найден: $SVG" >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq plymouth plymouth-themes librsvg2-bin

mkdir -p "$THEME_DIR"
# librsvg не принимает нестандартный MIME "data:img/png" во встроенных растрах —
# правим на копии перед конвертацией
TMP_SVG=$(mktemp --suffix=.svg)
sed 's|data:img/png|data:image/png|g' "$SVG" > "$TMP_SVG"
rsvg-convert -w 480 --keep-aspect-ratio "$TMP_SVG" -o "$THEME_DIR/logo.png"
rm -f "$TMP_SVG"

cat > "$THEME_DIR/bcs.plymouth" <<EOF
[Plymouth Theme]
Name=BCS
Description=BCS boot splash
ModuleName=script

[script]
ImageDir=${THEME_DIR}
ScriptFile=${THEME_DIR}/bcs.script
EOF

cat > "$THEME_DIR/bcs.script" <<'EOF'
Window.SetBackgroundTopColor(0.0, 0.0, 0.0);
Window.SetBackgroundBottomColor(0.0, 0.0, 0.0);
logo.image = Image("logo.png");
logo.sprite = Sprite(logo.image);
logo.sprite.SetPosition(Window.GetX() + Window.GetWidth() / 2 - logo.image.GetWidth() / 2,
                        Window.GetY() + Window.GetHeight() / 2 - logo.image.GetHeight() / 2,
                        10000);
EOF

update-alternatives --install /usr/share/plymouth/themes/default.plymouth \
    default.plymouth "$THEME_DIR/bcs.plymouth" 200
update-alternatives --set default.plymouth "$THEME_DIR/bcs.plymouth"
update-initramfs -u

# GRUB: включаем quiet splash, сохраняя остальные параметры
. /etc/default/grub
NEW="${GRUB_CMDLINE_LINUX_DEFAULT:-}"
[[ "$NEW" == *quiet*  ]] || NEW="$NEW quiet"
[[ "$NEW" == *splash* ]] || NEW="$NEW splash"
NEW="$(echo "$NEW" | xargs)"
sed -i "s/^GRUB_CMDLINE_LINUX_DEFAULT=.*/GRUB_CMDLINE_LINUX_DEFAULT=\"$NEW\"/" /etc/default/grub
update-grub

echo "SPLASH_OK: тема $(plymouth-set-default-theme), cmdline: $NEW"

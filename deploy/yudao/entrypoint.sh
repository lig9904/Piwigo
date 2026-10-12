#!/bin/sh
set -eu

source_dir=/opt/piwigo
web_root=/var/www/html

if [ ! -f "$web_root/install.php" ]; then
    cp -a "$source_dir/." "$web_root/"
    chown -R www-data:www-data "$web_root"
fi

# Refresh only the fork's plugin on each startup; preserve every other plugin,
# Piwigo core file, configuration, gallery, and uploaded photo.
if [ -d "$source_dir/plugins/yudao_design" ]; then
    rm -rf "$web_root/plugins/yudao_design"
    cp -a "$source_dir/plugins/yudao_design" "$web_root/plugins/yudao_design"
    chown -R www-data:www-data "$web_root/plugins/yudao_design"
fi

mkdir -p "${YUDAO_STORAGE_ROOT:-/var/lib/yudao-design}"
chown www-data:www-data "${YUDAO_STORAGE_ROOT:-/var/lib/yudao-design}"

exec "$@"

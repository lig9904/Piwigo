#!/bin/sh
# Run on this fnOS NAS as root after uploading the commit archive to XMT.
set -eu
[ "$(id -u)" = 0 ] || { echo 'Run on NAS as root'; exit 1; }
[ "$#" = 3 ] || { echo 'Usage: deploy_p2.sh COMMIT ARCHIVE.zip EXPECTED_SHA256'; exit 1; }
revision=$1
archive=$2
expected=$3
case "$revision" in *[!0-9a-f]*|'') echo 'Invalid revision'; exit 1;; esac
[ "${#revision}" = 40 ] || { echo 'Use full 40-character git revision'; exit 1; }
actual=$(sha256sum "$archive" | cut -d' ' -f1)
[ "$actual" = "$expected" ] || { echo 'Source checksum mismatch'; exit 1; }
release="1.2.0-$(printf '%s' "$revision" | cut -c1-12)"
image="yudao-piwigo:$release"
runtime=/vol1/1000/yudao-piwigo
source="$runtime/releases/$release/source"
backup="/vol2/1000/design-library/backups/$release-before"
umask 077
[ ! -e "$source" ] || { echo 'Release source already exists; inspect existing receipt before resuming'; exit 1; }
if docker image inspect "$image" >/dev/null 2>&1; then echo 'Release tag already exists; refusing overwrite'; exit 1; fi
mkdir -p "$source"
chmod 700 "$runtime/releases" "$runtime/releases/$release"
unzip -q "$archive" -d "$source"
python3 "$source/tools/yudao/backup_restore.py" "$backup" --verify-restore
cp "$backup/restore-results.json" "$backup/restore-before-results.json"
docker build --build-arg YUDAO_RELEASE=1.2.0 --build-arg "YUDAO_SOURCE_REVISION=$revision" -f "$source/deploy/yudao/Dockerfile" -t "$image" "$source"
# Verify the new plugin against a restored copy before changing the live app.
python3 "$source/tools/yudao/backup_restore.py" "$backup" --restore-only --restore-image "$image"
cp "$backup/restore-results.json" "$backup/restore-upgrade-results.json"
python3 "$source/tools/yudao/switch_release.py" "$image" --source "$source"
warm_status=0
docker exec -u www-data -w /var/www/html yudao-piwigo-piwigo-1 php plugins/yudao_design/thumbnail_warm.php > "$runtime/releases/$release/preview-warm.json" || warm_status=$?
printf 'Release active: %s; backup: %s; preview warm exit: %s (fallback originals remain usable)\n' "$image" "$backup" "$warm_status"

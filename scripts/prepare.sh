#!/bin/sh
PUBLISHED_REPOSITORY='Xget7/splat-field-guide'
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PACK_TAG='pack-gol-trend-engine-bay-1'
PACK_ARCHIVE='gol-trend-engine-bay-1.tar.gz'
PACK_URL=${FIELD_GUIDE_PACK_URL:-https://github.com/$PUBLISHED_REPOSITORY/releases/download/$PACK_TAG/$PACK_ARCHIVE}
if [ "$#" -gt 0 ]; then
  if [ "$#" -ne 2 ] || [ "$1" != '--pack' ]; then
    echo 'Usage: scripts/prepare.sh [--pack <archive>]' >&2
    exit 2
  fi
fi
# The repository is private, so its release assets reach only authenticated clients.
# An authenticated gh downloads the archive once into the ignored releases folder.
CACHED_ARCHIVE="$ROOT/data/pack/releases/$PACK_ARCHIVE"
if [ "$#" -eq 0 ] && [ -z "${FIELD_GUIDE_PACK_URL:-}" ] && command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  if [ ! -f "$CACHED_ARCHIVE" ]; then
    mkdir -p "$(dirname "$CACHED_ARCHIVE")"
    gh release download "$PACK_TAG" --repo "$PUBLISHED_REPOSITORY" --pattern "$PACK_ARCHIVE" --clobber --output "$CACHED_ARCHIVE.partial"
    mv "$CACHED_ARCHIVE.partial" "$CACHED_ARCHIVE"
  fi
  set -- --pack "$CACHED_ARCHIVE"
fi
# A fresh checkout needs the compiler to run the app parser before accepting pack files.
if [ ! -d "$ROOT/apps/field-guide/node_modules/typescript" ]; then
  nice -n 19 npm ci --ignore-scripts --prefix "$ROOT/apps/field-guide"
fi
nice -n 19 python3 "$ROOT/scripts/pack_archive.py" ensure --url "$PACK_URL" "$@"
nice -n 19 bash "$ROOT/packages/react-native-splat/scripts/build-ios-engine.sh"
nice -n 19 python3 "$ROOT/apps/field-guide/scripts/fetch-kokoro-models.py"
nice -n 19 npm ci --prefix "$ROOT/apps/field-guide"
for package in react-native-splat react-native-on-device; do
  nice -n 19 npm ci --prefix "$ROOT/packages/$package"
done
export BUNDLE_GEMFILE="$ROOT/apps/field-guide/Gemfile"
nice -n 19 bundle install
cd "$ROOT/apps/field-guide/ios"
nice -n 19 bundle exec pod install

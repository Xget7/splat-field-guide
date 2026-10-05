#!/bin/sh
# Fill this one owner/name constant when the repository is published.
PUBLISHED_REPOSITORY='FILL_IN_OWNER/FILL_IN_REPOSITORY'
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

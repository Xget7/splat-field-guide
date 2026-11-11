#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ ! -f "$ROOT/apps/field-guide/instructor.config.json" ]; then
  cp "$ROOT/apps/field-guide/instructor.config.example.json" "$ROOT/apps/field-guide/instructor.config.json"
fi
# With no explicit manifest/archive, prepare the empty app without downloading content.
if [ "$#" -gt 0 ]; then
  if [ "$#" -ne 4 ] || [ "$1" != '--manifest' ] || [ "$3" != '--pack' ]; then
    echo 'Usage: scripts/prepare.sh [--manifest <file> --pack <archive>]' >&2
    exit 2
  fi
  if [ ! -d "$ROOT/apps/field-guide/node_modules/typescript" ]; then
    nice -n 19 npm ci --ignore-scripts --prefix "$ROOT/apps/field-guide"
  fi
  nice -n 19 node "$ROOT/scripts/pack_archive.cjs" ensure "$@"
fi
nice -n 19 bash "$ROOT/packages/react-native-splat/scripts/build-ios-engine.sh"
nice -n 19 npm ci --prefix "$ROOT/apps/field-guide"
# npm may skip dependency install scripts; provision only the inference backends the app selects.
INIT_CWD="$ROOT/apps/field-guide" nice -n 19 node "$ROOT/apps/field-guide/node_modules/react-native-executorch/scripts/download-libs.js"
for package in react-native-splat react-native-on-device; do
  nice -n 19 npm ci --prefix "$ROOT/packages/$package"
done
export BUNDLE_GEMFILE="$ROOT/apps/field-guide/Gemfile"
nice -n 19 bundle install
cd "$ROOT/apps/field-guide/ios"
nice -n 19 bundle exec pod install

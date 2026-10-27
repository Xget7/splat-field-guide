#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec nice -n 19 node "$ROOT/scripts/pack_archive.cjs" package "$@"

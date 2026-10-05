#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec nice -n 19 python3 "$ROOT/scripts/pack_archive.py" package "$@"

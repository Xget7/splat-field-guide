#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT"
exec nice -n 19 uv run --project pipeline python -m pipeline.pack.training "$@"

#!/bin/sh
# Training is a separate stage; pose recovery starts from scratch in poses.py.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec nice -n 19 uv run "$ROOT/pipeline/training.py" "$@"

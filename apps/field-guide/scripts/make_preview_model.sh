#!/bin/sh
# Writes a light copy of a USDZ capture for the library's turning preview.
# Object Capture bakes 4K maps; the preview keeps the colour map at 2K and the rest at 1K.
set -eu

SOURCE="$1"
DESTINATION="$2"
COLOR_SIZE=2048
DETAIL_SIZE=1024

if [ ! -f "$SOURCE" ] || ! command -v usdzip >/dev/null 2>&1; then
  rm -f "$DESTINATION"
  echo "note: no preview model; the library shows the guide's photo"
  exit 0
fi
if [ "$DESTINATION" -nt "$SOURCE" ] && [ "$DESTINATION" -nt "$0" ]; then
  exit 0
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
unzip -q "$SOURCE" -d "$WORK/model"
cd "$WORK/model"
LAYER=$(find . -maxdepth 1 -name '*.usdc' | head -n 1)
TEXTURES=$(find . -mindepth 2 -type f -name '*.png' | sort)
for texture in $TEXTURES; do
  case "$texture" in
    *_tex*) sips -Z "$COLOR_SIZE" "$texture" >/dev/null ;;
    *) sips -Z "$DETAIL_SIZE" "$texture" >/dev/null ;;
  esac
done
# The layer must come first: it is the package's default layer.
# shellcheck disable=SC2086
usdzip "$WORK/preview.usdz" "$LAYER" $TEXTURES >/dev/null
mkdir -p "$(dirname "$DESTINATION")"
mv "$WORK/preview.usdz" "$DESTINATION"
echo "Preview model: $(du -h "$DESTINATION" | cut -f1)"

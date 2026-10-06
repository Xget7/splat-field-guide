#!/bin/sh
# Only the trained reference ships; training runs on the Mac.
set -eu

REFERENCE_ROOT="$SRCROOT/../../../data/ar-reference/gol-trend-engine-bay"
AR_DEST="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/ar/gol-trend-engine-bay"
mkdir -p "$AR_DEST"
cp "$SRCROOT/../assets/ar/landmarks.json" "$AR_DEST/landmarks.json"

if [ -f "$REFERENCE_ROOT/engine-bay.referenceobject" ]; then
  cp "$REFERENCE_ROOT/engine-bay.referenceobject" "$AR_DEST/engine-bay.referenceobject"
else
  # Remove a stale reference from an earlier build instead of silently mixing versions.
  rm -f "$AR_DEST/engine-bay.referenceobject"
  echo "note: AR reference training is pending; this build shows its unavailable state"
fi

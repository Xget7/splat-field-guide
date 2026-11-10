#!/bin/sh
# Keep the current guide preview until a real Miris pack replaces the bundled guide.
set -eu
SOURCE="$SRCROOT/../../../data/ar-reference/gol-trend-engine-bay/aligned.cleaned.usdz"
DEST="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/ar/gol-trend-engine-bay"
# Remove resources from earlier builds that supported the discarded AR screens.
rm -f "$DEST/landmarks.json" "$DEST/engine-bay.usdz" "$DEST/engine-bay.referenceobject"
rm -f "$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/ar/engine.usdz"
nice -n 19 "$SRCROOT/../scripts/make_preview_model.sh" "$SOURCE" "$DEST/turntable.usdz"

#!/bin/sh
# Archive a Release build and upload it to App Store Connect for TestFlight.
#
#   scripts/testflight.sh            archive and upload
#   scripts/testflight.sh --no-upload  archive and export an .ipa only
#
# Set FIELD_GUIDE_TEAM_ID to your Apple developer team; Xcode must be signed in to it.
# The build number is the UTC date and time, so every upload is newer than the last without
# a commit to bump it.
set -eu

team_id_error="FIELD_GUIDE_TEAM_ID must be 10 uppercase letters or digits"
: "${FIELD_GUIDE_TEAM_ID:?Set FIELD_GUIDE_TEAM_ID to your Apple developer team ID}"
case "$FIELD_GUIDE_TEAM_ID" in
  *[!A-Z0-9]*|"") echo "$team_id_error" >&2; exit 2 ;;
esac
[ "${#FIELD_GUIDE_TEAM_ID}" -eq 10 ] || { echo "$team_id_error" >&2; exit 2; }

cd "$(dirname "$0")/../ios"

BUILD_NUMBER="$(date -u +%y%m%d.%H%M)"
OUT="build/testflight/$BUILD_NUMBER"
DESTINATION=upload
if [ "${1:-}" = "--no-upload" ]; then
  DESTINATION=export
fi

mkdir -p "$OUT"
cat > "$OUT/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>app-store-connect</string>
	<key>destination</key>
	<string>$DESTINATION</string>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>teamID</key>
	<string>$FIELD_GUIDE_TEAM_ID</string>
	<key>manageAppVersionAndBuildNumber</key>
	<false/>
	<key>uploadSymbols</key>
	<true/>
</dict>
</plist>
EOF

COMPILATION_CACHE_ENABLE_CACHING=NO nice -n 19 xcodebuild \
  -workspace FieldGuide.xcworkspace \
  -derivedDataPath "$OUT/DerivedData" \
  -scheme FieldGuide \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$OUT/FieldGuide.xcarchive" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$FIELD_GUIDE_TEAM_ID" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  archive

COMPILATION_CACHE_ENABLE_CACHING=NO nice -n 19 xcodebuild \
  -exportArchive \
  -archivePath "$OUT/FieldGuide.xcarchive" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" \
  -exportPath "$OUT/export" \
  -allowProvisioningUpdates

echo "Build $BUILD_NUMBER: $DESTINATION done, archive in ios/$OUT"

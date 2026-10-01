#!/bin/sh
# Archive a Release build and upload it to App Store Connect for TestFlight.
#
#   scripts/testflight.sh            archive and upload
#   scripts/testflight.sh --no-upload  archive and export an .ipa only
#
# Signing is automatic with the project's team, so Xcode must be signed in to an account on it.
# The build number is the UTC date and time, so every upload is newer than the last without
# a commit to bump it.
set -eu

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
	<string>R2NGS9RVQ9</string>
	<key>manageAppVersionAndBuildNumber</key>
	<false/>
	<key>uploadSymbols</key>
	<true/>
</dict>
</plist>
EOF

xcodebuild \
  -workspace FieldGuide.xcworkspace \
  -scheme FieldGuide \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$OUT/FieldGuide.xcarchive" \
  -allowProvisioningUpdates \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  archive

xcodebuild \
  -exportArchive \
  -archivePath "$OUT/FieldGuide.xcarchive" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" \
  -exportPath "$OUT/export" \
  -allowProvisioningUpdates

echo "Build $BUILD_NUMBER: $DESTINATION done, archive in ios/$OUT"

#!/usr/bin/env bash
# Build before pod installation so CocoaPods receives a framework matching the engine sources.
set -euo pipefail

package="$(cd "$(dirname "$0")/.." && pwd)"
force=false
usage="Usage: build-ios-engine.sh [--force]"
case "${1:-}" in
  "") ;;
  --force) force=true ;;
  *) echo "$usage" >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || { echo "$usage" >&2; exit 2; }
identity="$package/scripts/engine-artifact.rb"
if ! $force && ruby "$identity" --verify 2>/dev/null; then
  echo "Engine framework is current"
  exit 0
fi
fingerprint="$(ruby "$identity")"
engine="$package/engine"
build="${SPLAT_IOS_BUILD_DIR:-$package/build/ios-engine}"
jobs="${SPLAT_BUILD_JOBS:-$(sysctl -n hw.ncpu)}"
output="$package/ios/Frameworks/SplatKitCore.xcframework"
# React Native's own minimum; the renderer itself needs an A14 GPU, which it checks at run time.
deployment_target=15.1
sdks=(iphoneos iphonesimulator)

for sdk in "${sdks[@]}"; do
  tree="$build/$sdk"
  sdk_path="$(xcrun --sdk "$sdk" --show-sdk-path)"
  # The CMake cache keeps the SDK's absolute path, which an Xcode update removes.
  if [[ -f "$tree/sdk-path" && "$(cat "$tree/sdk-path")" != "$sdk_path" ]]; then
    rm -rf "$tree"
  fi
  mkdir -p "$tree"
  echo "$sdk_path" > "$tree/sdk-path"
  cmake -S "$engine/splatkit-ios" -B "$tree" \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_SYSTEM_NAME=iOS \
    -DCMAKE_OSX_SYSROOT="$sdk" -DCMAKE_OSX_ARCHITECTURES=arm64 \
    -DCMAKE_OSX_DEPLOYMENT_TARGET="$deployment_target" \
    -DCMAKE_C_COMPILER_WORKS=ON -DCMAKE_CXX_COMPILER_WORKS=ON
  cmake --build "$tree" --parallel "$jobs" --target splatkit_ios
  xcrun libtool -static -no_warning_for_no_symbols -o "$tree/libSplatKitCore.a" \
    "$tree/libsplatkit_ios.a" \
    "$tree/splatkit-engine/libsplatkit_engine.a" \
    "$tree/splatkit-engine/splat-core/libsplat_core.a" \
    "$tree/_deps/spz-build/libspz.a" \
    "$tree/_deps/zstd-build/lib/libzstd.a"
done

rm -rf "$build/headers"
mkdir -p "$build/headers/splatkit"
cp "$engine/splatkit-ios/module.modulemap" "$build/headers/"
cp "$engine/splatkit-engine/include/splatkit/sfg.h" \
  "$engine/splatkit-ios/Sources/SplatKitCore/include/splatkit/sfg_metal.h" \
  "$build/headers/splatkit/"

candidate="$build/SplatKitCore.xcframework"
rm -rf "$candidate"
python3 "$package/scripts/package-ios-engine.py" "$build" "$candidate"
[[ "$(ruby "$identity")" == "$fingerprint" ]] || {
  echo "Engine sources changed during the build; run scripts/prepare.sh again" >&2
  exit 1
}
ruby "$identity" --record "$candidate" "$fingerprint"
mkdir -p "$(dirname "$output")"
rm -rf "$output"
mv "$candidate" "$output"
echo "Built $output"

#!/usr/bin/env bash
# Builds the engine as ios/Frameworks/SplatKitCore.xcframework, which the pod vendors: one
# static library for devices and one for the simulator, each the engine, its Metal renderer,
# SPZ and its zstd merged, with the C interface's headers and module map. Run it before
# `pod install` and after changing anything under engine/.
#
#   scripts/build-ios-engine.sh
#
# SPLAT_IOS_BUILD_DIR moves the CMake build trees, build/ios-engine by default; SPLAT_BUILD_JOBS
# caps the parallel jobs.
set -euo pipefail

package="$(cd "$(dirname "$0")/.." && pwd)"
engine="$package/engine"
build="${SPLAT_IOS_BUILD_DIR:-$package/build/ios-engine}"
jobs="${SPLAT_BUILD_JOBS:-$(sysctl -n hw.ncpu)}"
output="$package/ios/Frameworks/SplatKitCore.xcframework"
# React Native's own minimum; the renderer itself needs an A14 GPU, which it checks at run time.
deployment_target=15.1
sdks=(iphoneos iphonesimulator)

libraries=()
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
  libraries+=(-library "$tree/libSplatKitCore.a" -headers "$build/headers")
done

rm -rf "$build/headers"
mkdir -p "$build/headers/splatkit"
cp "$engine/splatkit-ios/module.modulemap" "$build/headers/"
cp "$engine/splatkit-engine/include/splatkit/sfg.h" \
  "$engine/splatkit-ios/Sources/SplatKitCore/include/splatkit/sfg_metal.h" \
  "$build/headers/splatkit/"

rm -rf "$output"
xcodebuild -create-xcframework "${libraries[@]}" -output "$output"
echo "Built $output"

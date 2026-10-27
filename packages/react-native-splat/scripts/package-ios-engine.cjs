#!/usr/bin/env node
// Package the two arm64 static libraries without starting another Xcode build.
const fs = require('node:fs');
const path = require('node:path');
const LIBRARY = 'libSplatKitCore.a';
function packageEngine(build, output) {
  if (fs.existsSync(output))
    throw new Error('XCFramework output must not exist');
  fs.mkdirSync(output, { recursive: true });
  const libraries = [
    ['iphoneos', 'ios-arm64'],
    ['iphonesimulator', 'ios-arm64-simulator', 'simulator'],
  ].map(([sdk, identifier, variant]) => {
    const directory = path.join(output, identifier);
    fs.mkdirSync(directory);
    fs.copyFileSync(
      path.join(build, sdk, LIBRARY),
      path.join(directory, LIBRARY),
    );
    fs.cpSync(path.join(build, 'headers'), path.join(directory, 'Headers'), {
      recursive: true,
      preserveTimestamps: true,
    });
    return `<dict><key>LibraryIdentifier</key><string>${identifier}</string><key>LibraryPath</key><string>${LIBRARY}</string><key>HeadersPath</key><string>Headers</string><key>SupportedArchitectures</key><array><string>arm64</string></array><key>SupportedPlatform</key><string>ios</string>${
      variant
        ? `<key>SupportedPlatformVariant</key><string>${variant}</string>`
        : ''
    }</dict>`;
  });
  fs.writeFileSync(
    path.join(output, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>AvailableLibraries</key><array>${libraries.join(
      '',
    )}</array><key>CFBundlePackageType</key><string>XFWK</string><key>XCFrameworkFormatVersion</key><string>1.0</string></dict></plist>\n`,
  );
}
if (require.main === module) {
  try {
    if (process.argv.length !== 4)
      throw new Error('Usage: package-ios-engine.cjs BUILD OUTPUT');
    packageEngine(process.argv[2], process.argv[3]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { packageEngine };

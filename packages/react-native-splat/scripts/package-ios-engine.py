#!/usr/bin/env python3
"""Package the two arm64 static libraries without starting another Xcode build."""

import plistlib
from pathlib import Path
import shutil
import sys

SLICES = (("iphoneos", "ios-arm64", None),
          ("iphonesimulator", "ios-arm64-simulator", "simulator"))
LIBRARY = "libSplatKitCore.a"


def package(build: Path, output: Path) -> None:
    output.mkdir(parents=True)
    libraries = []
    for sdk, identifier, variant in SLICES:
        directory = output / identifier
        directory.mkdir()
        shutil.copy2(build / sdk / LIBRARY, directory / LIBRARY)
        shutil.copytree(build / "headers", directory / "Headers")
        entry = {"LibraryIdentifier": identifier, "LibraryPath": LIBRARY,
                 "HeadersPath": "Headers", "SupportedArchitectures": ["arm64"],
                 "SupportedPlatform": "ios"}
        if variant:
            entry["SupportedPlatformVariant"] = variant
        libraries.append(entry)
    with (output / "Info.plist").open("wb") as handle:
        plistlib.dump({"AvailableLibraries": libraries, "CFBundlePackageType": "XFWK",
                      "XCFrameworkFormatVersion": "1.0"}, handle)


if __name__ == "__main__":
    package(Path(sys.argv[1]), Path(sys.argv[2]))

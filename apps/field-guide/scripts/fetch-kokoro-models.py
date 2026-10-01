#!/usr/bin/env python3
"""Fetch pinned Kokoro build resources, verifying every file before bundling."""
import argparse
import concurrent.futures
import fcntl
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import time
import urllib.request

REPO = Path(__file__).resolve().parents[3]
PACKAGE = REPO / "packages/react-native-on-device"
DESTINATION = PACKAGE / "ios/KokoroResources"
MANIFEST = Path(__file__).with_name("kokoro-models.json")


def digest(path):
    with path.open("rb") as handle:
        checksum = hashlib.sha256()
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            checksum.update(chunk)
        return checksum.hexdigest()


def fetch(asset, verify_only):
    target = DESTINATION / asset["path"]
    if target.is_file() and digest(target) == asset["sha256"]:
        return
    if verify_only:
        raise RuntimeError(f"Missing or damaged Kokoro resource: {target}")
    target.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(3):
        temporary = None
        try:
            request = urllib.request.Request(asset["url"], headers={"User-Agent": "FieldGuide-build/1"})
            with urllib.request.urlopen(request, timeout=120) as response:
                with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as output:
                    temporary = Path(output.name)
                    shutil.copyfileobj(response, output)
            if digest(temporary) != asset["sha256"]:
                raise RuntimeError(f"SHA-256 mismatch for {asset['path']}")
            temporary.replace(target)
            print(f"Verified {asset['path']}", flush=True)
            return
        except Exception:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-only", action="store_true", help="Check cached files without network access")
    args = parser.parse_args()
    DESTINATION.mkdir(parents=True, exist_ok=True)
    with (DESTINATION.parent / ".kokoro-fetch.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        assets = json.loads(MANIFEST.read_text())
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda asset: fetch(asset, args.verify_only), assets))
        for source in (PACKAGE / "LICENSES").glob("*.txt"):
            shutil.copyfile(source, DESTINATION / source.name)
    size = sum((DESTINATION / asset["path"]).stat().st_size for asset in assets)
    print(f"Kokoro bundle verified: {size:,} bytes, no runtime downloads")


if __name__ == "__main__":
    main()

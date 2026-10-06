"""Stream opt-in ARKit diagnostics from an iPhone using Xcode's devicectl.

Keeps metadata only, caps the capture at 512 KiB, and never records camera images.
Camera FPS measures ARFrame delivery, not the model's inference rate or confidence.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import selectors
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
PREFIX = "[ARGuide] "
CAPTURE_LIMIT = 512 * 1024
CAPTURE_FULL = {"event": "error", "detail": "capture byte limit reached"}


def recognition_verdict(records: list[dict], expected: str) -> dict:
    """Check ARKit's observable result, not model accuracy or overlay alignment."""
    frames = [r for r in records if r.get("event") == "frame"]
    tracked = sum(r.get("trackedObjectAnchors", 0) > 0 for r in frames)
    first_tracked = next((r for r in frames if r.get("trackedObjectAnchors", 0) > 0), None)
    errors = sum(r.get("event") == "error" for r in records)
    observed = "detected" if tracked else "absent"
    return {
        "pass": bool(frames) and errors == 0 and observed == expected,
        "expected": expected,
        "observed": observed if frames else "no-camera-samples",
        "frameSamples": len(frames),
        "samplesWithTrackedObject": tracked,
        "trackedSampleFraction": tracked / len(frames) if frames else None,
        "firstTrackedSessionSeconds": first_tracked.get("sessionSeconds") if first_tracked else None,
        "errors": errors,
        "overlayAlignmentVerified": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", help="Connected iPhone name or identifier, required for a live capture.")
    parser.add_argument("--duration", type=int, default=900, help="Capture seconds (default: 15 minutes).")
    parser.add_argument("--output", type=Path, default=ROOT / "data/diagnostics/ar-live.jsonl")
    parser.add_argument("--expect", choices=("detected", "absent"), help="Exit 1 when ARKit's result does not match.")
    parser.add_argument("--check-capture", type=Path, help="Evaluate an existing JSONL without launching the phone app.")
    args = parser.parse_args()
    if args.check_capture is not None:
        if args.expect is None:
            parser.error("--check-capture requires --expect detected or absent")
        records = [json.loads(line) for line in args.check_capture.read_text().splitlines() if line.strip()]
        verdict = recognition_verdict(records, args.expect)
        print(json.dumps(verdict, indent=2))
        raise SystemExit(0 if verdict["pass"] else 1)
    if not 1 <= args.duration <= 3600:
        parser.error("duration must be between 1 and 3600 seconds")
    if not args.device:
        parser.error("a live capture requires --device")
    output = args.output.resolve()
    status_path = output.with_suffix(".status.json")
    output.parent.mkdir(parents=True, exist_ok=True)
    if status_path.exists():
        previous = json.loads(status_path.read_text())
        if previous.get("status") in ("starting", "listening"):
            try:
                os.kill(previous["monitorPID"], 0)
            except ProcessLookupError:
                pass
            else:
                parser.error(f"A live capture is already running (PID {previous['monitorPID']}).")

    state = {
        "status": "starting",
        "monitorPID": os.getpid(),
        "device": args.device,
        "startedAtUTC": datetime.now(timezone.utc).isoformat(),
        "launchConfirmed": False,
        "events": 0,
        "frameSamples": 0,
        "samplesWithTrackedObject": 0,
        "errors": [],
        "deviceErrors": [],
        "captureByteLimit": CAPTURE_LIMIT,
    }
    records = []

    def save_status() -> None:
        temporary = status_path.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(state, indent=2) + "\n")
        temporary.replace(status_path)

    # A new launch is necessary to enable diagnostics and attach stdout/stderr.
    command = [
        "xcrun", "devicectl", "device", "process", "launch", "--device", args.device,
        "--terminate-existing", "--console",
        "--environment-variables", json.dumps({"FIELD_GUIDE_AR_DIAGNOSTICS": "1"}),
        "dev.splatfieldguide.app",
    ]
    child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, bufsize=0)
    assert child.stdout is not None
    selector = selectors.DefaultSelector()
    selector.register(child.stdout, selectors.EVENT_READ)
    deadline = time.monotonic() + args.duration
    pending = b""
    limit_record = (json.dumps(CAPTURE_FULL, separators=(",", ":")) + "\n").encode()
    full = False
    save_status()
    print(f"Preparando captura en {args.device}; esperando confirmación de Xcode.", flush=True)
    print("Sin imágenes ni audio; registro limitado a 512 KiB. FPS = cámara, no inferencias.", flush=True)
    try:
        with output.open("wb") as capture:
            while time.monotonic() < deadline and not full:
                ready = selector.select(timeout=0.5)
                if not ready:
                    if child.poll() is not None:
                        break
                    continue
                chunk = os.read(child.stdout.fileno(), 8192)
                if not chunk:
                    break
                pending += chunk
                while b"\n" in pending:
                    raw, pending = pending.split(b"\n", 1)
                    line = raw.decode("utf-8", errors="replace")
                    if "Launched application with" in line and not state["launchConfirmed"]:
                        state["launchConfirmed"] = True
                        state["status"] = "listening"
                        save_status()
                        print(f"Escuchando AR en {args.device}. Abrí Gol → Open AR alignment check.", flush=True)
                    if PREFIX not in line:
                        if line.strip().startswith("ERROR:"):
                            # Keep only bounded launcher errors, not unrelated app console output.
                            error = line.strip()[:2000]
                            state["deviceErrors"] = (state["deviceErrors"] + [error])[-10:]
                            print(error, flush=True)
                            save_status()
                        continue
                    try:
                        record = json.loads(line.split(PREFIX, 1)[1])
                    except json.JSONDecodeError:
                        continue
                    encoded = (json.dumps(record, separators=(",", ":")) + "\n").encode()
                    if capture.tell() + len(encoded) + len(limit_record) > CAPTURE_LIMIT:
                        # Retain every sample used by the verdict, and mark the incomplete capture on replay too.
                        capture.write(limit_record)
                        records.append(CAPTURE_FULL)
                        full = True
                        break
                    capture.write(encoded)
                    capture.flush()
                    state["events"] += 1
                    state["lastEvent"] = record
                    # At most one hour of 1 Hz frames plus bounded state transitions.
                    if args.expect is not None:
                        records.append(record)
                    if record.get("event") == "frame":
                        state["frameSamples"] += 1
                        state["samplesWithTrackedObject"] += int(record["trackedObjectAnchors"] > 0)
                        state["lastFrame"] = record
                        print(f"Cámara: {record['cameraTracking']}, {record['cameraFramesPerSecond']} FPS"
                              f", Objetos: {record['objectAnchors']}, Seguidos: {record['trackedObjectAnchors']}"
                              f", Pins: {record['pinsEnabled']}", flush=True)
                    elif record.get("event") == "state":
                        state["lastState"] = record
                        print(f"Estado: {record['state']}, {record['message']}", flush=True)
                    elif record.get("event") == "error":
                        state["errors"] = (state["errors"] + [record])[-10:]
                        print(f"Error: {record['detail']}", flush=True)
                    save_status()
                # Discard long, unrelated console lines without keeping their contents.
                if len(pending) > 16384:
                    pending = b""
        state["status"] = "finished"
    except KeyboardInterrupt:
        state["status"] = "stopped"
    finally:
        # SIGKILL stops the host reader; devicectl forwards catchable signals to the app.
        reader_exit_code = child.poll()
        if child.poll() is None:
            child.kill()
        child.wait()
        selector.close()
        child.stdout.close()
        state["endedAtUTC"] = datetime.now(timezone.utc).isoformat()
        state["consoleExitCode"] = child.returncode
        if not state["launchConfirmed"] or reader_exit_code not in (None, 0):
            state["status"] = "failed"
        if args.expect is not None:
            state["verdict"] = recognition_verdict(records, args.expect)
            if state["status"] == "failed":
                state["verdict"]["pass"] = False
                state["verdict"]["observed"] = "capture-unavailable"
        save_status()
    if args.expect is not None:
        print(json.dumps(state["verdict"], indent=2), flush=True)
        raise SystemExit(0 if state["verdict"]["pass"] else 1)


if __name__ == "__main__":
    main()

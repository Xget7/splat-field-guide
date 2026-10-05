# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Train Apple's offline AR object reference and persist logs, progress and state.

Run on a Mac with Xcode 27+. The output path must not exist. A checkpoint path may
already exist so an interrupted run can be resumed by invoking the same command.
"""

import argparse
import datetime
import hashlib
import json
import os
import shutil
import subprocess
import time
from pathlib import Path


def write_state(path, state):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, indent=2) + "\n")
    temporary.replace(path)


def train(args):
    if not args.source.is_file() or args.source.suffix != ".usdz":
        raise ValueError("Source must be an existing USDZ file.")
    if args.output.exists():
        raise ValueError(f"Refusing to overwrite {args.output}")
    directory = args.output.parent
    directory.mkdir(parents=True, exist_ok=True)
    prefix = directory / f"training-{args.mode}-{args.angles}"
    log_path = prefix.with_suffix(".log")
    csv_path = prefix.with_suffix(".progress.csv")
    summary_path = prefix.with_suffix(".summary.txt")
    state_path = prefix.with_suffix(".state.json")
    context_path = prefix.with_suffix(".source.json")
    checkpoint_path = prefix.with_suffix(".checkpoint")
    source_digest = hashlib.sha256(args.source.read_bytes()).hexdigest()
    context = {"source": str(args.source.resolve()), "sourceSHA256": source_digest, "mode": args.mode, "angles": args.angles}
    if context_path.exists() and json.loads(context_path.read_text()) != context:
        raise ValueError("Existing training context belongs to a different source or mode.")
    if state_path.exists():
        previous = json.loads(state_path.read_text())
        if previous.get("status") == "training":
            try:
                os.kill(previous["trainingPID"], 0)
            except ProcessLookupError:
                pass
            else:
                raise ValueError("Training is already running for this output directory.")
    if checkpoint_path.exists() and any(checkpoint_path.iterdir()) and not context_path.exists():
        raise ValueError("Existing checkpoint has no verified source context.")
    if not context_path.exists():
        context_path.write_text(json.dumps(context, indent=2) + "\n")
    environment = os.environ.copy()
    scratch_dir = args.scratch_dir.resolve() if args.scratch_dir else Path(environment.get("TMPDIR", "/tmp")).resolve()
    scratch_dir.mkdir(parents=True, exist_ok=True)
    # Apple's Foundation on macOS can use its Darwin user temp directory even when
    # TMPDIR is overridden. Guard both volumes until Create ML's actual storage is
    # verified; an external TMPDIR alone must not bypass the internal disk guard.
    system_temp = Path(subprocess.check_output(["getconf", "DARWIN_USER_TEMP_DIR"], text=True).strip()).resolve()
    guarded_paths = {scratch_dir, system_temp, directory.resolve()}
    free_gib = min(shutil.disk_usage(path).free / 1024**3 for path in guarded_paths)
    if free_gib < args.min_free_gib:
        raise ValueError(f"A guarded temp/output volume has {free_gib:.1f} GiB free; require {args.min_free_gib:.1f} GiB before starting. Foundation may ignore external TMPDIR.")
    environment["TMPDIR"] = str(scratch_dir) + "/"
    command = ["xcrun", "createml", "objecttracker", "--source", str(args.source.resolve()), "--output", str(args.output.resolve()), "--checkpoint", str(checkpoint_path.resolve()), "--training-mode", args.mode, f"--{args.angles}", "--csv-progress", "--csv-fd", "4", "--summary", "--summary-fd", "5"]
    state = {"status": "starting", "startedAtUTC": datetime.datetime.now(datetime.UTC).isoformat(), "runnerPID": os.getpid(), "source": str(args.source.resolve()), "sourceSHA256": source_digest, "output": str(args.output.resolve()), "checkpoint": str(checkpoint_path.resolve()), "log": str(log_path.resolve()), "progressCSV": str(csv_path.resolve()), "summary": str(summary_path.resolve()), "scratchDirectory": str(scratch_dir), "systemTemporaryDirectory": str(system_temp), "guardedPaths": sorted(map(str, guarded_paths)), "scratchFreeGiBAtStart": free_gib, "command": command}
    write_state(state_path, state)
    print(json.dumps(state, indent=2), flush=True)
    started = time.monotonic()
    # The CLI documents CSV fd 4 and summary fd 5. A shell establishes those exact
    # descriptors; all paths are quoted with shlex rather than interpolated raw.
    import shlex
    shell_command = shlex.join(command) + " 4>" + shlex.quote(str(csv_path.resolve())) + " 5>" + shlex.quote(str(summary_path.resolve()))
    with log_path.open("a") as log:
        process = subprocess.Popen(["/bin/sh", "-c", "exec " + shell_command], stdout=log, stderr=subprocess.STDOUT, env=environment)
        state.update(status="training", trainingPID=process.pid)
        write_state(state_path, state)
        try:
            while process.poll() is None:
                time.sleep(15)
                progress = csv_path.read_text().strip().splitlines() if csv_path.exists() else []
                free_gib = min(shutil.disk_usage(path).free / 1024**3 for path in guarded_paths)
                state.update(elapsedSeconds=round(time.monotonic() - started), latestCSV=progress[-1] if progress else None, scratchFreeGiB=free_gib)
                write_state(state_path, state)
                print(f"training elapsed={state['elapsedSeconds']}s free={free_gib:.1f}GiB progress={state['latestCSV']}", flush=True)
                if free_gib < args.stop_below_free_gib:
                    state["failureReason"] = "scratch_disk_space_guard"
                    process.terminate()
                    process.wait()
                    break
        except KeyboardInterrupt:
            process.terminate()
            process.wait()
            state.update(status="interrupted", exitCode=process.returncode, elapsedSeconds=round(time.monotonic() - started))
            write_state(state_path, state)
            raise
    valid_output = args.output.exists() and (args.output.is_dir() or args.output.stat().st_size > 0)
    state.update(status="completed" if process.returncode == 0 and valid_output else "failed", exitCode=process.returncode, outputExists=valid_output, elapsedSeconds=round(time.monotonic() - started), endedAtUTC=datetime.datetime.now(datetime.UTC).isoformat())
    write_state(state_path, state)
    print(json.dumps(state, indent=2), flush=True)
    if state["status"] != "completed":
        raise ValueError(f"Training failed; see {log_path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--mode", choices=["standard", "extended"], default="standard")
    parser.add_argument("--angles", choices=["front", "upright", "all-angles"], default="upright")
    parser.add_argument("--plan", action="store_true", help="Print settings without starting training")
    parser.add_argument("--scratch-dir", type=Path, help="Set child TMPDIR; macOS Foundation may still use the internal user temp directory.")
    parser.add_argument("--min-free-gib", type=float, default=30, help="Preflight reserve; 30 GiB is a conservative local guard, not an Apple requirement.")
    parser.add_argument("--stop-below-free-gib", type=float, default=2, help="Terminate before scratch disk exhaustion.")
    args = parser.parse_args()
    if args.min_free_gib <= args.stop_below_free_gib or args.stop_below_free_gib <= 0:
        parser.error("The start reserve must exceed a positive stop reserve.")
    if args.plan:
        if not args.source.is_file():
            parser.error("Source must be an existing USDZ file.")
        command = ["xcrun", "createml", "objecttracker", "--source", str(args.source.resolve()),
                   "--output", str(args.output.resolve()), "--training-mode", args.mode, f"--{args.angles}"]
        print(json.dumps({"sourceSHA256": hashlib.sha256(args.source.read_bytes()).hexdigest(),
                          "mode": args.mode, "angles": args.angles, "command": command}, indent=2))
        return
    try:
        train(args)
    except (ValueError, OSError) as error:
        parser.exit(1, f"error: {error}\n")


if __name__ == "__main__":
    main()

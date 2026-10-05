"""Record macOS resource usage while a detached Create ML process runs.

GPU metrics describe the whole device, not just the training process. Run with
the Create ML PID from training-standard.state.json; results stay in data/.
"""

import argparse
import datetime
import json
import os
import plistlib
import re
import subprocess
import time
from pathlib import Path


def command(arguments):
    return subprocess.check_output(arguments, timeout=10)


def sample(pid):
    result = {"timeUTC": datetime.datetime.now(datetime.UTC).isoformat()}
    process = command([
        "ps", "-p", str(pid), "-o", "pid=,pcpu=,rss=,ni=,stat=",
    ]).decode().split()
    result["process"] = {
        "pid": int(process[0]), "cpuPercent": float(process[1]),
        "residentGiB": int(process[2]) / 1024**2,
        "nice": int(process[3]), "status": process[4],
    }
    try:
        devices = plistlib.loads(command(["ioreg", "-r", "-c", "IOAccelerator", "-a", "-l"]))
        gpu = []

        def visit(node):
            statistics = node.get("PerformanceStatistics", {})
            if "Device Utilization %" in statistics:
                gpu.append({
                    "name": node.get("IORegistryEntryName"),
                    "deviceUtilizationPercent": statistics["Device Utilization %"],
                })
            for child in node.get("IORegistryEntryChildren", []):
                visit(child)

        for device in devices:
            visit(device)
        result["gpuWholeDevice"] = gpu
    except (OSError, subprocess.SubprocessError, plistlib.InvalidFileException) as error:
        result["gpuError"] = str(error)
    try:
        memory = command(["memory_pressure", "-Q"]).decode()
        match = re.search(r"System-wide memory free percentage:\s*(\d+)%", memory)
        result["systemMemoryFreePercent"] = int(match[1]) if match else None
        result["swapUsage"] = command(["sysctl", "-n", "vm.swapusage"]).decode().strip()
    except (OSError, subprocess.SubprocessError) as error:
        result["memoryError"] = str(error)
    return result


def monitor(args):
    summary_path = args.output.with_suffix(".summary.json")
    if args.output.exists() or summary_path.exists():
        raise ValueError("Refusing to overwrite an existing resource recording.")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    count = 0
    cpu = []
    resident = []
    gpu = []
    summary = {"status": "monitoring", "pid": args.pid, "gpuScope": "whole_device"}

    def save_summary():
        temporary = summary_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(summary, indent=2) + "\n")
        temporary.replace(summary_path)

    with args.output.open("x") as recording:
        while True:
            try:
                os.kill(args.pid, 0)
                metrics = sample(args.pid)
            except (ProcessLookupError, subprocess.CalledProcessError):
                summary["status"] = "process_finished"
                break
            recording.write(json.dumps(metrics) + "\n")
            recording.flush()
            count += 1
            cpu.append(metrics["process"]["cpuPercent"])
            resident.append(metrics["process"]["residentGiB"])
            gpu.extend(device["deviceUtilizationPercent"] for device in metrics.get("gpuWholeDevice", []))
            summary.update(
                elapsedSeconds=round(time.monotonic() - started), samples=count,
                latest=metrics, cpuMeanPercent=sum(cpu) / count,
                cpuPeakPercent=max(cpu), residentPeakGiB=max(resident),
                gpuDeviceMeanPercent=sum(gpu) / len(gpu) if gpu else None,
                gpuDevicePeakPercent=max(gpu) if gpu else None,
            )
            save_summary()
            if time.monotonic() - started >= args.duration_seconds:
                summary["status"] = "completed"
                break
            time.sleep(max(0, min(args.interval_seconds, args.duration_seconds - (time.monotonic() - started))))
    save_summary()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--duration-seconds", type=float, default=900)
    parser.add_argument("--interval-seconds", type=float, default=15)
    args = parser.parse_args()
    if args.pid <= 0 or args.duration_seconds < 0 or args.interval_seconds <= 0:
        parser.error("Use a positive PID and interval, and a nonnegative duration.")
    monitor(args)


if __name__ == "__main__":
    main()

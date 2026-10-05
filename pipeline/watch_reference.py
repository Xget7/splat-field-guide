# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Show live Create ML progress without controlling the training process."""

import argparse
import csv
import json
import math
import os
import shutil
import sys
import time
from pathlib import Path


DEFAULT_STATE = (
    Path(__file__).resolve().parents[1]
    / "data/ar-reference/gol-trend-engine-bay/training-standard.state.json"
)
STATUS = {
    "starting": "Preparando", "training": "Entrenando",
    "completed": "Completado", "failed": "Falló", "interrupted": "Interrumpido",
}


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) and result >= 0 else None
    except (TypeError, ValueError):
        return None


def duration(value):
    seconds = number(value)
    if seconds is None:
        return "calculando…"
    hours, rest = divmod(round(seconds), 3600)
    minutes, seconds = divmod(rest, 60)
    return f"{hours:02}:{minutes:02}:{seconds:02}"


def snapshot(state_path):
    try:
        state = json.loads(state_path.read_text())
    except (OSError, json.JSONDecodeError):
        return f"Esperando el estado del entrenamiento: {state_path}", None
    row = None
    csv_path = state.get("progressCSV")
    if csv_path:
        try:
            with Path(csv_path).open() as stream:
                for candidate in csv.DictReader(stream):
                    progress = number(candidate.get("progress"))
                    if progress is not None and progress <= 1:
                        row = candidate
        except OSError:
            pass
    progress = number(row.get("progress")) if row else None
    if state.get("status") == "completed":
        progress = 1.0
    filled = round((progress or 0) * 30)
    bar = "█" * filled + "░" * (30 - filled)
    percent = f"{progress * 100:.2f}%" if progress is not None else "calculando…"
    remaining = row.get("remaining_time") if row else None
    if state.get("status") == "completed":
        remaining = 0
    lines = [
        "Create ML , Gol Trend , referencia AR",
        STATUS.get(state.get("status"), state.get("status", "Sin estado")),
        f"[{bar}] {percent}",
        f"Transcurrido: {duration(state.get('elapsedSeconds'))}",
        f"Restante estimado por Create ML: {duration(remaining)}",
        f"Etapa: {row.get('stage') if row else 'preparación'}",
        f"Disco libre: {shutil.disk_usage(state_path.parent).free / 1024**3:.1f} GiB",
    ]
    pid = state.get("trainingPID")
    if state.get("status") == "training" and pid:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            lines.append("El proceso terminó; esperando el resultado del runner.")
    if state.get("failureReason"):
        lines.append(f"Motivo del fallo: {state['failureReason']}")
    if state.get("status") == "completed":
        lines.append(f"Resultado: {state.get('output')}")
    return "\n".join(lines), state.get("status")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--interval", type=float, default=5)
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    if not math.isfinite(args.interval) or args.interval <= 0:
        parser.error("The refresh interval must be positive and finite.")
    try:
        while True:
            display, status = snapshot(args.state)
            if sys.stdout.isatty() and not args.once:
                print("\033[2J\033[H", end="")
            print(display, flush=True)
            if args.once or status in {"completed", "failed", "interrupted"}:
                break
            print("\nCtrl+C para cerrar este monitor.\n", flush=True)
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nMonitor cerrado. El entrenamiento sigue independiente.")


if __name__ == "__main__":
    main()

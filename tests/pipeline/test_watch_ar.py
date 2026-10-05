"""Exercise the console reader with actual child-process output, without a phone."""

import contextlib
import io
import json
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[2] / "pipeline/watch_ar.py"


class WatchARStartupTests(unittest.TestCase):
    def capture(self, console, exit_code=0):
        original_popen = subprocess.Popen

        def console_process(*args, **kwargs):
            program = f"import sys; sys.stdout.write({console!r}); sys.stdout.flush(); sys.exit({exit_code})"
            return original_popen([sys.executable, "-c", program], **kwargs)

        with tempfile.TemporaryDirectory(prefix="sfg-watch-ar-test-") as directory:
            output = Path(directory) / "capture.jsonl"
            argv = [str(SCRIPT), "--device", "fixture-phone", "--duration", "2", "--output", str(output), "--expect", "detected"]
            stdout = io.StringIO()
            with patch.object(sys, "argv", argv), patch.object(subprocess, "Popen", console_process), contextlib.redirect_stdout(stdout):
                with self.assertRaises(SystemExit) as stopped:
                    runpy.run_path(str(SCRIPT), run_name="__main__")
            status = json.loads(output.with_suffix(".status.json").read_text())
            replay = io.StringIO()
            with patch.object(sys, "argv", [str(SCRIPT), "--check-capture", str(output), "--expect", "detected"]), contextlib.redirect_stdout(replay):
                with self.assertRaises(SystemExit):
                    runpy.run_path(str(SCRIPT), run_name="__main__")
            status["replay"] = json.loads(replay.getvalue())
            return stopped.exception.code, stdout.getvalue(), status

    def test_failed_launch_never_claims_listening_and_preserves_connection_error(self):
        message = "ERROR: The device is not able to fulfill the requested usage assertion requirements. (com.apple.dt.CoreDeviceError error 4016)"
        code, stdout, status = self.capture(message + "\n", 1)
        self.assertEqual(code, 1)
        self.assertNotIn("Escuchando AR", stdout)
        self.assertIn("CoreDeviceError", stdout)
        self.assertEqual(status["status"], "failed")
        self.assertEqual(status["deviceErrors"], [message])
        self.assertEqual(status["verdict"]["observed"], "capture-unavailable")

    def test_confirmed_launch_and_tracked_frame_pass(self):
        frame = {"event": "frame", "cameraTracking": "normal", "cameraFramesPerSecond": 60,
                 "objectAnchors": 1, "trackedObjectAnchors": 1, "pinsEnabled": True,
                 "sessionSeconds": 5}
        console = "Launched application with dev.splatfieldguide.app bundle identifier.\n[ARGuide] " + json.dumps(frame) + "\n"
        code, stdout, status = self.capture(console)
        self.assertEqual(code, 0)
        self.assertIn("Escuchando AR", stdout)
        self.assertTrue(status["launchConfirmed"])
        self.assertEqual(status["verdict"]["observed"], "detected")

    def test_missing_launch_confirmation_is_a_capture_failure(self):
        code, stdout, status = self.capture("Connecting to device.\n")
        self.assertEqual(code, 1)
        self.assertNotIn("Escuchando AR", stdout)
        self.assertEqual(status["status"], "failed")

    def test_full_capture_retains_the_evidence_for_its_verdict(self):
        records = [{"event": "frame", "trackedObjectAnchors": 1, "cameraTracking": "normal",
                    "cameraFramesPerSecond": 60, "objectAnchors": 1, "pinsEnabled": True}]
        records += [{"event": "state", "state": "running", "message": "x" * 2000}] * 300
        records += [{**records[0], "trackedObjectAnchors": 0}]
        console = "Launched application with fixture bundle identifier.\n"
        console += "".join("[ARGuide] " + json.dumps(r) + "\n" for r in records)
        _, _, status = self.capture(console)
        self.assertEqual(status["verdict"], status["replay"])


if __name__ == "__main__":
    unittest.main()

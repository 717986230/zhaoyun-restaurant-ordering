"""
The installer's edit to ~/.claude/settings.json. A broken settings file
silently switches off every setting in it, so this is the part of the install
that must not be wrong.

    python3 -m unittest tools/laya-gate/test_merge_settings.py
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("merge_settings.py")


class MergeSettingsTest(unittest.TestCase):
    def install(self, settings_text=None):
        folder = Path(tempfile.mkdtemp())
        path = folder / "settings.json"
        if settings_text is not None:
            path.write_text(settings_text, encoding="utf-8")
        result = subprocess.run(
            [sys.executable, str(SCRIPT), str(path), "/home/me/.laya/venv/bin/python", "/home/me/.claude/hooks/laya_gate.py"],
            capture_output=True, text=True,
        )
        return result, path, folder

    def test_a_missing_file_is_created_with_just_the_gate(self):
        result, path, _ = self.install()
        self.assertEqual(result.returncode, 0, result.stdout)
        pre = json.loads(path.read_text())["hooks"]["PreToolUse"]
        self.assertEqual(len(pre), 1)
        self.assertIn("laya_gate.py", pre[0]["hooks"][0]["command"])

    def test_everything_already_there_survives(self):
        existing = {
            "model": "opus",
            "permissions": {"allow": ["Bash(npm *)"]},
            "hooks": {
                "PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "echo mine"}]}],
                "PostToolUse": [{"matcher": "Write", "hooks": [{"type": "command", "command": "prettier"}]}],
            },
        }
        result, path, folder = self.install(json.dumps(existing))
        self.assertEqual(result.returncode, 0, result.stdout)
        merged = json.loads(path.read_text())
        self.assertEqual(merged["model"], "opus")
        self.assertEqual(merged["permissions"], existing["permissions"])
        self.assertEqual(merged["hooks"]["PostToolUse"], existing["hooks"]["PostToolUse"])
        self.assertEqual(merged["hooks"]["PreToolUse"][0], existing["hooks"]["PreToolUse"][0])
        self.assertEqual(len(merged["hooks"]["PreToolUse"]), 2)
        backups = list(folder.glob("settings.json.bak-*"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(json.loads(backups[0].read_text()), existing)

    def test_running_it_again_updates_rather_than_duplicates(self):
        result, path, _ = self.install()
        again = subprocess.run(
            [sys.executable, str(SCRIPT), str(path), "/new/python", "/home/me/.claude/hooks/laya_gate.py"],
            capture_output=True, text=True,
        )
        self.assertEqual(again.returncode, 0, again.stdout)
        pre = json.loads(path.read_text())["hooks"]["PreToolUse"]
        self.assertEqual(len(pre), 1)
        self.assertIn("/new/python", pre[0]["hooks"][0]["command"])

    def test_a_broken_file_is_left_exactly_as_it_was(self):
        broken = '{ "model": "opus", '
        result, path, folder = self.install(broken)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(path.read_text(), broken)
        self.assertEqual(list(folder.glob("settings.json.*")), [])

    def test_a_hooks_key_of_the_wrong_shape_is_not_overwritten(self):
        odd = json.dumps({"hooks": ["not", "an", "object"]})
        result, path, _ = self.install(odd)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(path.read_text(), odd)


if __name__ == "__main__":
    unittest.main()

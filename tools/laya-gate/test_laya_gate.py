"""
Runs the hook the way Claude Code does — JSON on stdin, a decision on stdout —
against a stand-in Laya server, so the mapping from Laya's answer to allow,
ask and deny is checked without downloading a model.

    python3 -m unittest tools/laya-gate/test_laya_gate.py
"""
import json
import os
import subprocess
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

HOOK = Path(__file__).with_name("laya_gate.py")


class FakeLaya(BaseHTTPRequestHandler):
    answer = {"choice": "safe", "confidence": 0.97}
    status = 200
    last_request = None

    def do_POST(self):
        FakeLaya.last_request = {
            "path": self.path,
            "authorization": self.headers.get("authorization"),
            "body": json.loads(self.rfile.read(int(self.headers["content-length"]))),
        }
        body = json.dumps({"answers": {"risk": FakeLaya.answer}, "usage": {"input_tokens": 1, "output_tokens": 0}}).encode()
        self.send_response(FakeLaya.status)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class LayaGateTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), FakeLaya)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}/v1/systemone"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def run_hook(self, event, answer=None, **env):
        FakeLaya.answer = answer or {"choice": "safe", "confidence": 0.97}
        FakeLaya.status = 200
        environment = {k: v for k, v in os.environ.items() if not k.startswith("LAYA_") and "proxy" not in k.lower()}
        # A proxy that goes nowhere, and no NO_PROXY: the hook has to reach a
        # Laya on this machine anyway, which is the situation on a laptop
        # behind a VPN.
        environment["HTTP_PROXY"] = environment["http_proxy"] = "http://127.0.0.1:9"
        environment.update({"LAYA_URL": self.url, **env})
        result = subprocess.run(
            [sys.executable, str(HOOK)], input=json.dumps(event), capture_output=True,
            text=True, env=environment, timeout=20,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)["hookSpecificOutput"] if result.stdout.strip() else None

    bash = {"tool_name": "Bash", "tool_input": {"command": "npm test"}, "cwd": "/repo"}

    def test_confident_safe_stays_out_of_the_way(self):
        self.assertIsNone(self.run_hook(self.bash))

    def test_confident_safe_can_allow_outright_when_asked_to(self):
        decision = self.run_hook(self.bash, LAYA_GATE_ALLOW_SAFE="1")
        self.assertEqual(decision["permissionDecision"], "allow")

    def test_risky_asks_you(self):
        push = {"tool_name": "Bash", "tool_input": {"command": "git push origin main"}}
        decision = self.run_hook(push, {"choice": "risky", "confidence": 0.93})
        self.assertEqual(decision["hookEventName"], "PreToolUse")
        self.assertEqual(decision["permissionDecision"], "ask")
        self.assertIn("risky", decision["permissionDecisionReason"])

    def test_destructive_is_denied_with_a_reason(self):
        wipe = {"tool_name": "Bash", "tool_input": {"command": "rm -rf /"}}
        decision = self.run_hook(wipe, {"choice": "destructive", "confidence": 0.99})
        self.assertEqual(decision["permissionDecision"], "deny")
        self.assertIn("99%", decision["permissionDecisionReason"])

    def test_an_unsure_answer_goes_to_you_whatever_it_says(self):
        wipe = {"tool_name": "Bash", "tool_input": {"command": "rm -rf build"}}
        decision = self.run_hook(wipe, {"choice": "destructive", "confidence": 0.6})
        self.assertEqual(decision["permissionDecision"], "ask")
        decision = self.run_hook(self.bash, {"choice": "safe", "confidence": 0.6})
        self.assertEqual(decision["permissionDecision"], "ask")

    def test_an_unreachable_laya_asks_rather_than_vanishing(self):
        decision = self.run_hook(self.bash, LAYA_URL="http://127.0.0.1:9/v1/systemone", LAYA_GATE_TIMEOUT="1")
        self.assertEqual(decision["permissionDecision"], "ask")
        self.assertIn("could not be asked", decision["permissionDecisionReason"])

    def test_an_unreachable_laya_can_be_made_to_block(self):
        decision = self.run_hook(self.bash, LAYA_URL="http://127.0.0.1:9/v1/systemone",
                                 LAYA_GATE_TIMEOUT="1", LAYA_GATE_ON_ERROR="deny")
        self.assertEqual(decision["permissionDecision"], "deny")

    def test_an_answer_outside_the_question_is_not_trusted(self):
        decision = self.run_hook(self.bash, {"choice": "sure-why-not", "confidence": 0.99})
        self.assertEqual(decision["permissionDecision"], "ask")

    def test_the_request_is_jev_shaped_and_carries_the_key(self):
        big = {"tool_name": "Write", "tool_input": {"file_path": "a.txt", "content": "x" * 50_000}}
        self.run_hook(big, LAYA_API_KEY="k-123")
        sent = FakeLaya.last_request
        self.assertEqual(sent["path"], "/v1/systemone")
        self.assertEqual(sent["authorization"], "Bearer k-123")
        self.assertEqual(sent["body"]["questions"]["risk"]["type"], "choice")
        self.assertEqual(set(sent["body"]["questions"]["risk"]["criteria"]), {"safe", "risky", "destructive"})
        self.assertEqual(sent["body"]["state"]["tool"], "Write")
        # A whole file is not what the decision turns on, and it is slow to send.
        self.assertLess(len(sent["body"]["state"]["content"]), 2000)

    def test_something_that_is_not_a_hook_payload_is_left_alone(self):
        result = subprocess.run([sys.executable, str(HOOK)], input="not json", capture_output=True, text=True, timeout=20)
        self.assertEqual((result.returncode, result.stdout), (0, ""))


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""
A Claude Code PreToolUse hook that asks Laya before Claude acts.

Claude Code pipes each tool call to this script as JSON on stdin. The script
sends a short description of the call to a Laya server (`laya-serve`, which
speaks Jev's `POST /v1/systemone`), asks one typed question — how risky is
this? — and turns the answer into Claude Code's own permission decision:

    destructive, confident  ->  deny   (Claude is stopped and told why)
    risky, or unsure        ->  ask    (you are prompted to approve)
    safe, confident         ->  nothing (Claude Code's normal rules apply)

A safe answer does not *allow* anything on its own: that would let the model
bypass the permission rules you already have. Set LAYA_GATE_ALLOW_SAFE=1 if
you want confident-safe calls to skip the prompt.

If Laya cannot be reached or answers something unreadable, the call goes to
you (`ask`) rather than through silently or blocking everything — a gate that
disappears when its server is down is not a gate. LAYA_GATE_ON_ERROR changes
that to `deny` or `pass`.

Standard library only, so it runs with whatever python3 is on the machine and
needs nothing installed beside Laya itself.

Environment:
    LAYA_URL              default http://127.0.0.1:8000/v1/systemone
    LAYA_API_KEY          sent as a Bearer token when set (laya-serve's own)
    LAYA_GATE_THRESHOLD   confidence needed to act on an answer, default 0.85
    LAYA_GATE_ALLOW_SAFE  1 to allow confident-safe calls outright
    LAYA_GATE_ON_ERROR    ask (default) | deny | pass
    LAYA_GATE_TIMEOUT     seconds to wait for Laya, default 5
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_URL = "http://127.0.0.1:8000/v1/systemone"
LOOPBACK = {"127.0.0.1", "localhost", "::1"}
# Long file contents and diffs add latency and dilute the one thing that
# matters, which is what the call does; the head of it is enough to judge.
MAX_FIELD_CHARS = 1500

RISK_QUESTION = {
    "type": "choice",
    "instructions": (
        "An AI coding agent is about to run this tool call on a developer's "
        "machine. How risky is it?"
    ),
    "criteria": {
        "safe": (
            "Reads or inspects only, or changes local files in the project in "
            "an ordinary, reversible way: reading files, searching, listing, "
            "running tests, linting, building, git status/diff/log, editing "
            "source code."
        ),
        "risky": (
            "Leaves the machine or is hard to undo: git push, merging or "
            "closing a pull request, deploying, publishing a package, sending "
            "messages, changing CI, secrets, credentials or production data, "
            "installing software, network requests that change remote state."
        ),
        "destructive": (
            "Deletes or overwrites work or history, or weakens security: "
            "rm -rf, force-push, git reset --hard, dropping databases or "
            "tables, deleting branches or repositories, disabling TLS "
            "verification, exposing or printing secrets."
        ),
    },
}


def clip(value):
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return text if len(text) <= MAX_FIELD_CHARS else text[:MAX_FIELD_CHARS] + " …[truncated]"


def describe(event):
    """The state Laya judges: the tool and its input, each field clipped."""
    tool_input = event.get("tool_input") or {}
    fields = {key: clip(value) for key, value in tool_input.items()} if isinstance(tool_input, dict) else {"input": clip(tool_input)}
    return {"tool": event.get("tool_name", ""), "cwd": event.get("cwd", ""), **fields}


def ask_laya(state):
    url = os.environ.get("LAYA_URL", DEFAULT_URL)
    body = json.dumps({"state": state, "questions": {"risk": RISK_QUESTION}}).encode()
    headers = {"content-type": "application/json"}
    if os.environ.get("LAYA_API_KEY"):
        headers["authorization"] = f"Bearer {os.environ['LAYA_API_KEY']}"
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    timeout = float(os.environ.get("LAYA_GATE_TIMEOUT", "5"))
    # Python sends even localhost through HTTP(S)_PROXY unless NO_PROXY says
    # otherwise, and a machine behind a VPN or corporate proxy usually has one
    # set — so a Laya running on this machine would be asked via the proxy and
    # never answer. Loopback never goes through a proxy.
    opener = (
        urllib.request.build_opener(urllib.request.ProxyHandler({}))
        if urllib.parse.urlsplit(url).hostname in LOOPBACK
        else urllib.request.build_opener()
    )
    with opener.open(request, timeout=timeout) as response:
        return json.load(response)


def read_answer(payload):
    """(choice, confidence) from Laya's answer, or raise if it is not there."""
    answer = payload["answers"]["risk"]
    choice = answer["choice"]
    confidence = float(answer.get("confidence", 0.0))
    if choice not in RISK_QUESTION["criteria"]:
        raise ValueError(f"unexpected choice {choice!r}")
    return choice, confidence


def decide(choice, confidence, threshold, allow_safe):
    """Map Laya's answer to a permission decision, or None to stay out of it."""
    percent = f"{confidence:.0%}"
    if confidence < threshold:
        return "ask", f"Laya is unsure ({choice}, {percent} confidence); asking you."
    if choice == "destructive":
        return "deny", f"Laya judged this destructive ({percent} confidence)."
    if choice == "risky":
        return "ask", f"Laya judged this risky ({percent} confidence); asking you."
    if allow_safe:
        return "allow", f"Laya judged this safe ({percent} confidence)."
    return None


def output(decision, reason):
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,
            "permissionDecisionReason": reason,
        }
    }


def main():
    try:
        event = json.load(sys.stdin)
    except json.JSONDecodeError:
        # Not a hook payload; nothing to judge, and nothing to break.
        return 0

    threshold = float(os.environ.get("LAYA_GATE_THRESHOLD", "0.85"))
    allow_safe = os.environ.get("LAYA_GATE_ALLOW_SAFE") == "1"
    on_error = os.environ.get("LAYA_GATE_ON_ERROR", "ask")

    try:
        choice, confidence = read_answer(ask_laya(describe(event)))
    except (urllib.error.URLError, TimeoutError, OSError, KeyError, TypeError, ValueError) as error:
        if on_error == "pass":
            return 0
        decision = "deny" if on_error == "deny" else "ask"
        print(json.dumps(output(decision, f"Laya could not be asked ({error}); {'blocked' if decision == 'deny' else 'asking you'}.")))
        return 0

    result = decide(choice, confidence, threshold, allow_safe)
    if result:
        print(json.dumps(output(*result)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
Adds the Laya gate to a Claude Code settings file without disturbing anything
else in it.

    python3 merge_settings.py <settings.json> <python> <laya_gate.py>

A broken settings file silently switches off every setting in it, so this is
careful in the ways a hand edit is not:

- an existing file that is not valid JSON is left untouched, and the script
  stops and says so, rather than being overwritten with a fresh one;
- the original is copied to settings.json.bak-<time> before anything is
  written, and the new file is written beside it and moved into place, so an
  interrupted run cannot leave half a file;
- every other key, and every other hook — PreToolUse ones included — stays as
  it was;
- running it twice updates the one Laya entry rather than adding a second.
"""
import json
import os
import shutil
import sys
import time

MATCHER = "Bash|Write|Edit|NotebookEdit|mcp__github__.*"
MARKER = "laya_gate.py"


def gate_entry(python, hook):
    # Forward slashes and quotes, so the same command works in bash, Git Bash
    # and PowerShell, and in a home directory with a space in it.
    command = f'"{python.replace(os.sep, "/")}" "{hook.replace(os.sep, "/")}"'
    return {
        "matcher": MATCHER,
        "hooks": [{"type": "command", "command": command, "timeout": 10, "statusMessage": "Laya 正在判断…"}],
    }


def is_gate(entry):
    return any(MARKER in str(hook.get("command", "")) for hook in entry.get("hooks", []) if isinstance(hook, dict))


def merge(settings, entry):
    """The settings with the Laya entry in place, and whether it was new."""
    hooks = settings.setdefault("hooks", {})
    if not isinstance(hooks, dict):
        raise ValueError('"hooks" in the settings file is not an object')
    pre = hooks.setdefault("PreToolUse", [])
    if not isinstance(pre, list):
        raise ValueError('"hooks.PreToolUse" in the settings file is not a list')
    for index, existing in enumerate(pre):
        if isinstance(existing, dict) and is_gate(existing):
            pre[index] = entry
            return settings, False
    pre.append(entry)
    return settings, True


def main(path, python, hook):
    settings = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
        if text.strip():
            try:
                settings = json.loads(text)
            except json.JSONDecodeError as error:
                print(f"✗ {path} 不是有效的 JSON（{error}），没有改动它。修好后再运行一次安装。")
                return 1
        if not isinstance(settings, dict):
            print(f"✗ {path} 的最外层不是一个对象，没有改动它。")
            return 1
        backup = f"{path}.bak-{time.strftime('%Y%m%d-%H%M%S')}"
        shutil.copy2(path, backup)
        print(f"  已备份原设置到 {backup}")

    try:
        settings, added = merge(settings, gate_entry(python, hook))
    except ValueError as error:
        print(f"✗ {error}，没有改动它。")
        return 1

    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    temporary = f"{path}.tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(settings, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    os.replace(temporary, path)
    print(f"  {'已添加' if added else '已更新'} Laya 钩子：{path}")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(*sys.argv[1:]))

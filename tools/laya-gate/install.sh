#!/usr/bin/env bash
# One-command install of Laya and the Claude Code gate, for macOS and Linux.
#
#   bash tools/laya-gate/install.sh
#   # or, without a checkout of this repository:
#   curl -fsSL https://raw.githubusercontent.com/717986230/zhaoyun-restaurant-ordering/main/tools/laya-gate/install.sh | bash
#
# What it does, and nothing else:
#   1. a virtual environment for Laya in ~/.laya (never your system Python);
#   2. PyTorch — the CPU build when there is no NVIDIA GPU, which is a few
#      hundred MB instead of several GB — and then laya[serve];
#   3. the gate script into ~/.claude/hooks/;
#   4. the hook into ~/.claude/settings.json, merged, with a backup first;
#   5. ~/.laya/start.sh, which runs laya-serve on 127.0.0.1 only.
#
# Settings: LAYA_HOME (default ~/.laya), LAYA_PORT (default 8000),
# LAYA_GATE_REF (the git ref to download from when run without a checkout).
# pip honours PIP_INDEX_URL for a nearer mirror.
set -euo pipefail

LAYA_HOME="${LAYA_HOME:-$HOME/.laya}"
LAYA_PORT="${LAYA_PORT:-8000}"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
REF="${LAYA_GATE_REF:-main}"
RAW="https://raw.githubusercontent.com/717986230/zhaoyun-restaurant-ordering/${REF}/tools/laya-gate"

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\n✗ %s\n' "$*" >&2; exit 1; }

# --- 1. A Python that Laya supports -----------------------------------------
say "查找 Python 3.10 及以上版本"
PYTHON=""
for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$candidate" >/dev/null 2>&1 &&
     "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
    PYTHON="$(command -v "$candidate")"; break
  fi
done
[ -n "$PYTHON" ] || die "需要 Python 3.10 或更新版本。macOS: brew install python@3.12 ；Ubuntu: sudo apt install python3 python3-venv"
echo "    $PYTHON ($("$PYTHON" --version 2>&1))"

say "创建虚拟环境 $LAYA_HOME/venv"
mkdir -p "$LAYA_HOME"
if [ ! -x "$LAYA_HOME/venv/bin/python" ]; then
  "$PYTHON" -m venv "$LAYA_HOME/venv" ||
    die "创建虚拟环境失败。Ubuntu/Debian 上先运行: sudo apt install python3-venv"
fi
VENV_PY="$LAYA_HOME/venv/bin/python"

# --- 2. PyTorch and Laya ------------------------------------------------------
if [ "${LAYA_SKIP_PIP:-}" = "1" ]; then
  say "跳过 pip 安装（LAYA_SKIP_PIP=1）"
else
  say "安装 PyTorch 和 Laya（第一次需要几分钟）"
  "$VENV_PY" -m pip install --upgrade pip --quiet
  if [ "$(uname -s)" = "Linux" ] && ! command -v nvidia-smi >/dev/null 2>&1; then
    # PyPI's default Linux wheel carries the CUDA libraries, several GB that a
    # machine without an NVIDIA GPU never uses.
    echo "    没有检测到 NVIDIA 显卡，安装 CPU 版 PyTorch"
    "$VENV_PY" -m pip install torch --index-url https://download.pytorch.org/whl/cpu
  fi
  "$VENV_PY" -m pip install "laya[serve]"
fi
"$VENV_PY" -I -c 'import laya; print("    laya", laya.__version__)' ||
  die "Laya 没装成功，看上面 pip 的报错。"

# --- 3. The gate script ---------------------------------------------------------
say "安装 Claude Code 钩子"
HERE=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "$(dirname "${BASH_SOURCE[0]}")/laya_gate.py" ]; then
  HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
mkdir -p "$CLAUDE_DIR/hooks"
fetch() {
  if [ -n "$HERE" ]; then cp "$HERE/$1" "$2"
  else curl -fsSL "$RAW/$1" -o "$2" || die "下载 $1 失败（$RAW/$1）"
  fi
}
fetch laya_gate.py "$CLAUDE_DIR/hooks/laya_gate.py"
fetch merge_settings.py "$LAYA_HOME/merge_settings.py"
echo "    $CLAUDE_DIR/hooks/laya_gate.py"

# --- 4. The hook in settings.json ---------------------------------------------
"$VENV_PY" "$LAYA_HOME/merge_settings.py" "$CLAUDE_DIR/settings.json" "$VENV_PY" "$CLAUDE_DIR/hooks/laya_gate.py" ||
  die "没能写入 $CLAUDE_DIR/settings.json，见上面的原因。"

# --- 5. A start script ------------------------------------------------------------
cat > "$LAYA_HOME/start.sh" <<EOF
#!/usr/bin/env bash
# Starts Laya for the Claude Code gate. 127.0.0.1 only: nothing else on the
# network can use it. The first start downloads the model from HuggingFace;
# if that is blocked where you are, set HF_ENDPOINT=https://hf-mirror.com.
export LAYA_HOST="\${LAYA_HOST:-127.0.0.1}"
export LAYA_PORT="\${LAYA_PORT:-$LAYA_PORT}"
exec "$LAYA_HOME/venv/bin/laya-serve"
EOF
chmod +x "$LAYA_HOME/start.sh"

say "装好了"
cat <<EOF

  启动 Laya（保持这个终端开着）:
      $LAYA_HOME/start.sh

  第一次启动会下载模型。国内下载不了就用镜像:
      HF_ENDPOINT=https://hf-mirror.com $LAYA_HOME/start.sh

  然后在 Claude Code 里输入 /hooks 打开一次（或重启 Claude Code），钩子就生效了。

  Laya 没开着的时候，Claude 的每一步都会先问你，而不是直接放行。
  暂时不想用：在 /hooks 里关掉，或者删掉 $CLAUDE_DIR/settings.json 里 laya_gate.py 那一条。
EOF

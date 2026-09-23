# One-command install of Laya and the Claude Code gate, for Windows.
#
#   powershell -ExecutionPolicy Bypass -File tools\laya-gate\install.ps1
#   # or, without a checkout of this repository:
#   irm https://raw.githubusercontent.com/717986230/zhaoyun-restaurant-ordering/main/tools/laya-gate/install.ps1 | iex
#
# The same five steps as install.sh: a virtual environment in ~\.laya, PyTorch
# (CPU build without an NVIDIA GPU) and laya[serve], the gate script into
# ~\.claude\hooks, the hook merged into ~\.claude\settings.json with a backup,
# and ~\.laya\start.ps1 that runs laya-serve on 127.0.0.1 only.
$ErrorActionPreference = "Stop"

$LayaHome  = if ($env:LAYA_HOME) { $env:LAYA_HOME } else { Join-Path $HOME ".laya" }
$LayaPort  = if ($env:LAYA_PORT) { $env:LAYA_PORT } else { "8000" }
$ClaudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME ".claude" }
$Ref       = if ($env:LAYA_GATE_REF) { $env:LAYA_GATE_REF } else { "main" }
$Raw       = "https://raw.githubusercontent.com/717986230/zhaoyun-restaurant-ordering/$Ref/tools/laya-gate"

function Say($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
# `throw`, not `exit`: under `irm ... | iex` the script runs inside your own
# PowerShell session, and `exit` would close the window along with the error.
function Die($text) { throw "✗ $text" }

# --- 1. A Python that Laya supports -------------------------------------------
Say "查找 Python 3.10 及以上版本"
$Python = $null
foreach ($candidate in @(@("py", "-3.12"), @("py", "-3.11"), @("py", "-3.10"), @("py", "-3"), @("python"))) {
  $exe = $candidate[0]; $pyArgs = @($candidate | Select-Object -Skip 1)
  if (Get-Command $exe -ErrorAction SilentlyContinue) {
    & $exe @pyArgs -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" 2>$null
    if ($LASTEXITCODE -eq 0) { $Python = $candidate; break }
  }
}
if (-not $Python) { Die "需要 Python 3.10 或更新版本：https://www.python.org/downloads/ （安装时勾选 Add python.exe to PATH）" }

Say "创建虚拟环境 $LayaHome\venv"
New-Item -ItemType Directory -Force -Path $LayaHome | Out-Null
$VenvPy = Join-Path $LayaHome "venv\Scripts\python.exe"
if (-not (Test-Path $VenvPy)) {
  $exe = $Python[0]; $pyArgs = @($Python | Select-Object -Skip 1)
  & $exe @pyArgs -m venv (Join-Path $LayaHome "venv")
  if ($LASTEXITCODE -ne 0) { Die "创建虚拟环境失败。" }
}

# --- 2. PyTorch and Laya --------------------------------------------------------
if ($env:LAYA_SKIP_PIP -eq "1") {
  Say "跳过 pip 安装（LAYA_SKIP_PIP=1）"
} else {
  Say "安装 PyTorch 和 Laya（第一次需要几分钟）"
  & $VenvPy -m pip install --upgrade pip --quiet
  if (-not (Get-Command nvidia-smi -ErrorAction SilentlyContinue)) {
    Write-Host "    没有检测到 NVIDIA 显卡，安装 CPU 版 PyTorch"
    & $VenvPy -m pip install torch --index-url https://download.pytorch.org/whl/cpu
  }
  & $VenvPy -m pip install "laya[serve]"
  if ($LASTEXITCODE -ne 0) { Die "pip 安装失败，看上面的报错。" }
}
& $VenvPy -I -c "import laya; print('    laya', laya.__version__)"
if ($LASTEXITCODE -ne 0) { Die "Laya 没装成功。" }

# --- 3. The gate script -----------------------------------------------------------
Say "安装 Claude Code 钩子"
$Hooks = Join-Path $ClaudeDir "hooks"
New-Item -ItemType Directory -Force -Path $Hooks | Out-Null
$Here = if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot "laya_gate.py"))) { $PSScriptRoot } else { $null }
function Fetch($name, $target) {
  if ($Here) { Copy-Item (Join-Path $Here $name) $target -Force }
  else { Invoke-WebRequest -UseBasicParsing "$Raw/$name" -OutFile $target }
}
$Gate = Join-Path $Hooks "laya_gate.py"
Fetch "laya_gate.py" $Gate
Fetch "merge_settings.py" (Join-Path $LayaHome "merge_settings.py")

# --- 4. The hook in settings.json -----------------------------------------------
& $VenvPy (Join-Path $LayaHome "merge_settings.py") (Join-Path $ClaudeDir "settings.json") $VenvPy $Gate
if ($LASTEXITCODE -ne 0) { Die "没能写入 settings.json，见上面的原因。" }

# --- 5. A start script ----------------------------------------------------------------
$Serve = Join-Path $LayaHome "venv\Scripts\laya-serve.exe"
@"
# Starts Laya for the Claude Code gate, on 127.0.0.1 only. The first start
# downloads the model; if HuggingFace is blocked, set
#   `$env:HF_ENDPOINT = "https://hf-mirror.com"
# before running this.
if (-not `$env:LAYA_HOST) { `$env:LAYA_HOST = "127.0.0.1" }
if (-not `$env:LAYA_PORT) { `$env:LAYA_PORT = "$LayaPort" }
& "$Serve"
"@ | Set-Content -Encoding UTF8 (Join-Path $LayaHome "start.ps1")

Say "装好了"
Write-Host @"

  启动 Laya（保持这个窗口开着）:
      powershell -ExecutionPolicy Bypass -File "$LayaHome\start.ps1"

  国内下载不了模型就先设镜像:
      `$env:HF_ENDPOINT = "https://hf-mirror.com"

  然后在 Claude Code 里输入 /hooks 打开一次（或重启 Claude Code），钩子就生效了。
  Laya 没开着的时候，Claude 的每一步都会先问你，而不是直接放行。
"@

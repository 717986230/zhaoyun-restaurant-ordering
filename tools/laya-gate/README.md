# Laya 决策门

让 [Laya](https://pypi.org/project/laya/) 在 Claude Code 每次执行命令、改文件或操作 GitHub 之前先判断一次。

| Laya 的判断 | 结果 |
|---|---|
| 危险（删东西、强推、关 TLS 等），且把握大 | **拒绝**，Claude 会收到拒绝理由 |
| 有风险（push、合并、部署、改密钥等） | **问你**，由你批准 |
| 安全，且把握大 | 不插手，照 Claude Code 原来的权限规则走 |
| 把握不大（低于 85%） | **问你** |
| Laya 连不上 | **问你**，门不会因为服务挂了就悄悄失效 |

"安全"默认不会直接放行，否则 Laya 判错一次就能绕过你原有的权限设置。想让安全操作免确认，就设 `LAYA_GATE_ALLOW_SAFE=1`。

## 装在你自己的电脑上

这个门要装在你**本机**的 Claude Code 里才能拦住它。云端会话是临时的，而且连不上 HuggingFace，下载不了 Laya 的模型权重。

**一条命令安装**（在这个仓库的目录里运行）：

```bash
bash tools/laya-gate/install.sh                                      # macOS / Linux
```

```powershell
powershell -ExecutionPolicy Bypass -File tools\laya-gate\install.ps1   # Windows
```

安装脚本做五件事，别的都不碰：

1. 在 `~/.laya` 建一个独立的 Python 虚拟环境，不动系统里的 Python；
2. 装 PyTorch 和 `laya[serve]`。没有 NVIDIA 显卡时装 CPU 版 PyTorch，几百 MB，不是几 GB；
3. 把 `laya_gate.py` 放进 `~/.claude/hooks/`；
4. 把钩子**合并**进 `~/.claude/settings.json`，先备份。你原有的设置和钩子都保留；重复运行只会更新，不会多加一条；原文件不是有效的 JSON 时，一个字都不改，直接停下来告诉你；
5. 生成 `~/.laya/start.sh`（Windows 上是 `start.ps1`），让 Laya 只监听 `127.0.0.1`，局域网里的其他设备连不上它。

装完以后：

```bash
~/.laya/start.sh                                    # 启动 Laya，保持终端开着
HF_ENDPOINT=https://hf-mirror.com ~/.laya/start.sh  # 国内下载不了模型时用镜像
```

然后在 Claude Code 里打开一次 `/hooks`（或者重启），钩子就生效了。pip 下载慢可以设 `PIP_INDEX_URL` 换国内源。

**试一下**

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"git push --force origin main"}}' \
  | ~/.laya/venv/bin/python ~/.claude/hooks/laya_gate.py
```

应该输出一段 JSON，里面的 `permissionDecision` 是 `deny` 或 `ask`。

## 设置项（环境变量）

| 变量 | 默认值 | 作用 |
|---|---|---|
| `LAYA_URL` | `http://127.0.0.1:8000/v1/systemone` | Laya 服务地址 |
| `LAYA_API_KEY` | 无 | 如果 `laya-serve` 设了 `LAYA_API_KEY`，这里填同一个 |
| `LAYA_GATE_THRESHOLD` | `0.85` | 把握达到多少才按 Laya 的判断执行 |
| `LAYA_GATE_ALLOW_SAFE` | 关 | 设为 `1`：判为安全的操作直接放行 |
| `LAYA_GATE_ON_ERROR` | `ask` | 连不上 Laya 时：`ask` 问你 / `deny` 全部拒绝 / `pass` 不拦 |
| `LAYA_GATE_TIMEOUT` | `5` | 等 Laya 的秒数 |

Laya 跑在本机时，钩子会绕过系统代理，开着 VPN 也连得上本机的 Laya。

## 测试

```bash
python3 -m unittest tools/laya-gate/test_laya_gate.py tools/laya-gate/test_merge_settings.py
```

测试用一个假的 Laya 服务，不用下载模型。检查两件事：Laya 的回答是怎样被换成"拒绝 / 问你 / 放行"的；安装脚本改 `settings.json` 时不会弄坏原有设置。

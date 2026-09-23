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

**1. 启动 Laya**（第一次会从 HuggingFace 下载模型）

```bash
python3 -m venv ~/laya-venv
~/laya-venv/bin/python -m pip install "laya[serve]"
~/laya-venv/bin/laya-serve            # 监听 0.0.0.0:8000
```

没有 NVIDIA 显卡也能跑，走 CPU。启动时加 `LAYA_DEVICE=cpu`。

**2. 放好钩子脚本**

```bash
mkdir -p ~/.claude/hooks
cp tools/laya-gate/laya_gate.py ~/.claude/hooks/
```

脚本只用 Python 标准库，任何 `python3` 都能跑，不需要装进 Laya 的虚拟环境。

**3. 打开钩子**

把 `settings.example.json` 里的 `hooks` 部分合并进 `~/.claude/settings.json`（对所有项目生效），或者合并进某个项目的 `.claude/settings.local.json`（只对这个项目生效）。如果文件里已经有 `hooks`，是**合并**，不是覆盖。

然后在 Claude Code 里打开一次 `/hooks`（或者重启），配置才会生效。

**4. 试一下**

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"git push --force origin main"}}' \
  | python3 ~/.claude/hooks/laya_gate.py
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
python3 -m unittest tools/laya-gate/test_laya_gate.py
```

测试用一个假的 Laya 服务，不用下载模型，只检查 Laya 的回答是怎样被换成"拒绝 / 问你 / 放行"的。

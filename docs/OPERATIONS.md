# 运维手册：上线、监控、备份、恢复、出事怎么办

这份手册写给负责系统运行的人，不需要会写代码，照着做即可。线上系统运行在 Cloudflare 上：
- Worker 负责网页和接口。
- D1 是数据库。

店里如果自己跑 Node 服务器，也看这份手册，其中「Node 服务器」一节是写给这种情况的。

## 1. 一次上线是怎么走的

改动合并进 `main` 后，GitHub Actions 自动按下面的顺序执行，不需要手动操作：

1. **检查**：类型检查、单元测试、服务器测试、D1 上的接口契约测试、依赖安全检查，以及三组浏览器测试（手机、平板、iPhone）。
   任何一项不过，都不会上线。
2. **数据库迁移**：`wrangler d1 migrations apply`。迁移只加表、加列，不删不改，所以旧版本的 Worker 在新表结构上照样能跑。
3. **部署 Worker**：同时把这次的 commit 写进 Worker（`VERSION`）。
4. **上线自检**：
   - 访问线上的 `/api/health`，确认回答的是这次的版本，并且连得上数据库。
   - 确认管理台页面带着安全头（CSP）。
   - 确认菜单能读出来。
5. **自动回滚**：自检不过，就用 `wrangler rollback` 退回上一个版本，并把这次运行标红。

**需要设置的东西**（GitHub 仓库 → Settings → Secrets and variables → Actions）：

| 名称 | 类型 | 用途 |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Secret | 部署、迁移、备份。权限见 `docs/D1.md` |
| `BACKUP_PASSPHRASE` | Secret | 夜间备份的加密密码。**另外抄一份存在保险的地方**，丢了就解不开备份 |
| `API_BASE_URL` | Variable | Worker 的地址，例如 `https://ck.xxx.workers.dev`。上线自检和 GitHub Pages 菜单都用它 |

Worker 自己的密钥用 `npx wrangler secret put ADMIN_TOKEN` 设置，至少 32 个字符；`STAFF_TOKEN` 和 `KITCHEN_TOKEN` 同理。

## 2. 监控

- **健康检查**：`GET /api/health`。
  - 正常时返回 `{"ok":true,"database":"ok","version":"<commit>"}`。
  - 连不上数据库时返回 HTTP 503。
  - 建议用外部监控服务每 1–5 分钟访问一次，失败就发短信或邮件，例如 Cloudflare Health Checks、UptimeRobot、Better Stack。
- **请求编号**：
  - 每个接口回答都带 `x-request-id`，服务器出错时回答里也有 `requestId`。
  - 店员报告「保存失败」时，请他截图或记下这个编号。
- **日志**：
  - Cloudflare 控制台 → Workers → ck → Logs（`wrangler.toml` 里已经打开 `observability`）。
  - 用请求编号一搜就能找到那次出错。服务器出错会写一行 JSON，包含 `level`、`requestId`、`method`、`path`、`error`。
- **前端错误**：顾客手机、平板、管理台上的页面出错时，也会写进 Workers Logs，搜 `"client error"` 就能找到。
  每条记录包括哪个应用（menu、pos、admin）、错误信息、出错位置和页面路径。
- **打印**：管理台 → 打印，会显示每台打印机和打印桥是否在线；没打出来的单子也会显示在每台 POS 的桌台页顶部（见 `docs/PRINTING.md`）。

## 3. 备份

系统有三层备份，互相独立：

1. **D1 Time Travel（Cloudflare 自带）**：可以把数据库恢复到过去任意一分钟。免费版保留 7 天，付费版保留 30 天。
2. **夜间加密备份**（`.github/workflows/backup.yml`）：
   - 每天 02:17（UTC）导出整个数据库。
   - 先装进一个空数据库检查一遍：完整性检查通过、主要的表都在、有菜品。
   - 然后压缩并用 `BACKUP_PASSPHRASE` 加密（AES-256），作为 GitHub Actions 产物保存 90 天。
   - 不在 Cloudflare 上，所以 Cloudflare 账户出问题时也还在。
   - 想立刻备份一次：Actions → D1 backup → Run workflow。
3. **法定保存（奥地利 BAO，7 年）**：
   - 每个月由店长在 POS →「记录与结算」→「交易日志（DEP 131）」按日期导出 JSON 和 CSV，存到公司自己的存储（NAS、云盘）。
   - 上面两层都不够 7 年，这一步不能省。

**Node 服务器**：用 `npm run backup` 做备份，它会做一致性快照并检查完整性。建议用 cron 每晚跑一次，例如：
`17 2 * * * cd /opt/zhaoyun && BACKUP_DIR=/var/backups/zhaoyun npm run backup`

## 4. 恢复

**误删、改错数据（最近 7 天内）**：用 Time Travel。

```sh
# 先查某个时间点对应的书签
npx wrangler d1 time-travel info zhaoyun-ordering --timestamp=2026-09-28T09:00:00+02:00
# 恢复到那个时间点。恢复前的状态也会给出一个书签，恢复错了还能退回去
npx wrangler d1 time-travel restore zhaoyun-ordering --timestamp=2026-09-28T09:00:00+02:00
```

**超过 Time Travel 的时限，或整个库坏了**：用夜间备份。

1. **下载备份**：Actions → D1 backup → 选一次运行 → 下载 `zhaoyun-d1-….sql.gz.enc`。
2. **解密并检查**：

   ```sh
   export BACKUP_PASSPHRASE='…'
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE \
     -in zhaoyun-d1-XXXX.sql.gz.enc | gunzip > backup.sql
   node --no-warnings scripts/verify-d1-export.mjs backup.sql
   ```

3. **导入一个新数据库**。先不要覆盖旧库，旧库留着核对：

   ```sh
   npx wrangler d1 create zhaoyun-restore
   npx wrangler d1 execute zhaoyun-restore --remote --file=backup.sql
   ```

4. **切换数据库**：把 `wrangler.toml` 里的 `database_name` 和 `database_id` 改成新库的，合并进 `main`，由 CI 部署。

## 5. 回滚

- **自动回滚**：上线自检不过时，CI 自动回滚，不需要操作。
- **手动回滚**：上线后才发现问题时：
  - 运行 `npx wrangler rollback --message "原因"`，退回上一个版本。
  - 也可以在 Cloudflare 控制台 → Workers → ck → Deployments 里选一个版本。
- **数据库不跟着回滚**：因为迁移只加不删，旧版本可以直接跑在新表结构上。
- **修好后重新上线**：在 `main` 上修复（或 revert 那次合并），CI 会重新部署。

## 6. 换密钥和令牌

| 情况 | 做法 |
| --- | --- |
| 有人离职，或管理台密码可能泄露 | 管理台 → 设置 →「账户」→ 改密码。改完后所有已登录的设备都要重新登录 |
| 跑堂离职 | 管理台 → 设置 →「跑堂与 POS 设备」，停用这个人 |
| POS 平板丢了 | 管理台 → 设置 →「跑堂与 POS 设备」，取消这台设备的配对 |
| 打印桥电脑丢了或换了 | 同上，取消打印桥的配对，再在新电脑上重新连接 |
| 桌卡被人拍走、乱下单 | 管理台 → 设置 →「桌台与桌卡」→ 这桌的「更换令牌」，然后重新打印这张桌卡 |
| `ADMIN_TOKEN` 等 Worker 密钥 | `npx wrangler secret put ADMIN_TOKEN`，设置后立即生效 |
| `CLOUDFLARE_API_TOKEN` | 在 Cloudflare 控制台重新生成一个，替换 GitHub 里的 Secret，再删掉旧的 |

## 7. 出事了怎么办

| 现象 | 先看什么 | 怎么办 |
| --- | --- | --- |
| 所有设备都打不开 | 访问 `/api/health` 看返回什么；看 Cloudflare 状态页 | 返回 503 说明数据库有问题，看 D1 状态；如果是刚上线出的问题，就回滚（第 5 节） |
| 保存失败，提示里有请求编号 | 用编号在 Workers Logs 里搜 | 按日志里的错误处理；需要改代码的，修复后走正常上线 |
| 厨房没收到单 | POS 桌台页顶部的红色提醒，或管理台 → 打印 | 缺纸、开盖就处理好后点「重打」；打印桥离线就检查那台电脑 |
| 某张桌一直显示「🔒 某某 正在操作」 | 那个跑堂的设备是不是还开着这桌 | 让他退出这桌；设备关机了就等 90 秒自动解锁；店长也可以在 POS 上强制接管 |
| 网络断了 | — | 恢复后 POS 自动重连；打印队列会自动补打 |

## 8. 安全基线（已经做好的）

- **页面安全头**：所有页面带 CSP（只运行本站的脚本）、HSTS、`X-Frame-Options: DENY`、`Permissions-Policy`。
  - 三处用的是同一份：`shared/web-headers.mjs` 生成的 Worker 静态资源头、Node 服务器、浏览器测试用的预览服务器。
  - 页面有东西被 CSP 挡住时，浏览器测试就会失败。
- **接口回答**：接口返回的是数据，不是页面，禁止执行和嵌入。上传的图片放在沙盒里。
- **密码和 PIN**：用 PBKDF2 保存。账户登录、顾客登录、POS 的 PIN 都有错误次数限制：
  - 同一个地址 15 分钟内最多错 10 次。
  - 同一个账户、邮箱或跑堂，不管从哪里登录，15 分钟内最多错 20 次。
  - 这两个计数都存在数据库里，Cloudflare 上所有实例共用，不会因为请求落到不同实例而被绕过。
  - 每台服务器自己在内存里另有一道：同一地址 5 分钟内最多错 5 次。
  - 被锁住时稍等即可，回答里的 `retry-after` 会说明要等几秒；登录成功后计数清零。
- **顾客下单和呼叫**：按 IP 限流。
- **审计日志**：管理操作都有记录，只记业务字段，不保存请求原文。
- **依赖更新**：Dependabot 每周一提交依赖更新的 PR，每个 PR 都要过完整的 CI；CI 里 `npm audit` 也会拦下生产依赖里的已知漏洞。

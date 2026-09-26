# POS（点餐收银）

`pos.html` 是跑堂和前台用的点餐收银应用，按奥地利中餐馆常用的 Gastro-Kassa
（Orderman / ready2order / JK Kasse 一类）的流程做：配对设备 → 跑堂 PIN 登录 →
桌台 → 点单送厨 → 结账（一起结 / 分开结）→ 跑堂结算 → 日结。顾客菜单
（`index.html`）不受影响；管理台（`admin.html`）只管菜品、打印机和设置，包括跑堂和设备。

代码：`apps/pos-web`（界面），`shared/pos.mjs`（桌号锁、跑堂、结算、沽清），
`shared/register.mjs`（小票、冲销、退菜、日志、日结），`shared/rules.mjs`（税率、下单、账单），
`shared/account.mjs`（餐厅账户），`shared/live.mjs`（实时同步：什么变化推给谁）。
Node 服务器和 Cloudflare Worker 共用这些模块，`shared/contract-suite.mjs` 对两边跑同一套检查。

## 接口一览

| | |
|---|---|
| 账户 | `GET /api/account`（是否已注册）· `POST /api/account/register` · `POST /api/account/sign-in` · `PUT /api/account` · `POST /api/account/recover`（ADMIN_TOKEN）· `POST /api/account/sign-out` |
| 设备与跑堂 | `POST/GET/DELETE /api/admin/pos-devices` · `GET/POST/PUT /api/admin/staff` · `GET /api/admin/staff/activity` · `GET /api/pos/staff` · `POST /api/pos/sign-in` · `POST /api/pos/sign-out` |
| 桌台 | `GET /api/pos/floor` · `POST/DELETE /api/pos/tables/:table/claim` · `POST /api/pos/tables/:table/move` · `POST /api/pos/takeaway` |
| 点单 | `GET /api/pos/catalog` · `POST /api/pos/orders` · `POST /api/pos/tables/:table/void` · `PUT /api/pos/products/:id/availability` |
| 结账 | `GET /api/admin/tables/:table/bill` · `POST /api/admin/tables/:table/bill/print` · `POST /api/admin/checkout` · `GET /api/admin/receipts` · `POST /api/admin/receipts/:id/print` · `POST /api/admin/receipts/:id/storno` |
| 结算与日志 | `GET/POST /api/pos/settlement` · `GET /api/pos/settlements` · `GET/POST /api/admin/day-closings` · `GET /api/admin/journal` |
| 实时 | `GET /ws?role=staff`（管理台、POS）· `GET /ws`（顾客菜单）：`{ type: "connected" \| "floor.changed" \| "catalog.changed", table?, at }` |

## 开始使用

1. 管理台第一次打开时注册餐厅账户（账户名 + 密码）。以前设过的管理密码已经变成账户 `admin`，密码不变。
2. 管理台 → 设置 → 「跑堂与 POS 设备」：添加跑堂，每人一个 4–6 位 PIN；经理角色可以冲销、日结、强制接管桌台。
3. 平板 / 手机打开 `pos.html`，输入设备名称、账户名和密码配对（每台设备一次）。丢失的设备在管理台取消配对。
4. 跑堂点自己的名字、输入 PIN。登录 14 小时有效；停用的跑堂立即登出。
5. 设置 → 公司：填公司名称、地址、UID（ATU + 8 位）、收银机编号，以及外带折扣（0–50%）。
6. 打印机：后厨打印机语言选中文、编码 GB18030；前台打印机选 Deutsch。

## 功能

| | |
|---|---|
| 点单 | 菜号（SKU）+ 回车快速点单，也可按分类 / 搜索点；带选项的菜弹出选项；整单备注 |
| 送厨 | 后厨单按出单档口拆分，**不带价格和税**，印桌号、跑堂名、外带取餐号 |
| 退菜 | 已送厨的菜按份数退掉，必须选原因；原订单不改，退菜单独记录，后厨打「退菜 · 停止制作」单，进日志，算在跑堂的本班和结算里 |
| 沽清 | 点「沽清 / 恢复」再点菜品：顾客菜单立即下架，POS 上划掉显示、不能再点；再点一次恢复 |
| 实时同步 | 任何一台设备下单、开桌、结账、退菜，客人扫码下单，其他 POS 和管理台立即刷新（`/ws`，推送只带「哪桌有变化」，不带数据）；断线时自动重连并定时刷新 |
| 桌号锁（Tischsperre） | 一张桌同一时间只在一台设备上打开；30 秒心跳续期，90 秒无心跳自动释放；别的设备打开时提示是谁在用，经理可强制接管 |
| 外带 / 自取 | 「+ 外带自取」生成当天的取餐号（虚拟桌 `TA-n`），结账时自动带外带折扣 |
| 转桌 | 客人换桌时把未结订单整体移过去 |
| 账单 | 打印给客人看的账单（不是收据） |
| 结账 | **一起结**：整桌一张小票。**分开结**（getrennt）：每位客人选自己的菜，一人一张小票，直到整桌结清。现金（自动算找零）、银行卡（外部刷卡机）、代金券，可混合支付；折扣按税率分摊 |
| 小票 | 不可修改；错了用冲销（Storno）另开一张负数小票，只有经理能做；可以补打副本（Belegkopie） |
| 跑堂结算（Kellnerabrechnung） | 每个跑堂自上次结算以来开的小票：营业额、各税率、各支付方式、退菜、应交现金；打印结算单 |
| 管理台实时看板 | 桌位页上方显示每个跑堂：在哪台设备登录、开着哪些桌、本班小票数、营业额、手上现金；每张桌显示谁正在操作，每张订单显示哪个跑堂点的 |
| 日结（Tagesabschluss） | Z 报表：销售 / 冲销笔数、各税率、各支付方式，打印 |
| 交易日志（DEP） | 每个下单、状态变化、小票、冲销、日结都进哈希链日志（SHA-256，前后相连）；按日期导出 JSON / CSV，导出时校验链条是否完整 |

## 税率

菜品按 10% / 13% / 20% 维护，管理台可以按分类一次设置。套餐按组成菜的价格比例拆税。
小票按税率分别列出含税、净额和税额。默认：餐食 10%，酒水 20%；上线前请税务顾问确认。

## RKSV 状态

在接入 fiskaly（签名设备）之前，小票印 `TESTBELEG – NICHT SIGNIERT`，不是合规的
Registrierkassa 收据，不能用于正式营业。接入需要：

1. 注册 fiskaly，拿到 sandbox 的 API key / secret，放进 Cloudflare secrets（不要发在聊天里）。
2. 公司资料：名称、地址、UID、收银机编号。
3. 前台打印机型号和连接方式（网络 / USB / 蓝牙），用于打印签名二维码。

之后要做的：每张小票签名并印二维码、开始 / 月 / 年 / 结束小票（Start-, Monats-,
Jahres-, Schlussbeleg）、DEP7 导出、签名设备失效时的处理。

# 顾客：账户、收藏、扫码 / 自取点餐、积分

顾客菜单（`index.html`）可以打开四样东西，都在管理台 → **顾客** 里开关，默认全部关闭：

| | |
|---|---|
| 顾客账户 | 邮箱 + 密码注册登录；收藏菜品（菜品卡片上的 ♥，菜单里多一个「♥ 收藏」标签） |
| 线上点餐 | 菜单上每道菜有「+」，卡片里选口味、份数，加购物车下单，**直接送后厨打印机** |
| 外带自取 | 登录的顾客下外带单，自动分配当天的取餐号（和 POS 外带同一个号段） |
| 积分 | 结账后按菜品金额得积分，积分兑换指定的菜品或商品 |

代码：`shared/ordering.mjs`（点餐规则和限制、开台）、`shared/customer.mjs`（账户、积分规则和 SQL）、
`shared/customer-store.mjs`（账户、收藏、积分的读写，两个后端共用一份），菜单端在
`apps/customer-app/src/features/{account,cart,orders}`，管理台在 `apps/admin-web/src/features/guests`。
`shared/contract-suite.mjs` 对 Node 和 Cloudflare Worker 跑同一套检查。

## 点餐的限制

参考市面上成熟的扫码点餐系统，订单直接出单，所以有这些限制（管理台 → 顾客 → 线上点餐）：

| 限制 | 默认 | 说明 |
|---|---|---|
| 总开关 | 关 | 关着时菜单没有购物车；`POST /api/orders`、`/api/guest/orders` 一律拒绝 |
| 点餐时段 | 不限 | 可以加多个时段（午市、晚市），按餐厅时区 |
| 必须开台 | 开 | 堂食只有服务员在 POS / 管理台「开台」后才能扫码点餐；拍下来的旧二维码点不了 |
| 开台有效期 | 4 小时 | 到时自动关闭；整桌结清也会自动关闭；服务员也可以手动关闭 |
| 每单份数 | 30 份 | |
| 每单金额 | €300 | |
| 下单间隔 | 60 秒 | 同一桌（堂食）或同一顾客（外带）两次下单之间 |
| 未取外带单 | 2 张 | 每位顾客同时最多几张没取的外带单 |
| 外带需登录 | 固定 | 外带自取必须有账户，知道是谁的单 |
| 桌号锁 | 固定 | 正在结账（锁桌）的桌不接受顾客下单 |

另外每台设备（IP）下单还有频率限制，和原来一样。拒绝时服务器返回原因代码（`TABLE_NOT_OPEN`、`TOO_SOON` 等），菜单用顾客的语言说明该怎么做。

**开台**：POS 点单界面的「开台扫码」按钮，或管理台 → 桌位 → 「开台（允许扫码点餐）」。
服务员在 POS 上给这桌点过单，这桌也自动开台。

后厨单上印「*** 顾客扫码点餐 ***」或「*** 线上自取 ***」和顾客称呼，积分兑换的菜标「积分兑换」。
顾客在「我的订单」里看到订单状态（已送厨 / 制作中 / 可取餐），外带单大字显示取餐号；不登录的顾客也能看到本机下过的单。

## 积分

- 登录的顾客下的单，结账时（POS 出小票）按菜品价格得积分：每 €1 得 N 分（默认 1），向下取整；兑换的菜不计分。
- 小票冲销（Storno）时扣回这张小票给的积分（最多扣到 0）。
- 兑换：管理台设置可兑换的菜品 / 商品和所需积分，每单最多兑换几份。兑换的那份价格为 0（加料照收），下单时扣积分；
  订单在付款前被取消，积分退回。积分余额不能为负，两单同时用同一笔积分只有一单成功。
- 管理台顾客列表可以按邮箱搜索、手动加减积分（必须写原因）、给忘记密码的顾客重设密码、删除账户（GDPR；订单保留，不再关联到人）。
- 顾客自己可以改称呼、改密码、删除账户。

## 付款

现在是**到店付款**：堂食餐后在 POS 结账；外带取餐时在 POS 结账（取餐号 `TA-n` 出现在 POS 的外带区，标「线上自取」）。
只有积分兑换、金额为 0 的单，POS 可以直接出一张 0 元小票。

**在线付款**（Stripe：银行卡、Apple Pay / Google Pay、EPS）接口已经预留（`payment: "online"`），
目前服务器返回 `PAYMENT_UNAVAILABLE`。接入需要：

1. Stripe 商户账户，把 `STRIPE_SECRET_KEY` 和 webhook 的 `STRIPE_WEBHOOK_SECRET` 放进 Cloudflare secrets（不要发在聊天里）。
2. RKSV：在线付款也要出签名小票，需要先完成 fiskaly 接入（见 `docs/POS.md` 的 RKSV 部分）。

## 接口一览

| | |
|---|---|
| 顾客账户 | `POST /api/customer/register` · `POST /api/customer/sign-in` · `POST /api/customer/sign-out` · `GET/PUT /api/customer` · `POST /api/customer/delete` |
| 收藏、积分、订单 | `PUT/DELETE /api/customer/favorites/:id` · `GET /api/customer/points` · `GET /api/customer/orders` |
| 下单 | `POST /api/guest/orders`（`channel: "dine-in" \| "pickup"`，堂食带 `x-table-token`）· `GET /api/guest/orders?ids=`（按本机的下单 id 查状态）· `POST /api/orders`（旧接口，同样的规则，只能堂食） |
| 开台 | `POST /api/admin/tables/:table/ordering`（`{ open: true \| false }`，跑堂 / 前台及以上） |
| 管理台 | `GET /api/admin/customers?q=` · `GET/DELETE /api/admin/customers/:id` · `POST /api/admin/customers/:id/points` · `POST /api/admin/customers/:id/password` |
| 设置 | `PUT /api/admin/settings`：`customerAccounts`、`guestOrdering`、`loyalty`（后两个整体保存，没传的字段回到默认值） |

顾客的登录令牌走 `x-customer-token` 头，只能访问顾客自己的接口，打不开管理台和 POS。
顾客登录失败的限流和员工分开计数：餐厅 Wi-Fi 是同一个 IP，顾客输错密码不会把 POS 锁住。

数据表：`customers`、`customer_sessions`、`customer_favorites`、`points_ledger`、`guest_orders`、`table_sessions`（迁移 0057）。

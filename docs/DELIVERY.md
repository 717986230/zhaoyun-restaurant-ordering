# 外卖平台：Lieferando 和 foodora

两家平台的订单直接进系统，不再需要平台给的那台平板：

1. 平台把新订单推到我们的地址（webhook）。
2. POS 桌台最上面出现订单，并响一声提示。
3. 跑堂点「接单」，选多久做好。厨房按档口自动出单，小票上印着平台名、单号、要求时间和顾客称呼。
4. 做好点「出餐」，骑手或客人取走后点「已取走」。
5. 每一步都会回传给平台（接单、拒单、出餐）。

平台那边取消订单时，系统自动把它标成已取消；如果厨房已经在做，会打一张「退菜 · 停止制作」单。

## 开通步骤

对接需要平台的合作伙伴账户，也就是接口权限。这要由餐厅向平台申请：

- **Lieferando**（Just Eat Takeaway）：在 Partner Hub 里联系对接支持，申请 JET Connect / POS 接口。
- **foodora**（Delivery Hero）：联系 foodora 的对接支持，申请 POS 插件（Integration Middleware）。

平台审核后会给你：

| 平台 | 平台给你的东西 | 放进的环境变量 |
| --- | --- | --- |
| Lieferando | 推单时用的密钥 | `LIEFERANDO_WEBHOOK_SECRET` |
| Lieferando | 回传用的 API Key | `LIEFERANDO_API_KEY` |
| Lieferando | （可选）接口地址 | `LIEFERANDO_API_BASE` |
| foodora | 推单时签名用的密钥 | `FOODORA_WEBHOOK_SECRET` |
| foodora | 插件用户名 | `FOODORA_USERNAME` |
| foodora | 插件密码 | `FOODORA_PASSWORD` |
| foodora | （可选）接口地址 | `FOODORA_API_BASE` |

这些都是密钥，**只放在 Cloudflare 的 secrets 里**，不要写进代码，也不要发到聊天里：

```sh
npx wrangler secret put LIEFERANDO_WEBHOOK_SECRET
npx wrangler secret put LIEFERANDO_API_KEY
npx wrangler secret put FOODORA_WEBHOOK_SECRET
npx wrangler secret put FOODORA_USERNAME
npx wrangler secret put FOODORA_PASSWORD
```

在自己的服务器上运行 Node 版时，把同样的名字写进环境变量。

然后：

1. 打开管理台 →「外卖」→「平台设置」。每个平台都显示「连接状态」，可以看到密钥配好了没有（只显示有没有，不显示内容）。
2. 把「新订单地址」和「订单状态地址」复制下来，填到平台后台，或者发给平台的对接人员。
3. 打开平台开关，设好默认出餐时间。店里想让订单一进来就直接进厨房，就打开「自动接单」。
4. 保存。

## 平台菜单和我们的菜对上号

在平台后台编辑菜品时，把我们的菜号（例如 `R1`）填进平台的 PLU / Reference（Lieferando）或 Remote Code（foodora）。

对上号的菜，厨房单会用我们自己的中文名，并送到这道菜设定的档口（厨房、吧台、寿司台）。没对上号的菜，用平台上的名字，送到厨房。

## 试一试

没有平台账户也可以先试：在「平台设置」里点「发一张测试单」，系统会按平台的真实格式生成一张订单，走完整个流程（POS 提示、接单、厨房出单、出餐、记录）。

测试单不回传给平台，也不计入报表。

## 记录和报表

- 管理台「外卖」页：按日期、平台、状态查询订单，查看详情（菜品、地址、备注、回传结果），导出 CSV。上面显示每个平台的单数和金额。
- 「报表」页：营业报表下面单独列出外卖平台的单数和金额。
  外卖平台的钱由平台收取，再和餐厅结算，所以不在收银小票里，也不进日结。
- 回传失败（比如平台接口暂时不通）时，订单照样在厨房做。POS 和管理台会显示「没有通知到平台」，点「再通知一次」重发。

## 个人数据

顾客的姓名、电话、地址和备注只在做单和送单期间需要。下单 30 天后自动清除，只保留菜品和金额，用于统计。

## 目前的限制

- 两家平台的接口文档只对已审核的合作伙伴开放。系统按两家公开过的订单格式读取订单，字段名的大小写两种写法都认。回传地址和格式集中写在 `shared/delivery.mjs` 的 `outboundRequest` 里。
  拿到合作伙伴账户后，要用平台的测试环境（sandbox）核对一遍，有差异时改那一个函数就行。
- 菜单同步（把我们的菜单推送到平台）和平台上的沽清，目前还在平台后台操作。

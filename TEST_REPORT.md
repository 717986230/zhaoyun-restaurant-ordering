# 测试报告

## v0.6 结账、税率、过敏原与桌台令牌

日期：2026-08-12

自动化：

- `npm run typecheck`：通过
- `npm run unit`：9/9 通过（新增桌台令牌解析用例）
- `npm run server:test`：15/15 通过（新增账单税率拆分、过敏原枚举、桌台令牌校验、账单小票三语输出）
- `npm test`：44/44 通过
- `npm run build`：通过

真实服务实测（Fastify + SQLite + 生产构建）：

- 未登记桌台时下单成功；登记桌 12 后，无令牌下单返回 403、令牌错误返回 403、带正确令牌返回 201；换令牌后旧令牌立即失效。
- 桌 12 账单：25.00（10%）+ 3.80（20%）= 28.80；净额 22.73 / 3.17，税额 2.27 / 0.63。
- 管理台点击「打印账单并结账」后，订单标记为已结账，前台队列出现 `kind: bill` 打印任务。
- 德文账单小票输出商品德文名、税率明细和 `Interne Rechnung, kein Kassenbeleg`。
- 顾客端从 `?table=12&k=<令牌>` 进入后保存令牌并成功下单；菜品详情显示 `A 含麸质谷物 / C 蛋 / F 大豆`。

未验证：实体打印机纸张输出、Device Owner 真机、iOS 工程、支付流程（本项目不含支付）。

## v0.5 多桌运营验证

日期：2026-08-12

自动化：

- `npm run typecheck`：通过
- `npm run unit`：6/6 通过（新增桌号解析用例）
- `npm run server:test`：11/11 通过（新增桌号透传、公开接口限流、安全响应头、SQLite 写锁等待）
- `npm test`：44/44 通过（新增「桌号随订单提交」用例，覆盖四种视口）
- `npm run build`：通过

真实服务实测（Fastify + SQLite + 生产构建）：

- 顾客端 `?table=12` 下单：服务端订单 `table=12`，厨房打印任务 payload `table=12`。
- 管理台订单看板：读取到真实订单和服务呼叫；点击「更新为：制作中」后服务端订单状态变为 `preparing`；点击「已处理」后服务请求状态变为 `completed`。
- `curl -I /api/health`：返回 `x-content-type-options: nosniff`、`referrer-policy: no-referrer`、`x-frame-options: SAMEORIGIN`。
- 请求不存在的 `/assets/*.css`：返回 404 JSON，不再返回 HTML。

未验证（与上一版本相同的边界）：实体打印机纸张输出、Device Owner 真机、iOS 工程。

## v0.4 生产候选验证

日期：2026-08-05

## v0.4 生产候选验证

- 顾客端入口已从原生 JavaScript 迁移到 React + TypeScript。
- 管理台入口已从原生 JavaScript 迁移到 React + TypeScript。
- npm workspaces、TypeScript strict 和 Project References：通过。
- `domain`、`contracts`、`api-client`、`native-bridge` 包构建：通过。
- Vite 顾客端与管理台多页生产构建：通过。
- `npm audit --omit=dev`：0 个生产依赖漏洞。
- Node 运行时约束：`>=22.5.0`，通过配置和 `package.json` engines 固化。

## 浏览器功能与响应式测试

Playwright 覆盖：

- Android 手机竖屏
- Android 手机横屏
- Android 平板竖屏
- Android 平板横屏

每种视口验证：

- 点击菜品后打开详情，背景列表弱化
- 图片与视频商品使用同一个 3D 翻转状态和动画容器
- 打开详情后点击卡片正面直接翻转，点击背面返回；加购控件不误触翻转
- 中文、德文、英文切换后首页、菜单、商品名称和购物车/订单文字更新
- 详情显示食材、过敏原、价格和数量
- 菜单页不显示语言切换按钮；首页切换语言后进入菜单仍保持对应语言
- 菜单顶部和详情顶部不重复计算安全区留空
- 固定时长 3D 翻转、视频 metadata 预加载和减少动画模式
- 加入购物车、提交订单、查看状态
- 服务呼叫、员工处理请求
- 员工推进订单状态
- 顶栏和购物车操作保持可见

管理台同时验证商品目录、打印机模块、连接设置和响应式控件可用性；商品编辑器额外验证结构化选项 JSON 会加载到表单。

最终结果：32/32 通过（包含本次 UI 修复后的回归）。

## TypeScript 领域单元测试

- 订单状态只能按允许方向推进
- 同步失败订单不能被员工直接推进
- 购物车金额始终使用整数分计算

最终结果：2/2 通过。

## 后端集成测试

Node 测试覆盖：

- 未授权管理请求返回 401
- 111 条照片菜单 seed 商品初始化，覆盖 Ramen、Specials、Bao、Hot Pot、寿司、主菜、前菜、乌冬、配菜、甜品、酒水和咖啡茶
- 新增酒水和寿司
- 服务器按数据库价格计价
- 加面、不要香菜、加辣椒选项由后端校验、计价并写入打印任务
- `client_request_id` 幂等下单
- 酒水路由到吧台、寿司路由到寿司台
- 按档口生成独立打印任务
- 服务请求创建与完成
- 订单状态更新
- 请求 schema 拒绝非法订单/商品 payload
- 后台错误 token 第 6 次尝试触发 429 限流

额外覆盖：

- 离线订单命令持久化后自动重试：Playwright 通过
- 打印任务认领租约、成功完成、防重复处理：Node 集成测试通过
- 打印失败进入 `retry-wait` 并保留错误：Node 集成测试通过
- SQLite `VACUUM INTO` 备份和 `integrity_check`：临时数据库演练通过

最终结果：6 个后端/打印集成场景通过。

## 管理台实测

使用完整生产构建和实际 Fastify/SQLite 服务验证：

- 管理员令牌登录：通过
- 111 条后端商品目录渲染：通过
- 创建酒水：通过
- 上传 PNG 并显示缩略图：通过
- 删除测试商品：通过
- 管理表单 `name="id"` 遮蔽 `form.id` 问题已修复
- 商品选项配置保存、服务端校验和数据库回读：通过
- 并发相同 `clientRequestId` 幂等下单：通过
- 程序化生产启动的管理员 token 长度校验：通过

## Android 构建与设备验证

- React + TypeScript Vite 多页生产构建：通过
- Capacitor Android 同步：通过
- 原生 Kiosk 与 Printer 插件 Java 编译：通过
- Gradle `assembleDebug`：通过，production-candidate debug APK SHA-256：`bf3339fd9bdbca012da41923b64b9127eeecc42b4b9cb1d06c130a96627b96fc`
- Gradle `assembleRelease`：无签名环境变量时按预期拒绝构建；未声称已生成生产签名 APK
- Android 15 ARM64 平板模拟器安装：ADB 返回 `Success`
- Debug 构建继续通过；Release 构建已加入签名密钥环境变量门禁，未使用未知签名密钥生成生产包
- 2560×1600 平板启动与首页渲染：通过
- 平板菜单渲染：通过
- 应用进程和前台 Activity：通过
- WebView/AndroidRuntime 致命错误日志：未发现

Playwright 已验证详情与 3D 翻转交互；模拟器进入屏幕固定后，ADB 注入点击会受系统固定提示和任务栈影响，因此打印机周围设备搜索与实体打印页不能用无硬件模拟器完成。

## 打印机验证边界

已完成并通过编译：

- 局域网 NSD 服务发现
- 已配对蓝牙设备枚举
- USB 设备枚举
- 局域网 9100 ESC/POS 测试页
- 蓝牙 SPP ESC/POS 测试页
- 打印机档口配置
- 后端打印任务按档口拆分

未声称已完成：

- 无实体打印机，未验证真实纸张输出
- USB 写入需要具体打印机型号驱动
- 打印任务自动消费、失败重试和回执仍需下一阶段打印代理

## Kiosk 边界

普通安装验证了沉浸式全屏和 Android 屏幕固定。真正不可退出依赖 Device Owner，只能在恢复出厂设置的专用实体设备上完成，因此本报告不把普通模拟器屏幕固定声称为系统级 Device Owner 验证。

## 安全防护补充

- 管理 API 使用常量时间 token 比较；同一来源连续 5 次错误 token 后锁定 60 秒并返回 `429`/`Retry-After`。
- Android 管理 PIN 连续 5 次错误后锁定 60 秒，成功解锁后清除失败计数。
- 服务端请求 schema、状态迁移、生产配置校验和优雅停机已加入部署收口。
- 已用 Node 集成测试验证管理员错误 token 的黑盒限流行为。
- 当前限流状态为单进程内存状态；多实例部署必须迁移到 Redis 或其他共享限流存储。
- 本项目仍未完成专业渗透测试、沙盒逃逸测试、Device Owner 真机安全验证和实体打印机安全测试。

## iOS

未安装完整 Xcode。本次未生成 iOS 工程，也未生成或声称生成 IPA。

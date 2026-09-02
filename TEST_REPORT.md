# 测试报告

日期：2026-09-02

## 本轮执行结果

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm run unit` | 2/2 通过 |
| `npm run server:test` | 9/9 通过 |
| `npm test`（Playwright，4 种视口 × 15 用例） | 60/60 通过 |
| `npm run build` | 通过 |
| `npm audit --omit=dev` | 0 漏洞（升级 fast-uri 与 fastify 后） |

生产依赖 0 漏洞。开发依赖仍有两条待处理，均需破坏性大版本升级、属于独立工程项：
`esbuild <=0.24.2`（moderate，经 vite 5）与 `tar <=7.5.20`（critical，经 @capacitor/cli 6）。
两者只在构建/同步阶段使用，不进入运行时产物。

## v0.4 生产候选验证

- 顾客端入口已从原生 JavaScript 迁移到 React + TypeScript。
- 管理台入口已从原生 JavaScript 迁移到 React + TypeScript。
- npm workspaces、TypeScript strict 和 Project References：通过。
- `domain`、`contracts`、`api-client`、`native-bridge` 包构建：通过。
- Vite 顾客端与管理台多页生产构建：通过。
- `npm audit --omit=dev`：0 个生产依赖漏洞（fast-uri 已升级到 3.1.6 / 4.1.3）。
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
- 员工推进本机订单状态
- 顶栏和购物车操作保持可见
- `?table=` provision 的桌号写入下单与服务呼叫命令，并在无参数重载后保留
- 同一菜品加两次累加为一条购物车行、数量为 2
- 无缓存且目录接口失败时显示“菜单暂时不可用”，不再回退到 demo 菜单

管理台同时验证订单看板、商品目录、打印机模块、连接设置和响应式控件可用性；商品编辑器额外验证结构化选项 JSON 会加载到表单；订单看板验证后端订单渲染（桌号、菜品、选项、备注）、状态推进发出 `PATCH /api/orders/:id/status`，以及服务呼叫处理后从待办列表移除。

最终结果：60/60 通过（15 个用例 × 4 种视口）。

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
- 含空格分类（如 `HOT POT`）的 seed 商品可以从管理接口原样回写
- 服务请求返回契约 DTO（`table`/`serviceType`/`createdAt`），不再泄漏数据库行字段
- 可信代理列表下解析出真实客户端 IP；跳数与 `true` 写法在启动时被拒绝

额外覆盖：

- 离线订单命令持久化后自动重试：Playwright 通过
- 打印任务认领租约、成功完成、防重复处理：Node 集成测试通过
- 打印失败进入 `retry-wait` 并保留错误：Node 集成测试通过
- SQLite `VACUUM INTO` 备份和 `integrity_check`：临时数据库演练通过

最终结果：9 个后端/打印/代理集成测试全部通过。

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

以下为 2026-08-05 版本的记录。本轮修改了 `KioskStore.java`（PIN 改用 PBKDF2），本机没有
Android SDK，未重新执行 Gradle 构建和模拟器验证；下方的 APK SHA-256 对应旧源码，重新构建
后会变化，发布前需按当前源码重跑 `npm run cap:sync` 与 `assembleDebug` 并重新记录。

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

注：本节记录的是原生插件层的验证边界。服务端打印代理（任务认领、租约、退避重试、人工重试
接口）已在 2026-08-05 交付，见上文后端集成测试。

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
- Android 端直连打印（蓝牙/USB）未在实体设备上验证

## Kiosk 边界

普通安装验证了沉浸式全屏和 Android 屏幕固定。真正不可退出依赖 Device Owner，只能在恢复出厂设置的专用实体设备上完成，因此本报告不把普通模拟器屏幕固定声称为系统级 Device Owner 验证。

## 安全防护补充

- 管理 API 使用常量时间 token 比较；同一来源连续 5 次错误 token 后锁定 5 分钟并返回 `429`/`Retry-After`（`AUTH_WINDOW_MS`）。
- 反向代理部署必须把可信代理地址填进 `TRUST_PROXY`，否则限流按代理 IP 聚合，会把所有管理员
  一起锁住。集成测试固定了这个行为：不配时不采信 `X-Forwarded-For`，配了可信地址才解析出真实
  客户端；跳数写法和 `true` 在启动时被拒绝（前者在 fastify 5.12 之后不再解析转发地址，等于
  配了没生效，后者采信客户端可伪造的最左侧地址）。
- Android 管理 PIN 连续 5 次错误后锁定 60 秒，成功解锁后清除失败计数。
- Android 管理 PIN 使用随机盐 + PBKDF2（SHA-256，20 万次迭代；API 26 以下回退 PBKDF2-SHA1）
  存储，旧版单轮 SHA-256 记录在下次成功解锁时自动升级；已用桩化 SharedPreferences 验证
  新建、校验、拒绝错误 PIN 和 legacy 升级四条路径。
- 服务端请求 schema、状态迁移、生产配置校验和优雅停机已加入部署收口。
- 已用 Node 集成测试验证管理员错误 token 的黑盒限流行为。
- 当前限流状态为单进程内存状态；多实例部署必须迁移到 Redis 或其他共享限流存储。
- 管理端仍是单一静态 token，没有账号体系和角色区分。
- 本项目仍未完成专业渗透测试、沙盒逃逸测试、Device Owner 真机安全验证和实体打印机安全测试。

## iOS

未安装完整 Xcode。本次未生成 iOS 工程，也未生成或声称生成 IPA。

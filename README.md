# Zhao Yun Restaurant Ordering

奥地利餐厅手机和平板点餐系统，包含顾客端、员工看板、管理台、Fastify/SQLite 后端、Android Capacitor 工程和打印机适配层。

## 当前功能

- React + TypeScript 顾客端和管理台
- `motion` React 动效库驱动稳定的 3D 翻面
- 后端真实菜单 seed：111 条菜品、寿司、酒水和咖啡茶数据，三语名称：中文、Deutsch、English
- 手机/平板横屏与竖屏响应式布局
- 菜品详情卡片：点击打开，点击卡面直接进行连续 3D 翻转
- 图片和视频使用同一套翻转交互
- 食材、过敏原、规格、价格、购物车、下单和订单状态
- 服务呼叫、员工看板、管理端媒体上传和打印机发现
- Capacitor Android 测试构建与 kiosk 模式
- 每台设备独立桌号：`?table=` 或首页「设置桌号」，订单、服务呼叫和打印小票都带真实桌号
- 管理台「订单看板」：全店实时订单、服务呼叫和失败打印任务，可推进状态、取消订单和重新打印
- 后端请求 schema 校验、订单状态机、认证限流和生产启动校验
- 公开下单/呼叫接口按设备 IP 限流，避免同一台设备刷单
- 离线订单持久化重试、幂等下单和 LAN ESC/POS 打印代理
- SQLite 一致性备份、integrity_check 和失败打印任务人工重试接口

## 快速开始

```bash
npm install
npm run build
ADMIN_TOKEN='replace-with-a-long-random-token' npm run server
```

浏览器访问：

- 顾客端：`http://127.0.0.1:8787/`
- 管理台：`http://127.0.0.1:8787/admin.html`

完整 Android SDK、APK 安装、局域网部署和打印机说明见 [INSTALL.md](INSTALL.md)。

部署前请先阅读 [INSTALL.md](INSTALL.md) 的生产环境要求；当前版本适合单机/单进程餐厅部署，多实例前需要将认证限流迁移到共享存储。

## 开发命令

```bash
npm run typecheck     # TypeScript project references
npm run unit          # 领域单元测试
npm run server:test   # Fastify/SQLite 集成测试
npm test              # Playwright 手机/平板响应式测试
npm run build         # Web 生产构建
npm run backup        # 生成并校验 SQLite/媒体备份
npm run print-agent   # 按 PRINTER_ROLE 启动 LAN 打印任务代理
npm run cap:sync      # 同步 Capacitor Android 工程
npm run android:debug # 构建 debug APK
npm run android:release # 使用环境变量签名构建 Release APK
```

打印任务会按商品的出单档口拆分：厨房、吧台、寿司台和前台分别排队。管理台配置打印机时，可为每台设备选择打印语言（中文 / Deutsch / English）和字符编码（UTF-8 / GB18030 / Shift-JIS / CP437）；订单会保留中德英名称，由各打印机独立转换后输出。当前输出是标准 ESC/POS 订单制作单，不是整本菜单双面菜单；正式上线前必须用实际打印机做中文编码、纸宽和裁切测试。

## 桌号配置

每台点餐设备必须绑定自己的桌号，否则订单会全部记到占位桌号 `08`：

1. 首选：给每台设备配置带桌号的入口地址，例如 `http://192.168.1.20:8787/?table=12`；桌号会写入本机并在之后的普通访问中沿用。
2. 备选：在首页点「设置桌号」输入 1-8 位字母或数字（例如 `12`、`T-3`、`TERRASSE`）。
3. 未配置的设备会在首页显示红色提示，方便开台前检查。

桌号只保存在设备本地，服务端按请求中的桌号入库、分单和打印。

## 订单看板

管理台新增「订单看板」标签页，数据全部来自服务端，因此任意一台管理设备都能看到全店状态：

- 进行中的订单：推进 `新订单 → 制作中 → 可上菜 → 已完成`，或取消订单。
- 服务呼叫：标记已处理。
- 打印失败：显示失败次数和错误原因，可重新排队打印。

顾客端的「员工看板」仍然只显示本机订单，用于单机演示；正式营业请使用管理台看板。

## 交互约定

菜单卡片的实际操作顺序是：点击列表卡片打开详情，再点击详情卡面翻转；正面和背面均可点击返回另一面，加减数量和加入购物车按钮不会触发翻转。语言在首页选择，进入菜单后沿用，当前语言会持久化到本地设备。

## 项目文档

- [安装与运行](INSTALL.md)
- [系统架构](ARCHITECTURE.md)
- [测试报告](TEST_REPORT.md)
- [变更记录](CHANGELOG.md)
- [ADR-0001：TypeScript 模块化单体](docs/adr/0001-modular-monolith-typescript.md)

## 已知边界

LAN 打印代理已完成任务租约、失败重试和人工重试接口，但真实打印纸张输出仍需连接具体型号的实体打印机验证；USB/Bluetooth 后端代理需要对应驱动或 Android 端执行。iOS 工程、签名 IPA 和生产级 Device Owner 配置未在本仓库中声称已完成。

尚未实现，正式营业前需要评估：

- 结账与账单：系统只出厨房/吧台制作单，没有账单、分单结账和支付；奥地利的收银合规（Registrierkasse / Belegerteilungspflicht）需要由现有收银系统承担。
- 过敏原：当前是自由文本，未按奥地利 A–R 字母代码约束和展示。
- 桌号只由设备本地声明，服务端不做校验；同一网络内的其他设备可以冒用桌号下单。
- 认证限流和公开接口限流都是单进程内存状态，多实例部署前需迁移到共享存储。
- 顾客端「员工看板」的状态变更只作用于本机，不写回服务器。

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
- 服务呼叫、管理台后端订单与服务呼叫看板、媒体上传和打印机发现
- 每台设备单独配置桌号（`?table=` 或管理台连接设置）
- Capacitor Android 测试构建与 kiosk 模式
- 后端请求 schema 校验、订单状态机、认证限流和生产启动校验
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

每台平板首次使用时设定桌号：用 `http://<服务器>:8787/?table=12` 打开一次，或在管理台
“连接设置”里填写“本机桌号”。桌号保存在该设备本地，之后下单和呼叫服务都用它。

完整 Android SDK、APK 安装、局域网部署和打印机说明见 [INSTALL.md](INSTALL.md)。

部署前请先阅读 [INSTALL.md](INSTALL.md) 的生产环境要求；当前版本适合单机/单进程餐厅部署，多实例前需要将认证限流迁移到共享存储。放在反向代理后面时必须设置 `TRUST_PROXY`，否则限流会把所有请求算成同一个来源。

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

## 交互约定

菜单卡片的实际操作顺序是：点击列表卡片打开详情，再点击详情卡面翻转；正面和背面均可点击返回另一面，加减数量和加入购物车按钮不会触发翻转。语言在首页选择，进入菜单后沿用，当前语言会持久化到本地设备。详情每次打开都从数量 1、未选选项开始；相同菜品加相同选项会累加到同一条购物车行。

顾客端的“员工看板”只显示本机下过的订单和呼叫，离线也能看；全店订单看板在管理台“订单看板”，
状态变更走后端状态机，对所有设备生效。

## 项目文档

- [安装与运行](INSTALL.md)
- [系统架构](ARCHITECTURE.md)
- [测试报告](TEST_REPORT.md)
- [变更记录](CHANGELOG.md)
- [ADR-0001：TypeScript 模块化单体](docs/adr/0001-modular-monolith-typescript.md)

## 已知边界

LAN 打印代理已完成任务租约、失败重试和人工重试接口，但真实打印纸张输出仍需连接具体型号的实体打印机验证；USB/Bluetooth 后端代理需要对应驱动或 Android 端执行。iOS 工程、签名 IPA 和生产级 Device Owner 配置未在本仓库中声称已完成。

管理端认证仍是单一静态 `ADMIN_TOKEN`，没有账号体系和角色区分；仓库没有 CI workflow 和
lint/format 配置，质量门禁目前靠本地命令执行。

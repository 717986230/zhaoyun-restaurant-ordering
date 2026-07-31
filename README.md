# Zhao Yun Restaurant Ordering

奥地利餐厅手机和平板点餐系统，包含顾客端、员工看板、管理台、Fastify/SQLite 后端、Android Capacitor 工程和打印机适配层。

## 当前功能

- React + TypeScript 顾客端和管理台
- `motion` React 动效库驱动卡片展开、共享布局和 3D 翻面
- 菜品、寿司、酒水目录，三语名称：中文、Deutsch、English
- 手机/平板横屏与竖屏响应式布局
- 菜品详情卡片：点击打开，点击卡面直接进行连续 3D 翻转
- 图片和视频使用同一套翻转交互
- 食材、过敏原、规格、价格、购物车、下单和订单状态
- 服务呼叫、员工看板、管理端媒体上传和打印机发现
- Capacitor Android 测试构建与 kiosk 模式
- 后端请求 schema 校验、订单状态机、认证限流和生产启动校验

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
npm run cap:sync      # 同步 Capacitor Android 工程
npm run android:debug # 构建 debug APK
```

## 交互约定

菜单卡片的实际操作顺序是：点击列表卡片打开详情，再点击详情卡面翻转；正面和背面均可点击返回另一面，加减数量和加入购物车按钮不会触发翻转。语言选择器位于首页、菜单、购物车和订单页，当前语言会持久化到本地设备。

## 项目文档

- [安装与运行](INSTALL.md)
- [系统架构](ARCHITECTURE.md)
- [测试报告](TEST_REPORT.md)
- [变更记录](CHANGELOG.md)
- [ADR-0001：TypeScript 模块化单体](docs/adr/0001-modular-monolith-typescript.md)

## 已知边界

真实打印纸张输出仍需连接具体型号的实体打印机验证；USB 打印需要型号驱动。iOS 工程、签名 IPA 和生产级 Device Owner 配置未在本仓库中声称已完成。

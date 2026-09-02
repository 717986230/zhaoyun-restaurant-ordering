# 目标系统架构

状态：v0.4 生产候选收口中；顾客端、管理台（含后端订单看板）、领域契约、离线订单重试、
SQLite 备份和 LAN 打印代理已实现。服务端仍是带模块化边界的 ESM JavaScript，完整 API
TypeScript 迁移、实体打印机和 Device Owner 验证仍需单独完成。
更新：2026-09-02

## 1. 架构结论

本项目采用 **TypeScript 企业级模块化单体 + npm workspaces 单仓库**，而不是继续扩展原生 JavaScript，也不在当前规模下拆微服务。

- 顾客 App：React + TypeScript + Vite + Capacitor。
- 管理台：React + TypeScript + Vite，独立入口和权限边界。
- 服务端：Fastify + ESM JavaScript，使用 TypeBox schema、模块化路由、SQLite 事务和集成测试；TypeScript API 迁移仍是后续工程，不把文档愿景当成已完成事实。
- API 契约：TypeBox/JSON Schema 作为单一事实来源，由服务端验证并被客户端共享。
- 服务端状态：TanStack Query 管理请求、缓存、失效和重连。
- 本地交互状态：React reducer/context；只有真正跨页面且长期存在的 UI 状态才进入小型 store。
- 数据库：第一阶段保留 SQLite，用 repository + transaction 隔离实现；未来换 PostgreSQL 不影响业务用例。
- 原生能力：Capacitor typed plugins，只通过 `native-bridge` 包访问打印机与 kiosk。
- 部署：一个 API 进程、一个数据库、一个媒体目录、一个独立打印代理；Android App 安装在手机/平板。

“企业级”在这里指可审计的边界、契约、状态机、测试和部署，不指堆叠框架或过早拆分服务。

## 2. 设计原则

1. **领域规则不依赖 UI、HTTP、SQLite 或 Android。**
2. **跨边界只传契约 DTO，不共享数据库行或组件状态。**
3. **服务端是订单、价格、库存状态和打印任务的最终事实来源。**
4. **离线命令必须显示为“待同步”，服务端确认后才能显示“已下单”。**
5. **打印是可重试、有租约的后台任务，不是页面中的一次副作用。**
6. **模块化单体优先；只有出现独立扩缩容或故障隔离证据时才拆服务。**
7. **逐步迁移，每个阶段均可构建、测试和发布。**

## 3. 单仓库结构

当前仓库实际结构：

```text
apps/
  customer-app/             React 顾客端 + Capacitor Web 入口
    src/app/                启动、状态、契约客户端、i18n、本机桌号
    src/features/           catalog/cart/orders/service/staff/kiosk
  admin-web/                React 管理台
    src/features/           orders/catalog/printers/settings
packages/
  domain/                   实体、状态机、金额与购物车纯规则
  contracts/                TypeBox schema 与 DTO
  api-client/               类型化 HTTP/WebSocket 客户端
  native-bridge/            Capacitor Printer/Kiosk 类型声明与适配器
server/                     Fastify 组合根、SQLite、路由、打印代理（仍是 ESM JavaScript）
android/                    Capacitor 生成工程及原生插件实现
docs/adr/                   关键架构决策
```

尚未建立、属于后续阶段的目录：`apps/api`（服务端 TypeScript 化）、`packages/application`、
`packages/infrastructure`、`packages/ui`、`packages/test-kit`。当前服务端的组合根、仓储和用例
仍集中在 `server/` 的模块化 ESM JavaScript 里。

首轮迁移不引入 Nx/Turborepo。npm workspaces 和 TypeScript project references 已足够；当构建时间或 CI 任务图产生实际问题后再引入构建编排器。

## 4. 依赖规则

允许的方向：

```text
apps -> features -> application -> domain
apps -> api-client -> contracts
api  -> application -> domain
api  -> infrastructure -> application ports
native-bridge -> contracts
ui -> 无业务包
```

禁止：

- `domain` 导入 React、Fastify、SQLite、Capacitor 或浏览器 API。
- React 组件直接调用 `fetch`、`localStorage`、WebSocket 或原生插件。
- 路由 handler 直接写 SQL 或拼打印字节。
- 管理台导入顾客端 feature。
- API 与客户端复制各自的状态字符串和 DTO。

当前只有 TypeScript project references 与 `npm run typecheck` 机械强制其中一部分：包之间的
依赖方向由 references 保证，`domain` 与 `contracts` 不引用 React/Fastify/SQLite 也已成立。
仓库尚未配置 ESLint import boundaries，其余条目目前靠 review 保证。

## 5. 业务模块

### Catalog

负责菜品、酒水、寿司、分类、三语名称、过敏原、价格、媒体、上下架与出单档口。媒体是独立实体，视频与卡片使用同一详情状态机，但采用不同 renderer；翻转动画属于表现层，不进入领域模型。

### Ordering

聚合根为 `Order`。状态机为：

```text
pending-sync -> new -> preparing -> ready -> completed
                  \-------------------------> cancelled
pending-sync -> sync-failed -> pending-sync
```

- 客户端生成 `clientRequestId`，服务端唯一约束保证幂等。
- 服务端按当前目录重新定价并在事务中创建订单项。
- 状态转换由领域规则校验，不能任意写字符串。
- 下单成功与 outbox/print job 在同一数据库事务提交。

### Service

服务呼叫是独立聚合，状态为 `open -> acknowledged -> completed`，可取消。重复点击应通过短时间幂等键或服务端合并策略处理。

### Printing

`PrintJob` 状态为：

```text
queued -> claimed -> printing -> printed
                    \-> retry-wait -> claimed
                    \-> failed -> queued/manual-cancelled
```

打印代理按档口认领任务，使用租约避免两台设备重复打印；记录打印机、尝试次数、错误码、时间和回执。LAN/Bluetooth/USB 是 transport adapters，ESC/POS 是 renderer，不和订单模块耦合。

### Identity And Device

- 目标：管理员认证使用服务端会话/短期 token 和角色权限。当前实现仍是单一静态 `ADMIN_TOKEN`
  经 `x-admin-token` 头校验，常量时间比较 + 来源限流，没有角色区分；会话化和 RBAC 未完成。
- kiosk 管理员 PIN 只负责本机退出授权，使用 PBKDF2（SHA-256，20 万次迭代；API 26 以下回退
  PBKDF2-SHA1）加随机盐存放在应用私有 SharedPreferences；旧版单轮 SHA-256 哈希在下次成功
  解锁时自动升级。迁移到 Android Keystore 仍是后续工程。
- 正式不可退出使用 Android Dedicated Device / Device Owner + Lock Task；普通 APK 的 screen pinning 仅作为测试模式。

## 6. 前端状态设计

| 状态 | 所有者 | 方案 |
|---|---|---|
| 目录、订单、服务请求、打印机 | 服务端 | TanStack Query + 契约客户端 |
| WebSocket 事件 | api-client | 转换为 query invalidation/patch |
| 购物车、备注、当前桌号 | 顾客 App | typed reducer + 持久化 adapter |
| 当前页面、筛选、展开/翻转 | feature/component | React local state |
| 待同步命令 | sync engine | 持久化队列 + 明确状态机 |
| 原生打印/kiosk | native-bridge | async typed adapter |

不把 TanStack Query 当全局状态库，也不把所有状态塞进一个 store。

## 7. API 与事件契约

- REST 路由使用 JSON Schema 同时完成请求校验、响应序列化和 OpenAPI 生成。
- 金额在契约中使用整数分 `priceCents`，禁止浮点金额跨边界。
- 时间统一 ISO 8601 UTC；显示时转换为 `Europe/Vienna`。
- 错误统一 `{ code, message, correlationId, details? }`。
- WebSocket 事件统一 `{ id, type, aggregateId, version, occurredAt, payload }`。
- 客户端收到事件后按版本去重，再更新或失效 TanStack Query 缓存。
- API 版本从 `/api/v1` 开始；破坏性修改发布新版本。

## 8. 一致性与离线策略

下单走本地 command queue，但不采用“任意离线最终成功”的假设：

1. App 将命令保存为 `pending-sync`，包含幂等键和目录版本。
2. 联网后按顺序提交。
3. 服务端重新校验商品、价格和可售状态。
4. 成功返回权威订单；冲突显示需人工确认，不静默改价下单。
5. 服务端事务写订单、订单项、outbox 和 print jobs。
6. WebSocket 仅用于加速刷新，断线后通过 REST 增量同步恢复，不依赖消息永不丢失。

## 9. 可观测性与安全

- 每个请求生成 `correlationId`，结构化日志贯穿 API、订单、outbox 和打印任务。
- 关键指标：下单成功率、同步积压、打印队列时长、打印失败率、WebSocket 在线数。
- 管理 API 默认拒绝匿名访问；按 `manager/staff/kitchen` 授权。
- 上传文件校验 MIME、扩展名、大小和随机文件名；媒体目录不执行内容。
- 密钥只来自环境变量/系统密钥库，不进入源码、localStorage 或日志。
- 数据库定期备份并验证恢复；schema migration 有版本和回滚说明。

## 10. 测试与质量门禁

- `domain`：Vitest 单元测试，覆盖价格、状态转换、分单与幂等规则。
- `contracts`：schema 正反例和兼容性测试。
- `api`：Fastify inject + 临时 SQLite 集成测试。
- `customer/admin`：React Testing Library 组件测试。
- 关键流程：Playwright 覆盖下单、服务呼叫、后台上架、翻转、横竖屏。
- Android：原生插件单测、instrumented test、真机打印 smoke test。
- 本地质量门禁：`npm run typecheck`、`npm run unit`、`npm run server:test`、`npm test`、`npm run build`。
- 仓库尚未配置 CI workflow 与 lint/format 工具，这是发布前要补的工程项，不能当成已完成。

## 11. 运行与部署边界

```text
Android phones/tablets
  -> HTTPS/WSS or restaurant LAN
API modular monolith
  -> SQLite (initial) / PostgreSQL (future)
  -> media storage
  -> transactional outbox
Print agent
  -> claims print jobs
  -> LAN / Bluetooth / USB printers
Admin web
  -> same API with RBAC
```

打印代理和 API 可在同一台餐厅主机运行，但保持独立进程，打印故障不会阻塞下单 API。

## 12. 迁移顺序

1. [x] 建立 workspaces、TypeScript strict 和测试门禁。
2. [x] 提取 `domain` 与 `contracts`，建立订单状态机和金额分模型。
3. [x] 建立类型化 `api-client`、`native-bridge` 和离线状态模型。
4. [x] 用 React 迁移顾客端：shell -> catalog -> detail/flip -> cart -> checkout -> orders/service。
5. [x] 迁移管理台：catalog/media -> printers/settings -> 后端订单与服务呼叫看板。
6. 将 Fastify 路由按模块迁移到 TypeScript plugins 和 repositories。
7. 增加 transactional outbox 与 print-agent，完成打印回执和重试。
8. 完成 Android 回归、响应式矩阵、APK 构建和旧 JS 删除。

详细决策见 `docs/adr/0001-modular-monolith-typescript.md`。

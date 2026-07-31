# ADR-0001：采用 TypeScript 模块化单体

- 状态：Accepted
- 日期：2026-08-01
- 决策者：项目负责人 / Codex

## 背景

当前实现由原生 JavaScript、DOM 事件委托、字符串模板和全局可变状态组成。它已经验证菜品详情、购物车、下单、员工看板、服务呼叫、后台上传、打印机发现和 kiosk，但继续增加实时同步、权限、离线恢复和打印重试会显著提高回归风险。

## 评估选项

### A. 保留原生 JavaScript，仅拆文件

成本最低，但不能可靠约束 DTO、状态机、模块依赖和原生插件接口。拒绝。

### B. React + TypeScript 前端，服务端保持无边界 JavaScript

改善 UI，却把主要一致性风险留在 API、数据库和打印流程。只适合作为迁移中间态，不是目标架构。

### C. TypeScript 模块化单体 + workspaces

以领域和契约为中心，顾客端、管理台、API、打印代理独立部署但共享受控包。部署复杂度适合单餐厅，同时保留未来拆服务的边界。采用。

### D. 微服务

当前没有独立团队、超大流量或差异化扩缩容需求。会引入服务发现、分布式事务、消息基础设施和更困难的现场运维。拒绝，除非未来有数据证明需要。

## 决策

采用选项 C：

- npm workspaces 管理应用和共享包。
- TypeScript `strict` 与 project references 强制边界。
- React 负责声明式 UI；TanStack Query 负责服务端状态。
- Fastify plugins 按业务模块封装。
- JSON Schema/TypeBox 是 API 契约源。
- SQLite 通过 repository 隔离；订单事务同时生成 outbox 和打印任务。
- 原生能力通过 typed Capacitor adapters 暴露。
- 打印代理作为独立进程消费任务并写回回执。

## 影响

正面：

- 编译期发现 DTO 和状态错误。
- UI、业务规则、基础设施可独立测试。
- Android 与 Web 共享业务层，不共享不受控平台细节。
- API 与打印故障隔离，订单可追踪。
- 未来换数据库或拆服务无需重写界面。

代价：

- 需要分阶段迁移约 1,000 行前端 JavaScript和服务端模块。
- 构建、lint、schema 与测试配置增加。
- 团队必须遵守依赖规则，不能从组件直接调用基础设施。

## 触发重新评估的条件

- 多门店导致单数据库写入或部署成为实测瓶颈。
- 打印、目录或订单模块需要独立发布节奏和团队所有权。
- 有明确的故障隔离或法规要求必须物理拆分服务。
- CI 构建时间达到需要 Nx/Turborepo 缓存的程度。

## 依据

- React 官方建议通过声明式组件和结构化状态避免直接修改 UI。
- TypeScript project references 用于拆分程序、加快构建并强化逻辑分组。
- Fastify plugin encapsulation 为模块提供作用域和依赖图。
- Fastify 推荐 JSON Schema 做请求验证和响应序列化。
- TanStack Query 明确区分网络模式，并支持暂停/恢复离线 mutation。
- Capacitor 官方以 typed plugin API 连接 Web 与 Android/iOS 原生能力。
- Android Dedicated Devices 官方以 Device Owner/DPC 和 Lock Task 实现专用终端。

外部资料链接保留在本任务回复和后续实施 PR 中，避免文档链接漂移影响决策正文。

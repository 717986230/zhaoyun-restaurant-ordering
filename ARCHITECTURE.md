# 系统架构

## 目标结构

项目保留 Capacitor 与现有 HTML/CSS/JavaScript，按业务职责拆成五个模块：

1. **顾客端 App**：目录、共享元素菜品详情、购物车、下单、订单状态、服务呼叫和离线兜底。
2. **管理台**：菜品、酒水、寿司、图片/视频、上下架、出单档口和打印机配置。
3. **餐厅后端**：Fastify API、SQLite 数据库、媒体文件、WebSocket 实时事件。
4. **打印模块**：Android 周围设备发现、测试打印、打印机档口配置和后端打印任务队列。
5. **终端模式**：沉浸式全屏、Lock Task、Device Owner 白名单和 PIN 管理后门。

## 目录职责

```text
src/
  customer-app.js     顾客端页面与交互编排
  customer-api.js     顾客端 API、WebSocket 和服务器地址
  admin.js            管理台页面与交互
  admin-api.js        管理 API 客户端
  data.js             离线种子目录
server/
  index.mjs           Fastify 启动和插件注册
  database.mjs        SQLite schema、事务和查询
  routes.mjs          HTTP API 和媒体上传
  realtime.mjs        WebSocket 广播
  tests/              后端集成测试
android/
  .../PrinterPlugin.java  LAN、蓝牙、USB 发现与测试打印
  .../KioskPlugin.java    终端锁定与管理员解锁
```

## 数据与出单

- `products` 同时承载 `food`、`drink`、`sushi`，由 `print_station` 路由到厨房、吧台、寿司台或前台。
- `product_media` 支持图片和视频，一个商品可挂多个媒体。
- 后端按数据库价格重新计算订单金额，不信任客户端提交价格。
- `client_request_id` 保证网络重试不会重复建单。
- 下单事务同时写入订单、订单项和按档口拆分的 `print_jobs`。
- App 无法连接服务器时使用本地目录缓存并明确标记离线订单。

## 打印边界

- 局域网：发现 `_pdl-datastream._tcp`、`_printer._tcp`、`_ipp._tcp`，支持 9100 端口 ESC/POS 测试页。
- 蓝牙：枚举已配对设备，支持 SPP ESC/POS 测试页。
- USB：枚举设备并记录厂商/产品 ID；实际写入需要按打印机型号补充 USB 接口驱动。
- 后端已生成打印任务，但自动消费、失败重试和打印回执应作为下一阶段的独立打印代理实现。

## 安全边界

- 生产环境必须设置 `ADMIN_TOKEN`，默认开发令牌只能用于本机开发。
- 媒体上传限制为 JPEG、PNG、WebP、MP4、WebM，单文件上限 50 MB。
- Android 关闭备份和 WebView 调试；局域网 HTTP 为兼容餐厅内网暂时允许。
- 正式不可退出依赖 Device Owner。普通安装只能使用 Android 屏幕固定，不能声称与 Device Owner 等价。


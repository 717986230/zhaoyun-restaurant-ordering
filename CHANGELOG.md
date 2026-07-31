# Changelog

## 2026-08-01

### Fixed

- 使用 `motion` 动效库重做卡片展开和翻面，加入 spring 位移、共享卡片布局和内容错峰进入。
- 修复详情翻转入口错误：移除独立的“详情翻转”按钮，改为点击卡片正面或背面直接触发 3D 翻转。
- 图片和视频详情继续共用同一个 `detail-flip-inner` 动画状态。
- 加减数量、加入购物车和返回正面按钮不会误触卡片翻转。

### Added

- 新增中文、德文、英文语言资源和统一 `productName` 选择逻辑。
- 首页、菜单、购物车、订单页可切换语言，当前语言持久化。
- 新增语言切换和卡片直接翻转的 Playwright 响应式测试。
- 新增根目录 README，明确启动、测试、交互和已知边界。
- 管理 API 增加常量时间 token 比较、错误尝试限流和 `Retry-After` 响应；Android 管理 PIN 增加失败锁定。

### Verification

- `npm run typecheck`：通过
- `npm run unit`：2/2 通过
- `npm test`：32/32 通过，覆盖手机/平板横竖屏
- `npm run build`：通过

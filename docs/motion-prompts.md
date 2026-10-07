# 动效提示词库

给 AI 写界面动效用的提示词：每条写清楚「做什么、用什么参数、多快、什么曲线」，可以直接复制给 Claude / Cursor 使用。
格式参照「名称 + 关键参数 + 提示词」。① 和 ② 摘自 @西瓜同学 的视频，其余为本项目自写。

使用前提（每条都默认适用）：

- 只动 `transform` 和 `opacity`；`backdrop-filter`、`filter` 只在不滚动的场景用。
- 尊重 `prefers-reduced-motion: reduce`：直接到终态，不播放动画。
- 时长不超过 1 秒；进入用 `cubic-bezier(.2,.7,.2,1)`，离开用 ease-in，并比进入快约 40%。

---

## ① 玻璃面板浮起 · Frosted Glass Sheet
`BLUR 26px · FILL .42 · STAGGER 4f`

> 毛玻璃浮层（Frosted Glass Sheet）：打开时背景页 backdrop-filter 模糊从 0 过渡到 26px，面板底色 rgba(255,255,255,.42)，从 0.94 放大到 1 浮起；12 个月份格按已用比例从底部填充，每格错开 4 帧，用 cubic-bezier(.2,.7,.2,1) 在 1 秒内完成。

本项目用法：购物车、账户、订单面板（`Sheet.tsx`）。底色取当前菜单样式的面板色 42%，面板内每行错开 4 帧出现。

## ② 点击翻面凭证 · Flip to Reveal
`PERSP 1200px · SWAP 90° · BACK REVERSE`

> 原地翻面面板（Flip to Reveal）：点击后面板以 perspective 1200px 绕 Y 轴翻转 180 度，用 cubic-bezier(.3,.7,.2,1) 在 0.8 秒内完成，翻到 90 度时切换正反面内容；背面显示出示用的编号和完整信息，再点一次反向翻回正面。

（视频截图里最后一句没打完，「反向翻回正面」是按参数 BACK: REVERSE 补全的。）
本项目可用于：菜品卡片背面（成分与过敏原）、取餐凭证、预约确认票据。

---

## ③ 列表依次落位 · Staggered Rows
`DIST 10px · STAGGER 30ms · CAP 12`

> 列表进入时每一行从下方 10px、透明度 0 移到原位，时长 420ms，cubic-bezier(.2,.7,.2,1)；行与行错开 30ms，只给前 12 行（一屏）加延迟，之后的行与第 12 行同时出现，整组 800ms 内完成。只动 transform 和 opacity，不给每行单独加 3D。

## ④ 加入购物车飞入 · Fly to Cart
`ARC 0.35 · DUR 520ms · BUMP 1.12`

> 点击「＋」后，在按钮位置生成菜品缩略图的圆形副本，沿二次贝塞尔弧线（控制点在起终点连线中点上方，高度为距离的 35%）飞到底部购物车按钮，同时缩小到 0.3、透明度降到 0.6，用时 520ms，cubic-bezier(.3,.6,.2,1)；抵达时购物车按钮放大到 1.12 再回到 1（200ms），数量徽标数字向上滚动切换。

## ⑤ 按下回弹 · Press Feedback
`SCALE .97 · IN 90ms · OUT 220ms`

> 所有可点的卡片和按钮：按下时缩放到 0.97（90ms，ease-out），松开时回到 1（220ms，cubic-bezier(.2,.7,.2,1)，允许 2% 的轻微回弹）；移动端用 :active，桌面再加 hover 时边框颜色提亮 8%。禁止只改颜色不改形状。

## ⑥ 底部提示条 · Toast
`RISE 16px · HOLD 2.4s · OUT 180ms`

> 操作反馈的提示条从屏幕底部上方 16px 处淡入上升到位（280ms，cubic-bezier(.2,.7,.2,1)），停留 2.4 秒后向下 8px 淡出（180ms，ease-in）；同时出现第二条时，第一条直接被替换而不是堆叠；提示条要避开购物车按钮和安全区。

## ⑦ 数字滚动 · Number Roll
`DIGIT 1 · DUR 360ms · STAGGER 40ms`

> 金额或数量变化时，每一位数字单独像老式计数器一样上下滚动到新值：变大向上滚、变小向下滚，每位 360ms，从个位到高位依次错开 40ms；货币符号和小数点不动；数字使用等宽数字（font-variant-numeric: tabular-nums），避免宽度跳动。

## ⑧ 翻页 · Page Turn
`PERSP 1400px · ROT -28° · DUR 480ms`

> 切换分类时，当前页以左边缘为轴、perspective 1400px 向左翻起 28 度并淡出（220ms），新页从右侧 24px、旋转 12 度处翻入到平（480ms，cubic-bezier(.2,.7,.2,1)），新页的行再按「列表依次落位」进入；手指上滑到底时也触发同样的翻页。

## ⑨ 共享元素展开 · Card to Detail
`ORIGIN row · DUR 450ms · DIM .32`

> 点击菜品行时，行内的缩略图和标题作为共享元素，从行的位置平滑放大成详情卡的大图和大标题（450ms，cubic-bezier(.2,.7,.2,1)）；背后的列表同时缩到 0.985、透明度降到 0.32；关闭时沿原路径缩回到原来那一行，而不是淡出消失。

## ⑩ 骨架闪光 · Skeleton Shimmer
`ANGLE 100° · SPEED 1.4s · ALPHA .06`

> 数据加载时显示与真实布局同尺寸的灰色占位块，一道 100 度斜向、透明度 6% 的高光从左到右扫过，周期 1.4 秒；真实内容到达后占位块与内容交叉淡入（200ms），尺寸不跳动。加载少于 300ms 的不显示骨架。

## ⑪ 下拉关闭 · Drag to Dismiss
`THRESH 110px · VEL 600 · ELASTIC .6`

> 底部面板可按住顶部把手向下拖动，面板跟随手指（向下阻尼 0.6，向上几乎不动）；松手时位移超过 110px 或速度超过 600px/s 就关闭，否则用弹簧（stiffness 420，damping 30）弹回原位；拖动时背景模糊和遮罩透明度随位移等比减弱。

## ⑫ 状态脉冲 · Live Pulse
`RING 2 · SCALE 1→1.8 · PERIOD 2s`

> 「营业中」「有新订单」这类实时状态的小圆点：圆点本身不动，外面一圈同色的环从 1 倍放大到 1.8 倍并淡出，每 2 秒一次，两个环错开 1 秒；页面不可见（visibilitychange）时暂停，减少动态效果时只显示静态圆点。

---

## 参考网站

拿来找灵感、看效果；它们的提示词版权归各自作者，用的时候在这些站点上直接复制，不要整站搬进本仓库。

- [UI Motion Prompts](https://uimotionprompts.com/)：可直接复制的动效提示词，写明了弹簧参数、错开时间。
- [TypeUI · UI Animations](https://www.typeui.sh/ui-animations)：近 300 条 UI 动画提示词。
- [MotionSites](https://bytemint.ai/motion-sites)：按风格挑选的动效页面提示词。
- [AnimSpec](https://www.animspec.com/)：把一段界面录屏转成给 AI 用的动效说明。
- [网页 UI 动效灵感库](https://holynova.github.io/web-motion-showcase/)：60 种克制的网页动效，中英双语，带可复制的提示词。
- [AI Prompt UI 词汇库](https://ui.puless.com/)：设计规范、动效、布局的中文提示词词汇。

# 安装与运行说明

## 交付内容

- Android v0.4 production-candidate Debug APK：`dist/zhaoyun-ordering-v0.4.0-production-candidate-debug.apk`
- 完整源码包：`dist/zhaoyun-ordering-v0.4.0-source.zip`
- 顾客端、管理台、Fastify/SQLite 后端和 Android 原生工程
- React + TypeScript workspace：`apps/customer-app`、`apps/admin-web`
- 共享包：`packages/domain`、`contracts`、`api-client`、`native-bridge`
- 架构说明：`ARCHITECTURE.md`
- 测试报告：`TEST_REPORT.md`

## 已安装的开发环境

- Android Studio 2026.1.2.11：`/Applications/Android Studio.app`
- OpenJDK 17.0.20：`/opt/homebrew/opt/openjdk@17`
- Android SDK：`/Users/xinglong/Library/Android/sdk`
- Android Platform、Build Tools、ADB、Emulator、ARM64 平板镜像
- Playwright Chromium

## 启动后端与管理台

后端使用 Node `>=22.5.0` 的 `node:sqlite`。生产环境必须通过反向代理提供 HTTPS/WSS，SQLite 数据目录和媒体目录必须使用持久化磁盘，不能把开发服务器直接暴露到公网。

首次运行：

```bash
npm install
npm run build
ADMIN_TOKEN='请替换成长随机令牌' npm run server
```

生产备份：

```bash
DATABASE_PATH=/var/lib/zhaoyun/restaurant.sqlite \
UPLOAD_DIR=/var/lib/zhaoyun/uploads \
BACKUP_DIR=/var/backups/zhaoyun \
npm run backup
```

备份命令使用 SQLite `VACUUM INTO` 生成一致性快照，并执行 `PRAGMA integrity_check`；备份目录应放在独立磁盘或远程备份系统中，并定期做恢复演练。

同一电脑打开：

- 顾客端：`http://127.0.0.1:8787/`
- 管理台：`http://127.0.0.1:8787/admin.html`

局域网设备使用服务器电脑的内网 IP，例如：

```text
http://192.168.1.9:8787
```

生产部署必须设置至少 32 个字符的随机 `ADMIN_TOKEN`，不能使用 `local-dev-admin`。管理员错误 token 会按来源限流；单进程限流适合单机部署，多实例部署前需要把限流状态迁移到 Redis。跨域管理台只有在明确设置 `CORS_ORIGIN` 时才开放。

## 管理菜品、酒水和寿司

1. 打开管理台的“连接设置”。
2. 填写 API 地址和 `ADMIN_TOKEN`。
3. 在“商品与媒体”选择菜品、酒水或寿司。
4. 填写三语名称、价格、分类和出单档口。
5. 可上传 JPEG、PNG、WebP、MP4 或 WebM，单文件最大 50 MB。
6. 保存后，在线顾客端通过 WebSocket 自动刷新目录。

Android App 内进入管理台：在首页顶部“赵云”区域 4 秒内连续点击 7 次，输入管理员 PIN。管理完成后点击“返回点餐”，App 会重新进入终端锁定。

## 打印机连接

在 Android 管理台打开“打印机”：

1. 点击“搜索周围打印机”。
2. App 会搜索局域网打印服务、已配对蓝牙设备和 USB 设备。
3. 点击发现结果的“选择”，设置负责档口并保存。
4. 对已保存的局域网或蓝牙打印机点击“测试打印”。

局域网热敏打印机通常使用 IP 和 9100 端口。USB 目前完成设备发现与选择，实际打印需要针对具体型号补充驱动。

服务端 LAN 打印代理按档口单独启动：

```bash
DATABASE_PATH=/var/lib/zhaoyun/restaurant.sqlite \
PRINTER_ROLE=kitchen \
PRINT_AGENT_ID=kitchen-01 \
npm run print-agent
```

每个档口运行一个代理。代理会认领任务、持有租约、失败退避重试，超过 5 次后标记 `failed`；修复打印机后可通过管理 API 的 `/api/admin/print-jobs/:id/retry` 手动重试。

每台打印机的语言和编码在管理台配置：中文打印机通常选择 `中文 + GB18030`，德文或英文打印机通常选择 `Deutsch/English + UTF-8`。订单会按厨房、吧台、寿司台、前台拆成独立任务并发送给对应设备。这里打印的是订单制作单，不会自动打印整本菜单；真实设备必须验收中文字符、纸宽、换行、走纸和裁切。

## Android 构建

```bash
npm run build
npm run cap:sync
cd android
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
ANDROID_HOME=/Users/xinglong/Library/Android/sdk \
ANDROID_SDK_ROOT=/Users/xinglong/Library/Android/sdk \
./gradlew assembleDebug
```

Release 构建必须使用餐厅自己保管的签名密钥，密钥不能提交到 Git：

```bash
ANDROID_RELEASE_KEYSTORE=/secure/zhaoyun-upload.jks \
ANDROID_RELEASE_STORE_PASSWORD='...' \
ANDROID_RELEASE_KEY_ALIAS='zhaoyun' \
ANDROID_RELEASE_KEY_PASSWORD='...' \
npm run android:release
```

未提供上述变量时，Release 构建会主动失败，避免误把未签名或错误签名包当成生产包。

构建输出：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## 安装 APK

设备直接安装：

1. 将 `dist/zhaoyun-ordering-v0.4.0-production-candidate-debug.apk` 传到手机或平板。
2. 允许文件管理器“安装未知应用”。
3. 安装并打开。
4. 首次启动设置 6-12 位管理员数字 PIN。
5. 通过管理后门设置餐厅服务器地址。

ADB 安装：

```bash
/Users/xinglong/Library/Android/sdk/platform-tools/adb install -r \
  dist/zhaoyun-ordering-v0.4.0-production-candidate-debug.apk
```

## 不可退出终端模式

普通安装启用沉浸式全屏和 Android 屏幕固定。正式系统级不可退出需要在已恢复出厂设置、未登录账户的专用设备上配置 Device Owner：

```bash
adb shell dpm set-device-owner \
  at.zhaoyun.restaurant.ordering/.KioskDeviceAdminReceiver
```

管理员后门不是写死密码：首次设置 PIN 后，首页品牌区 7 连击进入。正式部署应限制 ADB 只能连接受控维护电脑。

## 测试命令

```bash
npm test
npm run typecheck
npm run unit
npm run server:test
npm audit --omit=dev
```

## iOS

本机没有完整 Xcode，本次未生成 iOS 工程、IPA 或签名构建。安装完整 Xcode 后才能添加 Capacitor iOS 工程并进行签名测试。

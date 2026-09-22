# 部署单元

服务器和每台打印机的代理都必须由系统守护：断电或崩溃后没人会去手动 `npm run server`，
而那段时间点餐和出单是全停的。

## Linux（systemd，推荐）

```bash
sudo useradd --system --home /opt/zhaoyun zhaoyun
sudo rsync -a --exclude node_modules ./ /opt/zhaoyun/
cd /opt/zhaoyun && sudo -u zhaoyun npm ci --omit=dev && sudo -u zhaoyun npm run build

sudo mkdir -p /etc/zhaoyun
sudo cp .env.example /etc/zhaoyun/zhaoyun.env      # 填入 ADMIN_TOKEN 等
sudo chmod 600 /etc/zhaoyun/zhaoyun.env
sudo chown zhaoyun:zhaoyun /etc/zhaoyun/zhaoyun.env

sudo cp deploy/zhaoyun-server.service deploy/zhaoyun-print-agent@.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now zhaoyun-server
sudo systemctl enable --now zhaoyun-print-agent@kitchen
sudo systemctl enable --now zhaoyun-print-agent@bar
sudo systemctl enable --now zhaoyun-print-agent@sushi
sudo systemctl enable --now zhaoyun-print-agent@front
```

检查：

```bash
systemctl status zhaoyun-server
journalctl -u zhaoyun-server -f
curl -s http://127.0.0.1:8787/api/health
```

`Restart=always` + `StartLimitIntervalSec=0` 表示无论崩溃多少次都会继续拉起——
营业中宁可反复重启，也不要因为"重启次数超限"彻底停掉。

## macOS（launchd）

用 `deploy/at.zhaoyun.server.plist`，装到 `/Library/LaunchDaemons/`。
`KeepAlive` + `RunAtLoad` 等价于开机自启与崩溃重启。每个出单档口复制一份，
改 `Label` 并加上 `PRINTER_ROLE` 环境变量。

## 备份

`npm run backup` 生成一致性备份并校验 `integrity_check`。用 cron 或 systemd timer 每日跑：

```
0 4 * * * cd /opt/zhaoyun && /usr/bin/node server/backup.mjs
```

备份目录要放在另一块盘或另一台机器上——和数据库同盘的备份挡不住硬盘故障。

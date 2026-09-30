# 邮箱验证码（Brevo）

顾客第一次在线预约前，要先证明邮箱是自己的：系统把 6 位验证码发到账户邮箱，顾客输回来。一个邮箱验证一次就够了；账户换了邮箱，要重新验证。

预约电话不发短信，只校验是不是有效的**手机号**：
- 奥地利 06xx、德国 015x–017x；
- 外国号码要带国家码（+44…），只检查长度。

号码不管怎么写（`0660 1234567`、`+43 660 1234567`、`0043…`），都统一存成 `+43 660 1234567`。经理在管理台代客登记的预约不受这条限制，可以记座机。

## 没配置时

没有设置下面的变量，就没有邮件可发：预约**不要求**验证邮箱，照常可以预约。管理台「预约」页的「邮箱验证码」卡片会显示「未开启」。

## 配置步骤

1. 在 brevo.com 注册，公司资料填餐厅的真实名称和地址。
2. **Senders, Domains & Dedicated IPs → Domains**：添加餐厅的域名。按 Brevo 给出的记录添加 DNS（Brevo 验证码、DKIM、DMARC），然后点 Authenticate，直到全部显示绿色。
3. **Senders**：添加发件邮箱，比如 `noreply@你的域名`，发件人名称填餐厅名。
4. **SMTP & API → API Keys → Generate a new API key**：复制密钥，它只显示一次。
5. **Security → Authorised IPs**：关掉「阻止未知 IP」。Worker 的出口 IP 会变，开着会被 Brevo 拒绝。
6. 把下面几项设成 Worker 的加密变量（Cloudflare 后台 → Workers & Pages → ck → Settings → Variables and Secrets，类型选 Secret），或者用命令行：

   ```
   npx wrangler secret put BREVO_API_KEY        # 第 4 步的密钥
   npx wrangler secret put BREVO_SENDER_EMAIL   # 第 3 步已验证的发件邮箱
   npx wrangler secret put BREVO_SENDER_NAME    # 发件人名称（可不填，默认用餐厅名）
   ```

   Node 服务器（自己托管的情况）用同名的环境变量。

7. 管理台 →「预约」→「邮箱验证码」：显示「已开启」后，填自己的邮箱，点「发送测试邮件」，确认能收到。

## 规则

- 验证码 6 位，**10 分钟**有效，最多试 **5 次**；数据库只保存验证码的哈希。
- 同一账户每分钟最多发 1 次，每小时最多 5 次；同一设备每分钟最多 10 次。
- 邮件语言跟随预约页的语言（中文、德文、英文），默认德文。
- 注销账户时，验证码和验证记录一起删除。

## 测试

`MAIL_OUTBOX=1` 时邮件不发出去，而是存进 `mail_outbox` 表，测试从 `GET /api/admin/mail/outbox`（经理权限）读验证码。设置了 Brevo 密钥时，这个开关不起作用。

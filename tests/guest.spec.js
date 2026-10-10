import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "./support/test.js";

/**
 * A guest's own side of the menu against the real Node server: ordering at a
 * table a waiter opened, straight to the kitchen; registering, keeping a
 * favourite, ordering for pickup, earning points once it is paid and spending
 * them on a reward. One phone project runs it, on a port of its own (the POS
 * spec has 8787), which the menu is pointed at the way a device is
 * configured by hand (zy_api_base).
 */
const PROJECT = "android-phone-portrait";
const PORT = "8788";
const API = `http://127.0.0.1:${PORT}`;
const ADMIN = "guest-e2e-admin-token";

test.describe.configure({ mode: "serial" });
test.use({ locale: "zh-CN" });

let server;
let directory;
let tableToken = "";
const admin = (request, method, url, data) => request[method](`${API}${url}`, { headers: { "x-admin-token": ADMIN }, ...(data ? { data } : {}) });

test.beforeAll(async ({ request }, testInfo) => {
  if (testInfo.project.name !== PROJECT) return;
  directory = mkdtempSync(path.join(tmpdir(), "zy-guest-e2e-"));
  server = spawn(process.execPath, ["server/index.mjs"], {
    env: { ...process.env, HOST: "127.0.0.1", PORT, ADMIN_TOKEN: ADMIN, DATABASE_PATH: path.join(directory, "db.sqlite"), UPLOAD_DIR: path.join(directory, "media"), NODE_ENV: "test" },
    stdio: "ignore"
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await request.get(`${API}/api/health`)).ok()) break; } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect((await admin(request, "put", "/api/admin/settings", {
    menuLanguages: ["zh", "en", "de"],
    customerAccounts: true,
    guestOrdering: { enabled: true, dineIn: true, pickup: true, requireOpenTable: true, minIntervalSeconds: 0 },
    loyalty: { enabled: true, pointsPerEuro: 1, rewards: [{ productId: "photo-n1-6", points: 5 }], maxRewardsPerOrder: 1 },
    reviewUrl: "https://g.page/r/chiri-kitchen/review"
  })).ok()).toBe(true);
  tableToken = (await (await admin(request, "post", "/api/admin/tables", { table: "G5" })).json()).table.token;
});

test.afterAll(() => {
  server?.kill();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== PROJECT, "one phone is enough against one server");
  await page.addInitScript((base) => {
    localStorage.setItem("zy_api_base", base);
    sessionStorage.setItem("zy_first_look", "1");
  }, API);
});

const row = (page, sku) => page.locator(".dish-card").filter({ has: page.locator(".number", { hasText: new RegExp(`^${sku}$`) }) });

test("a guest orders at the table a waiter opened, and it goes straight to the kitchen", async ({ page, request }) => {
  await page.goto(`/?table=G5&k=${tableToken}`);
  await expect(page.locator(".dish-card").first()).toBeVisible();

  // Before the waiter opens the table the cart says so at the top, while dishes are still being chosen;
  // sent anyway, the server refuses it with the same reason.
  await row(page, "R1").locator(".quick-add").click();
  await expect(page.locator("#cartBar")).toContainText("1");
  await page.locator("#cartBar").click();
  await expect(page.locator("#tableNotOpen")).toHaveText("这桌还没开台：可以先选好菜，请服务员开台后再下单");
  await page.locator("#placeOrder").click();
  await expect(page.locator("#cartSheet .cart-error")).toContainText("还没开台");

  expect((await admin(request, "post", "/api/admin/tables/G5/ordering", { open: true })).ok()).toBe(true);
  await page.locator("#cartSheet .sheet-close").click();
  // Opened: the cart no longer says it. No drink yet: it offers three, one tap each, and stops once one is in.
  await page.locator("#cartBar").click();
  await expect(page.locator("#tableNotOpen")).toHaveCount(0);
  const suggest = page.locator("#cartSuggest");
  await expect(suggest.locator("h3")).toHaveText("来点喝的？");
  await expect(suggest.locator("li")).toHaveCount(3);
  const drinkName = (await suggest.locator("li b").first().textContent()) ?? "";
  await suggest.locator("li button").first().click();
  await expect(page.locator("#cartSheet .cart-line", { hasText: drinkName })).toBeVisible();
  await expect(suggest).toHaveCount(0);
  await page.locator("#cartSheet .cart-line", { hasText: drinkName }).getByRole("button", { name: "−" }).click();
  await page.locator("#cartSheet .sheet-close").click();

  // A dish with its options and two of it, from its card.
  await row(page, "R2").click();
  const card = page.locator(".dish-detail-card");
  await expect(card).toBeVisible();
  await card.locator(".dish-options.choosing label").first().click();
  await card.locator(".detail-buy .qty button[aria-label='+']").click();
  await card.locator(".add-to-cart").click();
  await expect(page.locator("#cartBar b")).toHaveText("3");

  await page.locator("#cartBar").click();
  await expect(page.locator("#cartSheet .cart-line")).toHaveCount(2);
  await expect(page.locator("#cartSheet .cart-channel label.on")).toContainText("G5");
  await page.locator("#placeOrder").click();
  await expect(page.locator("#ordersSheet .my-order")).toHaveCount(1);
  await expect(page.locator("#ordersSheet .my-order-status")).toHaveText("已送厨");
  await expect(page.locator("#cartBar")).toHaveCount(0);

  const orders = (await (await admin(request, "get", "/api/orders")).json()).orders;
  expect(orders).toHaveLength(1);
  expect(orders[0]).toMatchObject({ table: "G5", channel: "dine-in" });
  expect(orders[0].items.reduce((sum, item) => sum + item.qty, 0)).toBe(3);
  const jobs = (await (await admin(request, "get", "/api/admin/print-jobs?status=queued")).json()).jobs;
  expect(jobs.some((job) => job.orderId === orders[0].id && job.payload.guest?.channel === "dine-in")).toBe(true);

  // The bill, called for from the table: once, however often it is asked for.
  await page.locator("#ordersSheet .sheet-close").click();
  await page.locator("#callBtn").click();
  await expect(page.locator("#serviceSheet")).toContainText("G5");
  await page.locator("#serviceSheet [data-call=pay]").click();
  await expect(page.locator(".toast")).toContainText("已通知服务员");
  await page.locator("#callBtn").click();
  await page.locator("#serviceSheet [data-call=pay]").click();
  await expect(page.locator(".toast")).toContainText("马上就来");
  const calls = (await (await admin(request, "get", "/api/service-requests")).json()).requests.filter((call) => call.table === "G5");
  expect(calls.map((call) => [call.type, call.status])).toEqual([["pay", "open"]]);
});

test("a guest leaves out an allergen: the dishes with it are hidden everywhere, and back with one tap", async ({ page }) => {
  await page.goto("/");
  await expect(row(page, "R4")).toBeVisible();
  await page.locator("#allergenFilterBtn").click();
  const filter = page.locator("#allergenFilter");
  await expect(filter).toContainText("如有严重过敏，请再告诉服务员");
  await filter.locator("label", { hasText: "甲壳类" }).click();
  // 虾仁拉面 (B) is gone; 蔬菜拉面 stays; the bar says what is hidden.
  await expect(row(page, "R4")).toHaveCount(0);
  await expect(row(page, "R1")).toBeVisible();
  await expect(page.locator("#allergenFilterBar")).toContainText("已隐藏含 甲壳类 的菜");
  await expect(page.locator("#allergenFilterBtn")).toHaveText("⚠ 过敏原筛选 · 1");
  // A search does not bring it back.
  await page.locator("#searchBtn").click();
  await page.locator("#searchInput").fill("虾");
  await expect(row(page, "R4")).toHaveCount(0);
  await page.locator("#clearSearch").click();
  // Kept on this phone for the next visit, and cleared with one tap.
  await page.reload();
  await expect(page.locator("#allergenFilterBar")).toBeVisible();
  await page.locator("#allergenFilterBar").getByRole("button", { name: "全部显示" }).click();
  await expect(row(page, "R4")).toBeVisible();
  await expect(page.locator("#allergenFilterBar")).toHaveCount(0);
});

test("a phone that scanned no table card has no one to call", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".dish-card").first()).toBeVisible();
  await expect(page.locator("#callBtn")).toHaveCount(0);
});

test("signing up with a mobile number brings 20 points, said before and after", async ({ page }) => {
  await page.goto(`/?table=G5&k=${tableToken}`);
  await expect(page.locator(".dish-card").first()).toBeVisible();
  await page.locator("#accountBtn").click();
  const sheet = page.locator("#accountSheet");
  await expect(sheet.locator("#signupBonusHint")).toHaveText("新用户注册即送 20 积分");
  await sheet.getByRole("tab", { name: "注册" }).click();
  // A landline is said in words; a mobile number goes through, no "@" needed.
  await sheet.locator("input[name=email]").fill("01 5877777");
  await sheet.locator("input[name=password]").fill("dumplings");
  await sheet.locator("input[name=password-repeat]").fill("dumplings");
  await sheet.locator("button[type=submit]").click();
  await expect(sheet.locator(".cart-error")).toHaveText("请填写手机号，不是座机号码");
  await sheet.locator("input[name=email]").fill("0699 222 33 44");
  await sheet.locator("button[type=submit]").click();
  await expect(sheet.locator("#signupBonusGot")).toHaveText("注册成功，已赠送 20 积分");
  await expect(sheet.locator(".points-balance b")).toHaveText("20");
});

test("a guest registers, keeps a favourite, orders for pickup, earns points and spends them on a reward", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator(".dish-card").first()).toBeVisible();

  await page.locator("#accountBtn").click();
  const sheet = page.locator("#accountSheet");
  await sheet.getByRole("tab", { name: "注册" }).click();
  await sheet.locator("input[name=email]").fill("mei@example.com");
  await sheet.locator("input[name=name]").fill("Mei");
  await sheet.locator("input[name=password]").fill("noodles-4-life");
  await sheet.locator("input[name=password-repeat]").fill("noodles-4-life");
  // What is kept and what they may do about it, before they sign up (GDPR Art. 13).
  await expect(sheet).toContainText("注册即表示你已阅读隐私说明");
  await sheet.locator(".privacy-notice summary").click();
  await expect(sheet.locator(".privacy-notice p")).toContainText("下载全部数据");
  await sheet.locator("button[type=submit]").click();
  await expect(sheet.locator(".guest-card")).toContainText("你好，Mei");
  // Signing up brings 20 points, wherever it is done.
  await expect(sheet.locator(".points-balance b")).toHaveText("20");
  await sheet.locator(".sheet-close").click();

  // A favourite: the heart on the dish's card, and a page of their own.
  await row(page, "R1").click();
  await page.locator(".favorite-toggle").click();
  await expect(page.locator(".favorite-toggle")).toHaveAttribute("aria-pressed", "true");
  await page.locator(".detail-close").click();
  await expect(page.locator(".chip", { hasText: "♥ 收藏" })).toBeVisible();

  // Pickup: no table scanned, so it is the only way.
  await row(page, "R1").locator(".quick-add").click();
  await page.locator("#cartBar").click();
  await expect(page.locator("#cartSheet .cart-channel label")).toHaveText(["外带自取"]);
  await page.locator("#placeOrder").click();
  await expect(page.locator("#ordersSheet .pickup-no b")).toHaveText(/^\d+$/);
  const pickupNo = await page.locator("#ordersSheet .pickup-no b").textContent();

  // Paid at the counter: 12.50 is 12 points more.
  const table = `TA-${pickupNo}`;
  const bill = (await (await admin(request, "get", `/api/admin/tables/${table}/bill`)).json()).bill;
  const paid = await admin(request, "post", "/api/admin/checkout", { table, items: bill.items.map((line) => ({ orderItemId: line.orderItemId, quantity: line.qty })), payments: [{ type: "cash", amount: bill.total }] });
  expect(paid.status()).toBe(201);

  await page.reload();
  // Paid: asked once for a review, on the page the owner set; not again once answered.
  const review = page.locator("#reviewPrompt");
  await expect(review).toContainText("吃得满意吗？");
  await expect(review.getByRole("link", { name: /去评价/ })).toHaveAttribute("href", "https://g.page/r/chiri-kitchen/review");
  await review.getByRole("button", { name: "以后再说" }).click();
  await expect(review).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".dish-card").first()).toBeVisible();
  await expect(page.locator("#reviewPrompt")).toHaveCount(0);
  await page.locator("#accountBtn").click();
  await expect(sheet.locator(".points-balance b")).toHaveText("32");
  await sheet.locator(".reward-list button", { hasText: "兑换" }).click();
  await expect(page.locator("#cartSheet .cart-line.reward")).toContainText("5 积分");
  await page.locator("#placeOrder").click();
  await expect(page.locator("#ordersSheet .my-order")).toHaveCount(2);
  await page.locator("#ordersSheet .sheet-close").click();
  await page.locator("#accountBtn").click();
  await expect(sheet.locator(".points-balance b")).toHaveText("27");

  // Their own copy of everything kept about them, as one file.
  const [download] = await Promise.all([page.waitForEvent("download"), sheet.getByRole("button", { name: "⬇ 下载我的数据" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^my-data-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(await (await download.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString("utf8")));
  expect(data.format).toBe("zhaoyun-customer-export/1");
  expect(data.account.email).toBe("mei@example.com");
  expect(data.orders).toHaveLength(2);
  expect(data.favorites).toHaveLength(1);
  expect(data.points.map((entry) => entry.reason).sort()).toEqual(["adjust", "earn", "redeem"]);
});

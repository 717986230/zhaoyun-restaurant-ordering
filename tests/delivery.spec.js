import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "./support/test.js";

/**
 * A delivery platform's order against the real Node server: the platform
 * calls our webhook with its secret, the POS chimes and shows it, the waiter
 * accepts it for 30 minutes, marks it ready and handed over; the console's
 * delivery tab finds it, says which platform is connected, and sends a test
 * order. One tablet project runs it, on a port of its own.
 */
const PROJECT = "android-tablet-landscape";
const PORT = "8790";
const API = `http://127.0.0.1:${PORT}`;
const ADMIN = "delivery-e2e-admin-token";
const SECRET = "delivery-e2e-webhook-secret-0123456789";
const LOGIN = "zhaoyun";
const PASSWORD = "chef-password";

test.describe.configure({ mode: "serial" });
test.use({ locale: "zh-CN" });

let server;
let directory;
const admin = (request, method, url, data) => request[method](`${API}${url}`, { headers: { "x-admin-token": ADMIN }, ...(data ? { data } : {}) });

test.beforeAll(async ({ request }, testInfo) => {
  if (testInfo.project.name !== PROJECT) return;
  directory = mkdtempSync(path.join(tmpdir(), "zy-delivery-e2e-"));
  server = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env, HOST: "127.0.0.1", PORT, ADMIN_TOKEN: ADMIN, DATABASE_PATH: path.join(directory, "db.sqlite"), UPLOAD_DIR: path.join(directory, "media"), NODE_ENV: "test",
      LIEFERANDO_WEBHOOK_SECRET: SECRET
    },
    stdio: "ignore"
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await request.get(`${API}/api/health`)).ok()) break; } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect((await request.post(`${API}/api/account/register`, { data: { login: LOGIN, name: "Chef", password: PASSWORD } })).status()).toBe(201);
  expect((await admin(request, "post", "/api/admin/staff", { name: "Li", pin: "1234", role: "staff" })).ok()).toBe(true);
  expect((await admin(request, "put", "/api/admin/settings", {
    showOrdering: true,
    delivery: { lieferando: { enabled: true, autoAccept: false, prepMinutes: 20, storeId: "" }, foodora: { enabled: false, autoAccept: false, prepMinutes: 20, storeId: "" } }
  })).ok()).toBe(true);
});

test.afterAll(() => {
  server?.kill();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== PROJECT, "one tablet is enough against one server");
  await page.addInitScript((base) => localStorage.setItem("zy_api_base", base), API);
});

test("a Lieferando order reaches the POS; the waiter accepts it for 30 minutes, then ready, then picked up", async ({ page, request }) => {
  await page.goto("/pos.html");
  await page.getByLabel(/设备名称/).fill("Counter");
  await page.getByLabel("账户名").fill(LOGIN);
  await page.getByLabel("账户密码").fill(PASSWORD);
  await page.getByRole("button", { name: "配对" }).click();
  await page.getByRole("button", { name: "Li", exact: true }).click();
  for (const digit of "1234") await page.locator(".pos-keypad").getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: "OK" }).click();
  await expect(page.locator(".pos-who")).toContainText("Li");

  // The platform calls, with its secret.
  const sent = await request.post(`${API}/api/delivery/lieferando/orders`, {
    headers: { authorization: `Bearer ${SECRET}` },
    data: {
      OrderId: "jet-e2e-1", FriendlyOrderReference: "E2E101",
      Fulfilment: { Method: "Delivery", DueDate: new Date(Date.now() + 45 * 60_000).toISOString(), Address: { Lines: ["Mariahilfer Straße 5"], PostalCode: "1060", City: "Wien" } },
      Customer: { Name: "Anna" }, Notes: "Bitte klingeln",
      Items: [{ Reference: "R1", Name: "Ramen", Quantity: 2, UnitPrice: 12.5, Items: [{ Name: "Extra Ei", Quantity: 1, UnitPrice: 1.5 }] }],
      TotalPrice: 26.5
    }
  });
  expect(sent.status()).toBe(201);

  const card = page.locator('.pos-delivery [data-delivery="E2E101"]');
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toHaveAttribute("data-status", "new");
  await expect(card).toContainText("Lieferando");
  await expect(card).toContainText("2 × Ramen");
  await expect(card).toContainText("Extra Ei");
  await expect(card).toContainText("Bitte klingeln");

  await card.getByRole("button", { name: "30 分", exact: true }).click();
  await card.getByRole("button", { name: "接单 · 30 分钟" }).click();
  await expect(card).toHaveAttribute("data-status", "accepted");
  await card.getByRole("button", { name: "出餐" }).click();
  await expect(card).toHaveAttribute("data-status", "ready");
  await card.getByRole("button", { name: "已取走" }).click();
  await expect(card).toHaveCount(0);
});

test("the console's delivery tab finds the order, shows the connection and sends a test order", async ({ page }) => {
  await page.addInitScript((token) => sessionStorage.setItem("zy_admin_token", token), ADMIN);
  await page.goto("/admin.html");
  await page.getByRole("navigation", { name: "管理模块" }).getByRole("button", { name: "外卖" }).click();
  await expect(page.locator("#deliveryPanel")).toBeVisible();

  const row = page.locator('#dlOrders tr[data-delivery="E2E101"]');
  await expect(row).toContainText("已完成");
  await expect(page.locator('#dlTotals [data-provider="lieferando"]')).toContainText("1 单");
  await row.getByRole("button", { name: "详情" }).click();
  await expect(page.locator("#dlRecord")).toContainText("Mariahilfer Straße 5, 1060 Wien");
  await page.locator("#dlRecord").getByRole("button", { name: "关闭" }).click();

  // Folded away once a platform is on: the orders are what the day needs.
  await page.locator(".dl-settings summary").click();
  const lieferando = page.locator('.dl-platform[data-provider="lieferando"]');
  await expect(lieferando).toContainText("平台推单：已配置密钥");
  await expect(lieferando).toContainText("回传平台：还没配置（LIEFERANDO_API_KEY）");
  await expect(lieferando.locator("input[readonly]").first()).toHaveValue(`${API}/api/delivery/lieferando/orders`);
  await expect(page.locator('.dl-platform[data-provider="foodora"]')).toContainText("还没配置密钥（FOODORA_WEBHOOK_SECRET）");

  await lieferando.getByRole("button", { name: "发一张测试单" }).click();
  await expect(page.locator("#dlOrders tbody tr")).toHaveCount(2);
  await expect(page.locator("#dlOrders tbody tr").first()).toContainText("测试单");
});

test("每日限量 on the POS: two left today, sold out at the count; the kitchen board shows a platform order and when it is due", async ({ page, request }) => {
  const dish = (await (await request.get(`${API}/api/catalog`)).json()).products.find((product) => !product.bundleItems?.length && !product.modifiers?.length);

  await page.goto("/pos.html");
  await page.getByLabel(/设备名称/).fill("Counter 2");
  await page.getByLabel("账户名").fill(LOGIN);
  await page.getByLabel("账户密码").fill(PASSWORD);
  await page.getByRole("button", { name: "配对" }).click();
  await page.getByRole("button", { name: "Li", exact: true }).click();
  for (const digit of "1234") await page.locator(".pos-keypad").getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: "OK" }).click();
  await page.getByLabel("打开桌号").fill("7");
  await page.getByRole("button", { name: "打开", exact: true }).click();

  // "Two left today": the 限量 mode, a tap on the dish, the number.
  const tile = page.locator(`.pos-dishes button[data-sku="${dish.sku}"]`);
  await page.getByRole("button", { name: "限量", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept("2"));
  await tile.click();
  await expect(tile.locator(".pos-stock-left")).toHaveText("剩 2");
  await page.getByRole("button", { name: /^完成（点菜品设/ }).click();

  // The guests see it too, while it lasts.
  expect((await (await request.get(`${API}/api/catalog`)).json()).products.find((product) => product.id === dish.id).leftToday).toBe(2);

  // Two on the order; a third is refused on the spot.
  await tile.click();
  await tile.click();
  await tile.click();
  await expect(page.locator(".pos-toast")).toContainText("今天只剩 2 份");
  await expect(page.locator(".pos-lines.new li")).toContainText("2");
  await page.getByRole("button", { name: "送厨" }).click();
  await expect(page.locator(".pos-toast")).toContainText("已送厨：2 道菜");
  await expect(tile).toHaveClass(/soldout/);
  await expect(tile).toContainText("今日售完");
  expect((await (await request.get(`${API}/api/catalog`)).json()).products.some((product) => product.id === dish.id)).toBe(false);

  // A platform order accepted for 25 minutes is on the kitchen board, due by then.
  const sent = await request.post(`${API}/api/delivery/lieferando/orders`, {
    headers: { authorization: `Bearer ${SECRET}` },
    data: { OrderId: "jet-e2e-2", FriendlyOrderReference: "E2E202", Items: [{ Name: "Gyoza", Quantity: 3, UnitPrice: 6 }] }
  });
  expect((await admin(request, "post", `/api/admin/delivery/orders/${(await sent.json()).id}/accept`, { prepMinutes: 25 })).ok()).toBe(true);
  await page.addInitScript((token) => sessionStorage.setItem("zy_admin_token", token), ADMIN);
  await page.goto("/admin.html");
  await page.getByRole("navigation", { name: "管理模块" }).getByRole("button", { name: "订单" }).click();
  const card = page.locator('#boardDelivery [data-delivery="E2E202"]');
  await expect(card).toContainText("3 × Gyoza");
  await expect(card).toContainText("前出餐");
  await card.getByRole("button", { name: "出餐" }).click();
  await expect(card).toHaveAttribute("data-status", "ready");
});

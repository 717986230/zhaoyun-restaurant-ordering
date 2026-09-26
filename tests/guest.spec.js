import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

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
    loyalty: { enabled: true, pointsPerEuro: 1, rewards: [{ productId: "photo-n1-6", points: 5 }], maxRewardsPerOrder: 1 }
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

  // Before the waiter opens the table the menu takes the order, and the server refuses it with a reason.
  await row(page, "R1").locator(".quick-add").click();
  await expect(page.locator("#cartBar")).toContainText("1");
  await page.locator("#cartBar").click();
  await page.locator("#placeOrder").click();
  await expect(page.locator("#cartSheet .cart-error")).toContainText("还没开台");

  expect((await admin(request, "post", "/api/admin/tables/G5/ordering", { open: true })).ok()).toBe(true);
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
  await sheet.locator("button[type=submit]").click();
  await expect(sheet.locator(".guest-card")).toContainText("你好，Mei");
  await expect(sheet.locator(".points-balance b")).toHaveText("0");
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

  // Paid at the counter: 12.50 is 12 points.
  const table = `TA-${pickupNo}`;
  const bill = (await (await admin(request, "get", `/api/admin/tables/${table}/bill`)).json()).bill;
  const paid = await admin(request, "post", "/api/admin/checkout", { table, items: bill.items.map((line) => ({ orderItemId: line.orderItemId, quantity: line.qty })), payments: [{ type: "cash", amount: bill.total }] });
  expect(paid.status()).toBe(201);

  await page.reload();
  await page.locator("#accountBtn").click();
  await expect(sheet.locator(".points-balance b")).toHaveText("12");
  await sheet.locator(".reward-list button", { hasText: "兑换" }).click();
  await expect(page.locator("#cartSheet .cart-line.reward")).toContainText("5 积分");
  await page.locator("#placeOrder").click();
  await expect(page.locator("#ordersSheet .my-order")).toHaveCount(2);
  await page.locator("#ordersSheet .sheet-close").click();
  await page.locator("#accountBtn").click();
  await expect(sheet.locator(".points-balance b")).toHaveText("7");
});

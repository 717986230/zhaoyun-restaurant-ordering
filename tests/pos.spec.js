import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

/**
 * The POS against the real Node server, not stubs: pairing, a waiter's PIN,
 * ordering by dish number, the kitchen, paying separately and then together,
 * the table lock between two devices, a takeaway with its discount, and the
 * waiter's settlement. One project runs it; the rest of the matrix is the
 * other specs' job, and one server on the API port is all there can be.
 */
const PROJECT = "android-tablet-landscape";
const API = "http://127.0.0.1:8787";
const ADMIN = "pos-e2e-admin-token";
const LOGIN = "zhaoyun";
const PASSWORD = "chef-password";

test.describe.configure({ mode: "serial" });
test.use({ locale: "zh-CN" });

let server;
let directory;
const admin = (request, method, url, data) => request[method](`${API}${url}`, { headers: { "x-admin-token": ADMIN }, ...(data ? { data } : {}) });

test.beforeAll(async ({ request }, testInfo) => {
  if (testInfo.project.name !== PROJECT) return;
  directory = mkdtempSync(path.join(tmpdir(), "zy-pos-e2e-"));
  server = spawn(process.execPath, ["server/index.mjs"], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: "8787", ADMIN_TOKEN: ADMIN, DATABASE_PATH: path.join(directory, "db.sqlite"), UPLOAD_DIR: path.join(directory, "media"), NODE_ENV: "test" },
    stdio: "ignore"
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await request.get(`${API}/api/health`)).ok()) break; } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect((await request.post(`${API}/api/account/register`, { data: { login: LOGIN, name: "Chef", password: PASSWORD } })).status()).toBe(201);
  for (const [name, pin, role] of [["Li", "1234", "staff"], ["Wang", "9876", "manager"]]) {
    expect((await admin(request, "post", "/api/admin/staff", { name, pin, role })).ok()).toBe(true);
  }
  expect((await admin(request, "put", "/api/admin/settings", { takeawayDiscountPercent: 10, showOrdering: true })).ok()).toBe(true);
});

test.afterAll(() => {
  server?.kill();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

/** A dish with options opens the options first; "加入" takes it as it comes. */
async function confirmOptions(page) {
  const dialog = page.getByRole("dialog", { name: "请选择" });
  if (await dialog.isVisible()) await dialog.getByRole("button", { name: "加入" }).click();
}

async function pairAndSignIn(page, device, name, pin) {
  await page.goto("/pos.html");
  await page.getByLabel(/设备名称/).fill(device);
  await page.getByLabel("账户名").fill(LOGIN);
  await page.getByLabel("账户密码").fill(PASSWORD);
  await page.getByRole("button", { name: "配对" }).click();
  await page.getByRole("button", { name, exact: true }).click();
  for (const digit of pin) await page.locator(".pos-keypad").getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: "OK" }).click();
  await expect(page.locator(".pos-who")).toContainText(name);
}

test("a waiter orders by number, the kitchen gets it, and the table pays separately, then together", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== PROJECT, "one server, one project");
  const products = (await (await request.get(`${API}/api/catalog`)).json()).products.filter((product) => !product.bundleItems?.length);
  const [first, second] = products.filter((product) => product.kind === "food");

  await pairAndSignIn(page, "Tablet counter", "Li", "1234");
  await page.getByLabel("打开桌号").fill("5");
  await page.getByRole("button", { name: "打开", exact: true }).click();
  await expect(page.locator(".pos-ticket h1")).toHaveText("桌 5");

  // By number, the way the menu is read out; and by tapping.
  await page.getByLabel("菜号 / 搜索").fill(first.sku.toLowerCase());
  await page.getByLabel("菜号 / 搜索").press("Enter");
  await confirmOptions(page);
  await page.getByLabel("菜号 / 搜索").fill(first.sku);
  await page.getByLabel("菜号 / 搜索").press("Enter");
  await confirmOptions(page);
  await page.locator(`.pos-dishes button[data-sku="${second.sku}"]`).click();
  await confirmOptions(page);
  await expect(page.locator(".pos-lines.new li")).toHaveCount(2);
  await expect(page.locator(".pos-lines.new li").first()).toContainText("2");
  await page.getByPlaceholder(/备注/).fill("少辣");
  await page.getByRole("button", { name: "送厨" }).click();
  await expect(page.locator(".pos-toast")).toContainText("已送厨：3 道菜");
  await expect(page.locator(".pos-lines.sent li")).toHaveCount(2);

  const jobs = (await (await admin(request, "get", "/api/admin/print-jobs?status=queued&limit=50")).json()).jobs;
  const ticket = jobs.find((job) => job.payload.table === "5");
  expect(ticket.payload.staffName).toBe("Li");
  expect(ticket.payload.note).toBe("少辣");
  expect(JSON.stringify(ticket.payload)).not.toContain("price");

  // Separately: the first guest pays one bowl in cash, with a 50 note.
  await page.getByRole("button", { name: "结账" }).click();
  await page.getByRole("button", { name: "分开结" }).click();
  await page.locator(".pos-lines.pay li", { hasText: first.names.zh }).getByRole("button", { name: "+" }).click();
  await expect(page.locator(".pos-total b")).toHaveText(new RegExp(first.price.toFixed(2).replace(".", "\\.")));
  await page.getByRole("button", { name: "+ 现金" }).click();
  await page.getByLabel("收到现金").fill("50");
  await expect(page.locator(".pos-change")).toContainText(`找零 €${(50 - first.price).toFixed(2)}`);
  await page.getByRole("button", { name: "收款并开小票" }).click();
  await expect(page.locator(".pos-toast")).toContainText(`找零 €${(50 - first.price).toFixed(2)}`);
  await expect(page.locator(".pos-lines.pay li", { hasText: first.names.zh })).toContainText("0/1");

  // Together: the rest by card; the table is paid and the floor shows it free.
  await page.getByRole("button", { name: "一起结" }).click();
  const rest = first.price + second.price;
  await expect(page.locator(".pos-total b")).toHaveText(new RegExp(rest.toFixed(2).replace(".", "\\.")));
  await page.getByRole("button", { name: "+ 银行卡" }).click();
  await page.getByRole("button", { name: "收款并开小票" }).click();
  await expect(page.locator(".pos-toast")).toContainText("桌 5 已结清");
  await expect(page.locator(".pos-floor")).toBeVisible();

  const receipts = (await (await admin(request, "get", "/api/admin/receipts?limit=10")).json()).receipts;
  expect(receipts.map((receipt) => receipt.staffName)).toEqual(["Li", "Li"]);
  expect(receipts[1].payments[0]).toMatchObject({ type: "cash", tenderedCents: 5000 });
});

test("a table open on one device is locked to it; the manager may take it over", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== PROJECT, "one server, one project");
  const counter = await browser.newPage({ locale: "zh-CN" });
  const phone = await browser.newPage({ locale: "zh-CN" });
  await pairAndSignIn(counter, "Tablet A", "Li", "1234");
  await pairAndSignIn(phone, "Phone B", "Wang", "9876");

  await counter.getByLabel("打开桌号").fill("8");
  await counter.getByRole("button", { name: "打开", exact: true }).click();
  await expect(counter.locator(".pos-ticket h1")).toHaveText("桌 8");

  // Wang is the manager: asked first, and refusing leaves Li's table alone.
  phone.once("dialog", (dialog) => dialog.dismiss());
  await phone.getByLabel("打开桌号").fill("8");
  await phone.getByRole("button", { name: "打开", exact: true }).click();
  await expect(phone.locator(".pos-toast")).toContainText("Li");
  await expect(phone.locator(".pos-floor")).toBeVisible();

  phone.once("dialog", (dialog) => dialog.accept());
  await phone.getByRole("button", { name: "打开", exact: true }).click();
  await expect(phone.locator(".pos-ticket h1")).toHaveText("桌 8");
  await counter.close();
  await phone.close();
});

test("an order sent on one tablet shows at once on the other and on the admin board", async ({ browser, request }, testInfo) => {
  test.skip(testInfo.project.name !== PROJECT, "one server, one project");
  const [dish] = (await (await request.get(`${API}/api/catalog`)).json()).products.filter((product) => product.kind === "food" && !product.bundleItems?.length);
  const counter = await browser.newPage({ locale: "zh-CN" });
  const phone = await browser.newPage({ locale: "zh-CN" });
  const office = await browser.newPage({ locale: "zh-CN" });
  await pairAndSignIn(counter, "Tablet live A", "Li", "1234");
  await pairAndSignIn(phone, "Phone live B", "Wang", "9876");
  const { token } = await (await request.post(`${API}/api/account/sign-in`, { data: { login: LOGIN, password: PASSWORD } })).json();
  await office.addInitScript((session) => sessionStorage.setItem("zy_admin_token", session), token);
  await office.goto("/admin.html");
  await office.getByRole("navigation", { name: "管理模块" }).getByRole("button", { name: "订单", exact: true }).click();
  await expect(phone.locator(".pos-live.on")).toBeVisible();
  await expect(office.locator(".admin-status.live")).toBeVisible();

  // Faster than any poll (8 s without the channel, 30 s with it): pushed.
  const LIVE = { timeout: 3000 };
  await counter.getByLabel("打开桌号").fill("9");
  await counter.getByRole("button", { name: "打开", exact: true }).click();
  await counter.locator(`.pos-dishes button[data-sku="${dish.sku}"]`).click();
  await confirmOptions(counter);
  await counter.getByRole("button", { name: "送厨" }).click();
  await expect(counter.locator(".pos-lines.sent li")).toHaveCount(1);

  await expect(phone.locator('.pos-table[data-table="9"]')).toContainText(dish.price.toFixed(2), LIVE);
  await expect(phone.locator('.pos-table[data-table="9"]')).toContainText("Li", LIVE);
  await expect(office.locator(".board-card", { hasText: "桌 9" })).toContainText(dish.names.zh, LIVE);
  await expect(office.locator(".board-card", { hasText: "桌 9" })).toContainText("· Li");

  // The room, as the manager sees it: who has table 9 open, and each waiter now.
  await office.getByRole("navigation", { name: "管理模块" }).getByRole("button", { name: "桌位", exact: true }).click();
  await expect(office.locator(".table-tile", { hasText: "桌 9" }).locator(".table-open-on")).toHaveText("Li 正在操作");
  const li = office.locator('.staff-live-card[data-staff="Li"]');
  await expect(li).toHaveClass(/online/);
  await expect(li).toContainText("Tablet live A");
  await expect(li).toContainText("开着：9");
  // Li leaves the table: the manager's view follows without a reload.
  await counter.getByRole("button", { name: "← 返回" }).click();
  await expect(li).toContainText("没有开着的桌", LIVE);
  await Promise.all([counter.close(), phone.close(), office.close()]);
});

test("a takeaway gets a pickup number and its discount; the waiter settles the shift", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== PROJECT, "one server, one project");
  const [dish] = (await (await request.get(`${API}/api/catalog`)).json()).products.filter((product) => product.kind === "food" && !product.bundleItems?.length);
  await pairAndSignIn(page, "Tablet takeaway", "Li", "1234");

  await page.getByRole("button", { name: "+ 外带自取" }).click();
  await expect(page.locator(".pos-ticket h1")).toHaveText(/取餐号 \d+/);
  await page.locator(`.pos-dishes button[data-sku="${dish.sku}"]`).click();
  await confirmOptions(page);
  await page.getByRole("button", { name: "送厨" }).click();
  await expect(page.locator(".pos-lines.sent li")).toHaveCount(1);
  const job = (await (await admin(request, "get", "/api/admin/print-jobs?status=queued&limit=100")).json()).jobs.find((entry) => /^TA-/.test(entry.payload.table ?? ""));
  expect(job.payload.pickupNo).toBeGreaterThan(0);

  await page.getByRole("button", { name: "结账" }).click();
  await expect(page.getByLabel("折扣 %")).toHaveValue("10");
  const cents = Math.round(dish.price * 100);
  const due = cents - Math.round(cents * 0.1);
  await expect(page.locator(".pos-total b")).toHaveText(new RegExp((due / 100).toFixed(2).replace(".", "\\.")));
  await page.getByRole("button", { name: "+ 现金" }).click();
  await page.getByRole("button", { name: "收款并开小票" }).click();
  await expect(page.locator(".pos-toast")).toContainText("已结清");

  // The shift's end: the cash Li took, handed in.
  await page.getByRole("button", { name: "记录与结算" }).click();
  await expect(page.locator(".pos-records")).toContainText("应交现金");
  await page.getByRole("button", { name: "结算并打印" }).click();
  await expect(page.locator(".pos-toast")).toContainText("Li 已结算");
  await expect(page.locator(".pos-records")).toContainText("上次结算以后没有小票");
  const receipt = (await (await admin(request, "get", "/api/admin/receipts?limit=1")).json()).receipts[0];
  expect(receipt.lines.find((line) => line.kind === "discount").totalCents).toBe(-(cents - due));
});

test("the manager cancels a receipt with a reason, closes the day, and exports a journal that checks out", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== PROJECT, "one server, one project");
  await pairAndSignIn(page, "Tablet office", "Wang", "9876");
  await page.getByRole("button", { name: "记录与结算" }).click();
  const records = page.locator(".pos-records");

  // The takeaway's receipt (the third today), cancelled by a storno of its own.
  page.once("dialog", (dialog) => dialog.accept("wrong order"));
  await records.locator('.pos-receipts li[data-receipt="3"]').getByRole("button", { name: "冲销" }).click();
  await expect(page.locator(".pos-toast")).toContainText("小票 3 已冲销");
  await expect(records.locator('.pos-receipts li[data-receipt="4"]')).toContainText("冲销小票 3 · wrong order");
  await expect(records.locator('.pos-receipts li[data-receipt="3"]')).toContainText("已冲销");

  await expect(records).toContainText("3 笔销售、1 笔冲销，小票 1–4");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "日结并打印" }).click();
  await expect(page.locator(".pos-toast")).toContainText("日结 Z 1 已完成");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 CSV" }).click();
  expect((await download).suggestedFilename()).toMatch(/^journal-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/);
  await expect(records.locator(".pos-journal")).toHaveText(/^已校验 \d+ 条，链条完整$/);
});

test("a sent dish is voided with a reason, a dish sold out and back, and a receipt printed again", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== PROJECT, "one server, one project");
  const [dish, other] = (await (await request.get(`${API}/api/catalog`)).json()).products.filter((product) => product.kind === "food" && !product.bundleItems?.length);
  await pairAndSignIn(page, "Tablet void", "Li", "1234");
  await page.getByLabel("打开桌号").fill("12");
  await page.getByRole("button", { name: "打开", exact: true }).click();
  for (let n = 0; n < 2; n += 1) {
    await page.locator(`.pos-dishes button[data-sku="${dish.sku}"]`).click();
    await confirmOptions(page);
  }
  await page.getByRole("button", { name: "送厨" }).click();
  await expect(page.locator(".pos-lines.sent li")).toContainText("2 ×");

  // 退菜: one of the two, with a reason; the kitchen gets a void ticket.
  await page.getByRole("button", { name: `退菜：${dish.names.zh}` }).click();
  const dialog = page.getByRole("dialog", { name: "退菜" });
  await expect(dialog.getByRole("button", { name: "确认退菜" })).toBeDisabled();
  await dialog.getByRole("button", { name: "客人取消" }).click();
  await dialog.getByRole("button", { name: "确认退菜" }).click();
  await expect(page.locator(".pos-toast")).toContainText(`已退 1 份 ${dish.names.zh}`);
  await expect(page.locator(".pos-lines.sent li")).toContainText("1 ×");
  const jobs = (await (await admin(request, "get", "/api/admin/print-jobs?status=queued&limit=200")).json()).jobs;
  expect(jobs.some((job) => job.payload.kind === "void" && job.payload.table === "12" && job.payload.reason === "客人取消")).toBe(true);

  // 沽清: the other dish off, the guests' menu without it, then back on.
  await page.getByRole("button", { name: "沽清 / 恢复" }).click();
  await page.locator(`.pos-dishes button[data-sku="${other.sku}"]`).click();
  await expect(page.locator(".pos-toast")).toContainText(`${other.names.zh} 已沽清`);
  await expect(page.locator(`.pos-dishes button[data-sku="${other.sku}"]`)).toHaveClass(/soldout/);
  expect((await (await request.get(`${API}/api/catalog`)).json()).products.some((product) => product.id === other.id)).toBe(false);
  await page.locator(`.pos-dishes button[data-sku="${other.sku}"]`).click();
  await expect(page.locator(`.pos-dishes button[data-sku="${other.sku}"]`)).not.toHaveClass(/soldout/);
  await page.getByRole("button", { name: /完成/ }).click();

  // Paid, and the receipt printed again for the guest as a copy.
  await page.getByRole("button", { name: "结账" }).click();
  await page.getByRole("button", { name: "+ 银行卡" }).click();
  await page.getByRole("button", { name: "收款并开小票" }).click();
  await expect(page.locator(".pos-toast")).toContainText("桌 12 已结清");
  await page.getByRole("button", { name: "记录与结算" }).click();
  await page.locator(".pos-receipts li").first().getByRole("button", { name: "补打" }).click();
  await expect(page.locator(".pos-toast")).toContainText("已补打");
  await expect(page.locator(".pos-voids")).toContainText("退菜 1 份");
});

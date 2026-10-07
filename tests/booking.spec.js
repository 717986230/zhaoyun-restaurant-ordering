import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "./support/test.js";

/**
 * Booking a table online against the real Node server: a guest signs up,
 * picks the day, the time and their own table, sees the booking and cancels
 * it; the per-guest limits say no in words; the floor finds the booking in
 * the console's records. One phone project runs it, on a port of its own.
 */
const PROJECT = "android-phone-portrait";
const PORT = "8789";
const API = `http://127.0.0.1:${PORT}`;
const ADMIN = "booking-e2e-admin-token";

test.describe.configure({ mode: "serial" });
test.use({ locale: "zh-CN" });

let server;
let directory;
const admin = (request, method, url, data) => request[method](`${API}${url}`, { headers: { "x-admin-token": ADMIN }, ...(data ? { data } : {}) });

test.beforeAll(async ({ request }, testInfo) => {
  if (testInfo.project.name !== PROJECT) return;
  directory = mkdtempSync(path.join(tmpdir(), "zy-booking-e2e-"));
  server = spawn(process.execPath, ["server/index.mjs"], {
    env: { ...process.env, HOST: "127.0.0.1", PORT, ADMIN_TOKEN: ADMIN, DATABASE_PATH: path.join(directory, "db.sqlite"), UPLOAD_DIR: path.join(directory, "media"), NODE_ENV: "test", MAIL_OUTBOX: "1" },
    stdio: "ignore"
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await request.get(`${API}/api/health`)).ok()) break; } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const saved = await admin(request, "put", "/api/admin/settings", {
    reservations: {
      enabled: true,
      hours: [{ days: [1, 2, 3, 4, 5, 6, 7], from: "12:00", to: "21:00" }],
      intervalMinutes: 30, durationMinutes: 120, capacity: 40, maxParty: 8, leadMinutes: 60, daysAhead: 30,
      autoConfirm: true, closedDates: [], note: "8 人以上请致电",
      tables: [{ table: "2", seats: 2 }, { table: "4", seats: 4 }, { table: "6", seats: 6 }],
      maxActivePerGuest: 2, maxPerDayPerGuest: 1, noShowLimit: 2
    }
  });
  expect(saved.ok()).toBe(true);
});

test.afterAll(() => {
  server?.kill();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== PROJECT, "one phone is enough against one server");
  await page.addInitScript((base) => localStorage.setItem("zy_api_base", base), API);
});

test("a guest signs up, picks day, time and table, sees the booking and cancels it; the limits say no in words", async ({ page, request }) => {
  await page.goto("/book.html?lang=zh");
  await expect(page.getByRole("heading", { name: "预约餐桌" })).toBeVisible();

  // Nothing is booked without an account.
  await expect(page.locator("#bookingSignIn")).toBeVisible();
  await expect(page.locator("#bookingSubmit")).toHaveCount(0);
  await page.getByRole("tab", { name: "注册" }).click();
  await page.locator("#bookingEmailLogin").fill("mia@example.com");
  await page.locator("#bookingPassword").fill("secret123");
  await page.locator("#bookingSignInSubmit").click();
  await expect(page.locator("#bookingAccount")).toContainText("mia@example.com");

  // The email proved first: a code to it, typed back (read here from the test server's outbox).
  await expect(page.locator("#bookingVerify")).toContainText("mia@example.com");
  await expect(page.locator("#bookingSubmit")).toHaveCount(0);
  await page.locator("#bookingSendCode").click();
  await expect(page.locator("#bookingVerify")).toContainText("验证码已发到 m••@example.com");
  await expect(page.locator("#bookingSendCode")).toBeDisabled();
  const outbox = await (await admin(request, "get", "/api/admin/mail/outbox")).json();
  const code = outbox.messages[0].text.match(/\b(\d{6})\b/)[1];
  await page.locator("#bookingEmailCode").fill(code === "000000" ? "000001" : "000000");
  await page.locator("#bookingVerifySubmit").click();
  await expect(page.locator("#bookingVerifyError")).toHaveText("验证码不对，还可以再试 4 次。");
  await page.locator("#bookingEmailCode").fill(code);
  await page.locator("#bookingVerifySubmit").click();
  await expect(page.locator("#bookingVerify")).toHaveCount(0);
  // Asked once, in the details: not again at sign-up, and no second email.
  await expect(page.locator("#bookingEmail")).toHaveCount(0);
  await page.locator("#bookingName").fill("Mia");

  // Three at the table: a date, a time, then a table big enough.
  await page.locator('[data-party="3"]').click();
  const day = page.locator(".bk-days button:not([disabled])").nth(2);
  await day.click();
  await page.locator('[data-time="19:00"]').click();
  await expect(page.locator('[data-table="2"]')).toBeDisabled();
  await expect(page.locator('[data-table="2"]')).toContainText("座位不够");
  await page.locator('[data-table="4"]').click();
  // A number that could be no one's, then a landline: said at once, nothing sent.
  await page.locator("#bookingPhone").fill("12345");
  await page.locator("#bookingPhone").blur();
  await expect(page.locator("#bookingPhoneError")).toHaveText("请填写有效的手机号，例如 0660 1234567 或 +43 660 1234567。");
  await page.locator("#bookingPhone").fill("01 5877777");
  await page.locator("#bookingSubmit").click();
  await expect(page.locator("#bookingPhoneError")).toHaveText("请填写手机号，不是座机号码。");
  await page.locator("#bookingPhone").fill("0660 111 22 33");
  await expect(page.locator(".bk-note")).toHaveText("8 人以上请致电");
  await page.locator("#bookingSubmit").click();

  await expect(page.locator("#bookingStatus")).toHaveText("已确认");
  await expect(page.locator("#bookingTable")).toHaveText("4 号桌");
  const reference = (await page.locator("#bookingReference").textContent()).trim();
  expect(reference).toMatch(/^[A-Z2-9]{6}$/);
  // Shown above, it is not listed a second time under it.
  await expect(page.locator(`#myBookings [data-reference="${reference}"]`)).toHaveCount(0);
  // A tap turns the ticket over to the number, to show at the door; another turns it back.
  await page.locator("#bookingPass").click();
  await expect(page.locator("#bookingPass")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".bk-pass-back strong")).toHaveText(reference);
  await page.locator("#bookingPass").click();
  await expect(page.locator("#bookingPass")).toHaveAttribute("aria-pressed", "false");

  // The link opens it again, even on another visit.
  await page.reload();
  await expect(page.locator("#bookingReference")).toHaveText(reference);

  // The same day again: one a day, said in words.
  await page.locator("#bookingAnother").click();
  await expect(page.locator(`#myBookings [data-reference="${reference}"]`)).toBeVisible();
  await page.locator('[data-party="2"]').click();
  await day.click();
  await page.locator('[data-time="13:00"]').click();
  await page.locator('[data-table="2"]').click();
  await page.locator("#bookingPhone").fill("+43 660 1112233");
  await page.locator("#bookingSubmit").click();
  await expect(page.locator("#bookingError")).toHaveText("同一天最多预约 1 次。");

  // The table taken at 19:00 is taken for the whole stay.
  await page.locator('[data-time="20:00"]').click();
  await expect(page.locator('[data-table="4"]')).toBeDisabled();
  await expect(page.locator('[data-table="4"]')).toContainText("已订");

  // Cancelled from the guest's own list.
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(`#myBookings [data-reference="${reference}"] .bk-danger`).click();
  await expect(page.locator(`#myBookings [data-reference="${reference}"]`)).toHaveAttribute("data-status", "cancelled");
});

test("the menu links to the booking page when bookings are on", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#bookBtn")).toBeVisible();
  await expect(page.locator("#bookBtn")).toHaveAttribute("href", /book\.html\?lang=/);
});

test("the console's records find a booking by phone and show its record", async ({ page, request }) => {
  // A booking the floor took by phone, beside the guest's cancelled one.
  const today = (await (await request.get(`${API}/api/reservations/availability`)).json()).booking.today;
  const date = new Date(Date.parse(`${today}T00:00:00Z`) + 5 * 86_400_000).toISOString().slice(0, 10);
  expect((await admin(request, "post", "/api/admin/reservations", { date, time: "18:30", party: 5, name: "Firma Huber", phone: "01 5550199", table: "6" })).ok()).toBe(true);

  await page.addInitScript(() => sessionStorage.setItem("zy_admin_token", "booking-e2e-admin-token"));
  await page.goto("/admin.html");
  await page.getByRole("button", { name: "预约" }).first().click();
  await expect(page.locator("#reservationsPanel")).toBeVisible();
  await page.getByRole("tab", { name: "预约单据" }).click();
  await page.locator("#resSearch").fill("5550199");
  await page.locator("#resRecords").getByRole("button", { name: "查询" }).click();
  const row = page.locator("#resRecords tbody tr");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Firma Huber");
  await row.getByRole("button", { name: "预约单据" }).click();
  await expect(page.locator("#resRecord")).toContainText("电话/到店");
  await expect(page.locator("#resRecord")).toContainText("6");
});

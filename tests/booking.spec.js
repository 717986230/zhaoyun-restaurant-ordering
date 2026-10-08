import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import jsQR from "jsqr";
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
    // The booking page speaks the menu's languages: Chinese among them here.
    menuLanguages: ["zh", "en", "de"],
    reservations: {
      enabled: true,
      hours: [{ days: [1, 2, 3, 4, 5, 6, 7], from: "12:00", to: "21:00" }],
      intervalMinutes: 30, durationMinutes: 120, capacity: 40, leadMinutes: 60, daysAhead: 30,
      autoConfirm: true, closedDates: [], note: "",
      tables: [{ table: "2", seats: 2 }, { table: "4", seats: 4 }, { table: "6", seats: 6 }],
      maxActivePerGuest: 2, maxPerDayPerGuest: 1, noShowLimit: 2,
      minPoints: 0, welcomePoints: 10, signupPoints: 20, bookingPoints: 5, noShowPoints: 5, noShowAfterMinutes: 30
    }
  });
  expect(saved.ok()).toBe(true);
});

/** What a QR code on the page says, read as a camera would. */
async function decodeQr(image) {
  await expect(image).toBeVisible();
  const pixels = await image.evaluate(async (element) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 240;
    const context = canvas.getContext("2d");
    context.drawImage(element, 0, 0, 240, 240);
    return Array.from(context.getImageData(0, 0, 240, 240).data);
  });
  return jsQR(Uint8ClampedArray.from(pixels), 240, 240)?.data ?? null;
}

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
  // A pane of glass, in the language it was opened in: no switch of its own (the menu has them).
  await expect(page.locator("#bookingModal")).toBeVisible();
  await expect(page.locator("#bookingModal .flag, #bookingModal .scheme-toggle")).toHaveCount(0);

  // Nothing is booked without an account.
  await expect(page.locator("#bookingSignIn")).toBeVisible();
  await expect(page.locator("#bookingSubmit")).toHaveCount(0);
  // Signing up at a table brings points; from home, as Mia does here, none.
  await expect(page.locator("#bookingSignupBonus")).toHaveText("在店里扫桌上的二维码注册，赠送 20 积分。");
  await page.getByRole("tab", { name: "注册" }).click();
  await page.locator("#bookingEmailLogin").fill("mia@example.com");
  await page.locator("#bookingPassword").fill("secret123");
  await page.locator("#bookingSignInSubmit").click();
  // The account is one tap away, in the dock at the bottom-right.
  await page.locator("#bookingDockAccount").click();
  await expect(page.locator("#bookingAccount")).toContainText("mia@example.com");
  // Escape closes the panel on top, not the booking under it.
  await page.keyboard.press("Escape");
  await expect(page.locator("#bookingPanel")).toHaveCount(0);
  await expect(page.locator("#bookingModal")).toBeVisible();

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

  // Booking is for members: each one costs 5 points, and a new account from home has none.
  // One line says so; the member code shows on a tap.
  await expect(page.locator("#bookingMember")).toContainText("预约一次需要 5 积分，你现在有 0 积分。");
  // The form is there to fill in; its button waits, saying what is missing.
  await expect(page.locator("#bookingSubmit")).toBeDisabled();
  await expect(page.locator("#bookingSubmit")).toHaveText("还差 5 积分才能预约");
  await expect(page.locator("#bookingMemberQr")).toHaveCount(0);
  await page.locator("#bookingMemberQrToggle").click();
  const memberCode = await decodeQr(page.locator("#bookingMemberQr"));
  expect(memberCode).toMatch(/^ZYMEM:[0-9a-f-]{36}$/);
  // The first visit: the waiter scans it when Mia pays (as the POS does), and she may book.
  const visit = await admin(request, "post", `/api/admin/members/${memberCode.slice("ZYMEM:".length)}/visit`, {});
  expect((await visit.json()).granted).toBe(true);
  await page.locator("#bookingRefreshPoints").click();
  await expect(page.locator("#bookingMember")).toHaveCount(0);
  await page.locator("#bookingDockAccount").click();
  await expect(page.locator("#bookingPoints")).toHaveText("10 积分");
  await expect(page.locator("#bookingMemberRule")).toHaveText("扫码注册送 20 积分 · 每次预约扣 5 积分（取消退回） · 首次到店消费送 10 积分 · 预约未到另扣 5 积分");
  await page.locator("#bookingPanel .sheet-close").click();
  await expect(page.locator("#bookingPanel")).toHaveCount(0);

  // Asked once, in the details: not again at sign-up, and no second email.
  await expect(page.locator("#bookingEmail")).toHaveCount(0);
  await page.locator("#bookingName").fill("Mia");

  // Three at the table: a date, a time, then a table big enough.
  // Three dropdowns: how many, which day, what time.
  await page.locator("#bookingParty").fill("3");
  const day = await page.locator("#bookingDate option").nth(2).getAttribute("value");
  await page.locator("#bookingDate").selectOption(day);
  await page.locator("#bookingTime").selectOption("19:00");
  await expect(page.locator('[data-table="2"]')).toBeDisabled();
  await expect(page.locator('[data-table="2"]')).toContainText("座位不够");
  await page.locator('[data-table="4"]').click();
  // A number that could be no one's, then a landline: said at once, nothing sent.
  // Any party size, typed by the guest: no "call us above eight" any more.
  await expect(page.locator("#bookingParty")).toHaveAttribute("max", "500");
  // A mobile number or an email: the account's email is there to start with.
  await expect(page.locator("#bookingContact")).toHaveValue("mia@example.com");
  await page.locator("#bookingContact").fill("mia@");
  await page.locator("#bookingContact").blur();
  await expect(page.locator("#bookingContactError")).toHaveText("请填写有效的邮箱。");
  await page.locator("#bookingContact").fill("12345");
  await page.locator("#bookingContact").blur();
  await expect(page.locator("#bookingContactError")).toHaveText("请填写有效的手机号，例如 0660 1234567 或 +43 660 1234567。");
  await page.locator("#bookingContact").fill("01 5877777");
  await page.locator("#bookingSubmit").click();
  await expect(page.locator("#bookingContactError")).toHaveText("请填写手机号，不是座机号码。");
  await page.locator("#bookingContact").fill("0660 111 22 33");
  await expect(page.locator(".bk-note")).toHaveCount(0);
  await page.locator("#bookingSubmit").click();

  await expect(page.locator("#bookingStatus")).toHaveText("已确认");
  await expect(page.locator("#bookingTable")).toHaveText("4 号桌");
  // What it cost, on the ticket, and what is left of the 10.
  await expect(page.locator("#bookingPointsLeft")).toHaveText("已扣 5 积分，还剩 5 积分");
  const reference = (await page.locator("#bookingReference").textContent()).trim();
  expect(reference).toMatch(/^[A-Z2-9]{6}$/);
  // Shown above, it is not listed a second time under it.
  await expect(page.locator(`#myBookings [data-reference="${reference}"]`)).toHaveCount(0);
  // A tap turns the ticket over to the number, to show at the door; another turns it back.
  await page.locator("#bookingPass").click();
  await expect(page.locator("#bookingPass")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".bk-pass-back strong")).toHaveText(reference);
  // With the QR code the waiter scans at the door: it reads "ZYRES:" and the number.
  const qr = page.locator("#bookingQr");
  await expect(qr).toBeVisible();
  await expect(qr).toHaveAttribute("alt", `预约二维码 ${reference}`);
  expect(await decodeQr(qr)).toBe(`ZYRES:${reference}`);
  await page.locator("#bookingPass").click();
  await expect(page.locator("#bookingPass")).toHaveAttribute("aria-pressed", "false");

  // The link opens it again, even on another visit.
  await page.reload();
  await expect(page.locator("#bookingReference")).toHaveText(reference);

  // The same day again: one a day, said in words.
  await page.locator("#bookingAnother").click();
  await page.locator("#bookingDockBookings").click();
  await expect(page.locator(`#myBookings [data-reference="${reference}"]`)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#bookingPanel")).toHaveCount(0);
  await page.locator("#bookingParty").fill("2");
  await page.locator("#bookingDate").selectOption(day);
  await page.locator("#bookingTime").selectOption("13:00");
  await page.locator('[data-table="2"]').click();
  await page.locator("#bookingContact").fill("mia@example.com");
  await page.locator("#bookingSubmit").click();
  await expect(page.locator("#bookingError")).toHaveText("同一天最多预约 1 次。");

  // The table taken at 19:00 is taken for the whole stay.
  await page.locator("#bookingTime").selectOption("20:00");
  await expect(page.locator('[data-table="4"]')).toBeDisabled();
  await expect(page.locator('[data-table="4"]')).toContainText("已订");

  // Cancelled from the guest's own list, in the dock.
  await page.locator("#bookingDockBookings").click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(`#myBookings [data-reference="${reference}"] .bk-danger`).click();
  await expect(page.locator(`#myBookings [data-reference="${reference}"]`)).toHaveAttribute("data-status", "cancelled");
  // The 5 points it cost come back with the cancel.
  await page.keyboard.press("Escape");
  await page.locator("#bookingDockAccount").click();
  await expect(page.locator("#bookingPoints")).toHaveText("10 积分");
});

test("a guest signs up with a mobile number: no code asked for, the number is how they are reached", async ({ page }) => {
  await page.goto("/book.html?lang=zh");
  await page.getByRole("tab", { name: "注册" }).click();
  // A landline is refused before anything is sent; a mobile goes through.
  await page.locator("#bookingEmailLogin").fill("01 5877777");
  await page.locator("#bookingPassword").fill("secret123");
  await page.locator("#bookingSignInSubmit").click();
  await expect(page.locator("#bookingSignIn .bk-error")).toHaveText("请填写手机号，不是座机号码。");
  await page.locator("#bookingEmailLogin").fill("0699 123 45 67");
  await page.locator("#bookingSignInSubmit").click();
  // Mail goes out here, yet no code: a number has no email to prove.
  await expect(page.locator("#bookingVerify")).toHaveCount(0);
  await expect(page.locator("#bookingContact")).toHaveValue("+436991234567");
  // And nothing said about deleting details after the day.
  await expect(page.locator(".bk-privacy")).toHaveCount(0);
});

test("the menu opens the booking over itself, in glass, and closing it goes back to the menu", async ({ page }) => {
  await page.goto("/");
  await page.locator("#bookBtn").click();
  await expect(page.locator("#bookingModal")).toBeVisible();
  await expect(page.locator("#bookingModal .sheet-head h2")).toHaveText("预约餐桌");
  await page.locator("#bookingModal .sheet-close").click();
  await expect(page.locator("#bookingModal")).toHaveCount(0);
  await expect(page.locator("#bookBtn")).toBeVisible();
});

test("the booking on its own page closes to the menu", async ({ page }) => {
  await page.goto("/book.html?lang=en");
  await expect(page.locator("#bookingModal")).toBeVisible();
  await page.locator("#bookingModal .sheet-close").click();
  await expect(page).toHaveURL(/\/(index\.html)?(\?.*)?$/);
  await expect(page.locator("#bookBtn")).toBeVisible();
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
  // The points rules said in one line, as a guest meets them, with the guard against made-up numbers.
  await page.locator(".res-rules summary").click();
  await expect(page.locator("#resPointsSummary")).toContainText("新客人在桌上扫码注册得 20 积分，每次预约扣 5 积分（取消退回），够预约 4 次。同一张桌每天最多 6 位");
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

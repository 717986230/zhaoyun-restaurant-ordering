import assert from "node:assert/strict";
import test from "node:test";
import { birthdayDaysFor, isBirthdayMonth, normalizeBirthday, normalizeBirthdayPerk } from "../../shared/customer.mjs";

/**
 * 生日营销 (shared/customer.mjs). A member gives only a month and a day — never
 * the year — and in that month the till offers the owner's birthday discount.
 */

test("normalizeBirthday keeps month and day, and refuses impossible dates", () => {
  assert.deepEqual(normalizeBirthday({ month: 3, day: 14 }), { month: 3, day: 14 });
  assert.deepEqual(normalizeBirthday({ month: 2, day: 29 }), { month: 2, day: 29 }, "29 Feb is a birthday too");
  assert.throws(() => normalizeBirthday({ month: 2, day: 30 }), /not a day/);
  assert.throws(() => normalizeBirthday({ month: 4, day: 31 }), /not a day/);
  assert.throws(() => normalizeBirthday({ month: 13, day: 1 }), /month/);
  assert.throws(() => normalizeBirthday({ month: 0, day: 1 }), /month/);
  assert.throws(() => normalizeBirthday({ month: 1, day: 0 }), /not a day/);
});

test("normalizeBirthdayPerk bounds the discount and refuses unknown keys", () => {
  assert.deepEqual(normalizeBirthdayPerk({ enabled: true, discountPercent: 15 }), { enabled: true, discountPercent: 15, greetByEmail: false });
  assert.deepEqual(normalizeBirthdayPerk({ enabled: true, discountPercent: 15, greetByEmail: true }).greetByEmail, true);
  assert.throws(() => normalizeBirthdayPerk({ greetByEmail: "yes" }), /true or false/);
  assert.deepEqual(normalizeBirthdayPerk({}), { enabled: false, discountPercent: 0, greetByEmail: false });
  assert.throws(() => normalizeBirthdayPerk({ enabled: true, discountPercent: 101 }), /0 to 100/);
  assert.throws(() => normalizeBirthdayPerk({ enabled: "yes" }), /true or false/);
  assert.throws(() => normalizeBirthdayPerk({ year: 1990 }), /Unknown/);
});

test("isBirthdayMonth matches the month only, and nothing without a birthday", () => {
  assert.equal(isBirthdayMonth({ month: 5, day: 20 }, 5), true);
  assert.equal(isBirthdayMonth({ month: 5, day: 20 }, 6), false);
  assert.equal(isBirthdayMonth(null, 5), false);
});

test("a member's birthday month brings the birthday discount to the till, above a smaller tier's", async (context) => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { buildServer } = await import("../index.mjs");
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-bday-"));
  const app = await buildServer({ databasePath: path.join(directory, "r.sqlite"), uploadDir: path.join(directory, "media"), adminToken: "bday-test-admin-token", logger: false });
  context.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const admin = { "x-admin-token": "bday-test-admin-token" };
  const month = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", month: "2-digit" }).format(new Date()));
  const other = month === 12 ? 1 : month + 1;

  const settings = await app.inject({ method: "PUT", url: "/api/admin/settings", headers: admin, payload: {
    customerAccounts: true, timeZone: "Europe/Vienna",
    memberTiers: { enabled: true, tiers: [{ name: "普卡", thresholdCents: 0, discountPercent: 5 }] },
    birthdayPerk: { enabled: true, discountPercent: 15 }
  } });
  assert.equal(settings.statusCode, 200, settings.body);
  assert.deepEqual(settings.json().settings?.birthdayPerk ?? settings.json().birthdayPerk, { enabled: true, discountPercent: 15, greetByEmail: false });

  const menu = await app.inject({ method: "GET", url: "/api/menu-settings" });
  if (menu.statusCode === 200) assert.deepEqual(menu.json().birthdayPerk ?? menu.json().settings?.birthdayPerk, { discountPercent: 15 });

  const registered = await app.inject({ method: "POST", url: "/api/customer/register", payload: { email: "bday@example.com", name: "B", password: "birthday-pass" } });
  assert.equal(registered.statusCode, 201, registered.body);
  const guest = { "x-customer-token": registered.json().token };

  const lookup = async () => (await app.inject({ method: "GET", url: "/api/admin/members?login=bday%40example.com", headers: admin })).json().member;
  assert.equal((await lookup()).membership.discountPercent, 5, "no birthday yet: the tier's 5%");

  const bad = await app.inject({ method: "POST", url: "/api/customer/birthday", headers: guest, payload: { month: 2, day: 30 } });
  assert.equal(bad.statusCode, 400);

  const notNow = await app.inject({ method: "POST", url: "/api/customer/birthday", headers: guest, payload: { month: other, day: 1 } });
  assert.deepEqual(notNow.json().birthday, { month: other, day: 1 });
  let member = await lookup();
  assert.equal(member.membership.birthdayMonth, false);
  assert.equal(member.membership.discountPercent, 5, "another month: still the tier's");

  await app.inject({ method: "POST", url: "/api/customer/birthday", headers: guest, payload: { month, day: 1 } });
  member = await lookup();
  assert.equal(member.membership.birthdayMonth, true);
  assert.equal(member.membership.discountPercent, 15, "birthday month: the greater, 15%");
  assert.deepEqual((await app.inject({ method: "GET", url: "/api/customer/birthday", headers: guest })).json().birthday, { month, day: 1 });

  const cleared = await app.inject({ method: "POST", url: "/api/customer/birthday", headers: guest, payload: { clear: true } });
  assert.equal(cleared.json().birthday, null);
  assert.equal((await lookup()).membership.discountPercent, 5);
});

test("a 29 February birthday is greeted on 28 February in a year without a 29th", () => {
  assert.deepEqual(birthdayDaysFor({ year: 2027, month: 2, day: 28 }), [28, 29]);
  assert.deepEqual(birthdayDaysFor({ year: 2028, month: 2, day: 28 }), [28]);
  assert.deepEqual(birthdayDaysFor({ year: 2028, month: 2, day: 29 }), [29]);
  assert.deepEqual(birthdayDaysFor({ year: 2027, month: 6, day: 5 }), [5]);
});

test("the daily job greets today's birthdays once a year, from 09:00 local, only by email and only when switched on", async (context) => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { buildServer } = await import("../index.mjs");
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-greet-"));
  const app = await buildServer({ databasePath: path.join(directory, "r.sqlite"), uploadDir: path.join(directory, "media"), adminToken: "greet-test-admin-token", logger: false, mail: { provider: "outbox" } });
  context.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const admin = { "x-admin-token": "greet-test-admin-token" };
  const put = (payload) => app.inject({ method: "PUT", url: "/api/admin/settings", headers: admin, payload });
  assert.equal((await put({ customerAccounts: true, timeZone: "Europe/Vienna", menuLanguages: ["de", "zh"], restaurantName: "Zhaoyun", birthdayPerk: { enabled: true, discountPercent: 10, greetByEmail: false } })).statusCode, 200);

  const join = async (email, month, day) => {
    const registered = await app.inject({ method: "POST", url: "/api/customer/register", payload: { email, name: "Gast", password: "greeting-pass" } });
    assert.equal(registered.statusCode, 201, registered.body);
    await app.inject({ method: "POST", url: "/api/customer/birthday", headers: { "x-customer-token": registered.json().token }, payload: { month, day } });
  };
  await join("today@example.com", 6, 15);
  await join("other@example.com", 6, 16);
  const outbox = async () => (await app.inject({ method: "GET", url: "/api/admin/mail/outbox?limit=50", headers: admin })).json().messages;
  // 15 June 2027, 10:00 in Vienna (08:00 UTC); 07:00 UTC is 09:00 there.
  const morning = new Date("2027-06-15T08:00:00Z");

  assert.deepEqual(await app.birthdayGreetings(morning), { sent: 0, skipped: "off" }, "email not switched on: nothing");
  assert.equal((await put({ birthdayPerk: { enabled: true, discountPercent: 10, greetByEmail: true } })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/api/menu-settings" })).json().birthdayPerk?.email ?? true, true);

  assert.deepEqual(await app.birthdayGreetings(new Date("2027-06-15T05:00:00Z")), { sent: 0, skipped: "early" }, "07:00 local: too early");
  assert.deepEqual(await app.birthdayGreetings(morning), { sent: 1, failed: 0 });
  const mails = await outbox();
  const greeting = mails.find((message) => message.to === "today@example.com");
  assert.ok(greeting, "today's member is greeted");
  assert.match(greeting.subject, /Geburtstag/, "in the menu's first language");
  assert.match(greeting.text, /10% Mitgliedspreis/);
  assert.ok(!mails.some((message) => message.to === "other@example.com"), "tomorrow's birthday waits");

  assert.deepEqual(await app.birthdayGreetings(new Date("2027-06-15T15:00:00Z")), { sent: 0, failed: 0 }, "the next hour: already greeted this year");
  assert.equal((await outbox()).filter((message) => message.to === "today@example.com").length, 1);
  assert.deepEqual(await app.birthdayGreetings(new Date("2028-06-15T08:00:00Z")), { sent: 1, failed: 0 }, "next year: greeted again");
});

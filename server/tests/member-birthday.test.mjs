import assert from "node:assert/strict";
import test from "node:test";
import { isBirthdayMonth, normalizeBirthday, normalizeBirthdayPerk } from "../../shared/customer.mjs";

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
  assert.deepEqual(normalizeBirthdayPerk({ enabled: true, discountPercent: 15 }), { enabled: true, discountPercent: 15 });
  assert.deepEqual(normalizeBirthdayPerk({}), { enabled: false, discountPercent: 0 });
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
  assert.deepEqual(settings.json().settings?.birthdayPerk ?? settings.json().birthdayPerk, { enabled: true, discountPercent: 15 });

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

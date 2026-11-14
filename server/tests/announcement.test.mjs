import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "../index.mjs";

/**
 * 公告弹窗 — the notice the owner edits and publishes from the console. These
 * go the whole way the guest's phone does: saved through the settings endpoint,
 * read back from the public catalogue. The owner's text, bounded and trimmed,
 * is shared/settings.mjs's to check; here we hold the ends together — a notice
 * reaches the menu only when it is on and has something to say.
 */
const ADMIN = "announce-test-admin-token-announce-test-admin";

async function withServer(run) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-announce-"));
  const app = await buildServer({ databasePath: path.join(directory, "restaurant.sqlite"), uploadDir: path.join(directory, "media"), adminToken: ADMIN, logger: false });
  try {
    await run(app);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

const save = (app, announcement) => app.inject({ method: "PUT", url: "/api/admin/settings", headers: { "x-admin-token": ADMIN }, payload: { announcement } });
const menuOf = async (app) => JSON.parse((await app.inject({ method: "GET", url: "/api/catalog" })).body).menu;

test("a published announcement reaches the menu, with its line breaks and only in the languages filled in", async () => {
  await withServer(async (app) => {
    const saved = await save(app, { enabled: true, title: { zh: "春节营业时间", en: "Lunar New Year hours" }, body: { zh: "除夕照常营业\n初一休息一天" } });
    assert.equal(saved.statusCode, 200, saved.body);

    const menu = await menuOf(app);
    assert.deepEqual(menu.announcement.title, { zh: "春节营业时间", en: "Lunar New Year hours" });
    assert.equal(menu.announcement.body.zh, "除夕照常营业\n初一休息一天", "line breaks are kept");
    assert.equal(menu.announcement.body.en, undefined, "a language left empty is not sent");
    assert.equal(menu.announcement.schedule, null);
  });
});

test("an announcement that is off, or on with no text, is not sent to the menu", async () => {
  await withServer(async (app) => {
    await save(app, { enabled: true, title: { zh: "标题" }, body: {} });
    assert.equal((await menuOf(app)).announcement, null, "a title with no body is nothing to show");

    await save(app, { enabled: false, body: { zh: "我们搬到新地址了" } });
    assert.equal((await menuOf(app)).announcement, null, "switched off, even with text");

    await save(app, { enabled: true, body: { zh: "我们搬到新地址了" } });
    assert.equal((await menuOf(app)).announcement.body.zh, "我们搬到新地址了");
  });
});

test("the hours are kept, and decide nothing on their own — the menu checks them", async () => {
  await withServer(async (app) => {
    const saved = await save(app, { enabled: true, body: { de: "Heute Mittag Buffet" }, schedule: { days: [1, 2, 3, 4, 5], from: "11:00", to: "14:30" } });
    assert.equal(saved.statusCode, 200, saved.body);
    const menu = await menuOf(app);
    assert.deepEqual(menu.announcement.schedule, { days: [1, 2, 3, 4, 5], from: "11:00", to: "14:30" });
  });
});

test("text too long, or a broken schedule, is refused at the edge", async () => {
  await withServer(async (app) => {
    const tooLong = await save(app, { enabled: true, title: { zh: "标".repeat(130) }, body: { zh: "x" } });
    assert.equal(tooLong.statusCode, 400, "a title past the limit after trimming");

    const badDays = await save(app, { enabled: true, body: { zh: "x" }, schedule: { days: [9], from: "11:00", to: "14:30" } });
    assert.equal(badDays.statusCode, 400, "a day outside 1–7");
  });
});

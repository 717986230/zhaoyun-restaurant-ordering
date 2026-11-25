import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDatabase } from "../database.mjs";

/**
 * 会员分群 + 群发营销 through the store: consent opt-in, who a segment reaches,
 * and a broadcast's draft → claim → finish round-trip over SQLite. The segment
 * engine itself is covered in segments.test.mjs.
 */
function openDatabase(context) {
  const directory = mkdtempSync(path.join(tmpdir(), "zy-broadcasts-"));
  const database = createDatabase(path.join(directory, "db.sqlite"));
  context.after(() => { database.close(); rmSync(directory, { recursive: true, force: true }); });
  return database;
}

test("consent is off until the member opts in, and a broadcast reaches only the consented", async (t) => {
  const db = openDatabase(t);
  const a = (await db.customers.register({ email: "a@example.com", name: "A", password: "secret12" })).customer;
  const b = (await db.customers.register({ email: "b@example.com", name: "B", password: "secret12" })).customer;

  assert.equal(await db.customers.marketingConsent(a.id), false);
  assert.equal(await db.customers.setMarketing(a.id, true), true);
  assert.equal(await db.customers.marketingConsent(a.id), true);
  assert.equal(await db.customers.setMarketing("no-such", true), null);

  // Two members, one opted in: the segment picks both, but only one is reachable.
  const preview = await db.broadcastPreview({});
  assert.equal(preview.total, 2);
  assert.equal(preview.reachable, 1);
  assert.deepEqual(preview.sample, ["A"]);

  // A points floor narrows the audience.
  await db.customers.adjustPoints(a.id, { delta: 300, note: "test" });
  const narrow = await db.broadcastPreview({ minPoints: 100 });
  assert.equal(narrow.total, 1);
  assert.equal(narrow.reachable, 1);
  assert.equal((await db.broadcastPreview({ minPoints: 1000 })).reachable, 0);
  void b;
});

test("a broadcast is drafted, claims each member once, and finishes with a read count", async (t) => {
  const db = openDatabase(t);
  const a = (await db.customers.register({ email: "a@example.com", name: "A", password: "secret12" })).customer;
  await db.customers.setMarketing(a.id, true);

  const draft = await db.createBroadcast({ subject: "本周特惠", body: "欢迎回来。", segment: {} });
  assert.equal(draft.status, "draft");
  assert.ok(draft.id);
  assert.equal((await db.listBroadcasts()).length, 1);
  assert.equal((await db.getBroadcast(draft.id)).subject, "本周特惠");

  await assert.rejects(db.createBroadcast({ subject: "", body: "x" }), /subject/);

  await db.markBroadcastSending(draft.id);
  assert.equal(await db.claimBroadcastSend(draft.id, a.id), true);
  assert.equal(await db.claimBroadcastSend(draft.id, a.id), false); // already claimed

  const finished = await db.finishBroadcast(draft.id, 1);
  assert.equal(finished.status, "sent");
  assert.equal(finished.audience, 1);
  assert.equal(finished.sent, 1);
});

test("the unsubscribe token turns a member's consent off", async (t) => {
  const db = openDatabase(t);
  const a = (await db.customers.register({ email: "a@example.com", name: "A", password: "secret12" })).customer;
  await db.customers.setMarketing(a.id, true);

  const [member] = (await db.audienceFor({})).filter((row) => row.marketing);
  assert.ok(member.token);
  assert.equal(await db.customers.unsubscribe(member.token), true);
  assert.equal(await db.customers.marketingConsent(a.id), false);
  // A token that matches nobody, or a member already off, changes nothing.
  assert.equal(await db.customers.unsubscribe(member.token), false);
  assert.equal(await db.customers.unsubscribe("nope"), false);
});

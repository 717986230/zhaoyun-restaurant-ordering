import assert from "node:assert/strict";
import test from "node:test";
import { createApi } from "../../shared/http.mjs";
import { alertMessage } from "../../shared/mail.mjs";

/**
 * When a request ends in an unplanned 500, the owner gets one email — but only
 * when the deployment can send mail and has an address to send to, and at most
 * once per cooldown. The alert rides the same Brevo pipeline as the guests'
 * mail; here MAIL_OUTBOX stands in, so the message is captured instead of sent.
 */

/** A store that fails the way a broken deployment would: its first read throws. */
function brokenStore(outbox) {
  return {
    getSettings: async () => { throw new Error("database unreachable"); },
    customers: { recordOutbox: async (message) => { outbox.push(message); } }
  };
}

/** Build the API with the alert wired and a `defer` the test can await. */
function buildApi(store, { ownerAlertEmail } = {}) {
  const pending = [];
  const api = createApi({
    store,
    mail: { provider: "outbox" },
    ownerAlertEmail,
    defer: (task) => { pending.push(Promise.resolve(task)); }
  });
  const settle = () => Promise.all(pending);
  return { api, settle };
}

const hit = (api) => api(new Request("http://localhost/api/catalog"), { ip: "203.0.113.5", requestId: "ray-1" });

test("a 500 emails the owner when an alert address is set", async () => {
  const outbox = [];
  const { api, settle } = buildApi(brokenStore(outbox), { ownerAlertEmail: "owner@example.com" });
  const response = await hit(api);
  assert.equal(response.status, 500);
  await settle();
  assert.equal(outbox.length, 1, "exactly one alert");
  assert.equal(outbox[0].to, "owner@example.com");
  assert.match(outbox[0].subject, /system error/);
  assert.match(outbox[0].text, /GET \/api\/catalog/);
  assert.match(outbox[0].text, /ray-1/);
});

test("no alert address means errors are logged only, not emailed", async () => {
  const outbox = [];
  const { api, settle } = buildApi(brokenStore(outbox), { ownerAlertEmail: null });
  const response = await hit(api);
  assert.equal(response.status, 500);
  await settle();
  assert.equal(outbox.length, 0);
});

test("a burst of errors is one email, not a flood", async () => {
  const outbox = [];
  const { api, settle } = buildApi(brokenStore(outbox), { ownerAlertEmail: "owner@example.com" });
  for (let attempt = 0; attempt < 5; attempt += 1) assert.equal((await hit(api)).status, 500);
  await settle();
  assert.equal(outbox.length, 1, "the cooldown holds across requests");
});

test("alertMessage carries the restaurant, request and all three languages", () => {
  const message = alertMessage({ restaurant: "Zhaoyun", method: "POST", path: "/api/guest/orders", requestId: "ray-9", time: "2026-10-27T00:00:00Z" });
  assert.match(message.subject, /Zhaoyun/);
  assert.match(message.text, /POST \/api\/guest\/orders/);
  assert.match(message.text, /ray-9/);
  assert.match(message.text, /点餐系统/); // zh
  assert.match(message.text, /Bestellsystem/); // de
  assert.match(message.text, /ordering system/); // en
});

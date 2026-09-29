import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "../index.mjs";
import { renderTickets } from "../tickets.mjs";
import { outboundRequest, readDeliveryOrder, signJwt, toCents, webhookAuthentic } from "../../shared/delivery.mjs";

/**
 * The delivery platforms, where the shared contract cannot look: what our
 * side says to theirs (a fake platform stands in, recording each call), the
 * shapes each platform has been seen to send, and the kitchen's ticket.
 */
const ADMIN = "delivery-test-admin-token-delivery-test-admin";
const SECRET = "delivery-test-webhook-secret-0123456789";

test("amounts as the platforms write them", () => {
  assert.deepEqual([toCents(10.5), toCents("10.50"), toCents("10,5"), toCents(undefined), toCents("x")], [1050, 1050, 1050, 0, 0]);
});

test("either spelling of a field reads the same", () => {
  const pascal = readDeliveryOrder("lieferando", { OrderId: "1", Items: [{ Name: "Gyoza", Quantity: 3, UnitPrice: 2 }], Fulfilment: { Method: "Collection" } });
  const camel = readDeliveryOrder("lieferando", { orderId: "1", items: [{ name: "Gyoza", quantity: 3, unitPrice: 2 }], fulfilment: { method: "Collection" } });
  assert.deepEqual(camel, pascal);
  assert.equal(pascal.type, "pickup");
  assert.equal(pascal.totalCents, 600, "no total sent: the lines add up to one");
  assert.throws(() => readDeliveryOrder("lieferando", { Items: [{ Name: "Gyoza" }] }), /no id/);
  assert.throws(() => readDeliveryOrder("foodora", { token: "t", products: [] }), /no items/);
});

test("a platform proves itself with its secret, as a bearer, a header or a signed token", async () => {
  const headers = (entries) => new Headers(entries);
  assert.equal(await webhookAuthentic(headers({ authorization: `Bearer ${SECRET}` }), SECRET), true);
  assert.equal(await webhookAuthentic(headers({ "x-webhook-secret": SECRET }), SECRET), true);
  assert.equal(await webhookAuthentic(headers({ "x-webhook-secret": `${SECRET}x` }), SECRET), false);
  assert.equal(await webhookAuthentic(headers({ authorization: `Bearer ${await signJwt({ exp: Math.floor(Date.now() / 1000) + 60 }, SECRET, "HS256")}` }), SECRET), true);
  assert.equal(await webhookAuthentic(headers({ authorization: `Bearer ${await signJwt({}, "another-secret")}` }), SECRET), false);
  assert.equal(await webhookAuthentic(headers({ authorization: `Bearer ${SECRET}` }), ""), false, "no secret configured: nobody");
});

test("nothing is said to the platform about a test order, or without its API access", () => {
  const order = { provider: "lieferando", externalId: "1", type: "delivery" };
  assert.equal(outboundRequest(order, "accept", {}), null);
  assert.equal(outboundRequest({ ...order, provider: "foodora" }, "accept", {}), null);
  assert.equal(outboundRequest(order, "ready", { apiKey: "k" }), null, "a courier's order is the platform's once it is fetched");
  assert.equal(outboundRequest({ ...order, type: "pickup" }, "ready", { apiKey: "k" }).url, "https://uk-partnerapi.just-eat.io/orders/1/readyforcollection");
});

test("the floor's answer reaches the platform, and a failed one can be sent again", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-delivery-"));
  const calls = [];
  let platformUp = false;
  const fakePlatform = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    if (url.endsWith("/v2/login")) return Response.json({ access_token: "fd-token", expires_in: 3600 });
    return platformUp ? new Response(null, { status: 204 }) : new Response("busy", { status: 503 });
  };
  const app = await buildServer({
    databasePath: path.join(directory, "restaurant.sqlite"),
    uploadDir: path.join(directory, "media"),
    adminToken: ADMIN,
    delivery: {
      lieferando: { webhookSecret: SECRET, apiKey: "jet-key", apiBase: "https://jet.example/" },
      foodora: { webhookSecret: SECRET, username: "plugin", password: "pw", apiBase: "https://fd.example" }
    },
    deliveryFetch: fakePlatform,
    logger: false
  });
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const call = async (method, url, payload, headers = { "x-admin-token": ADMIN }) => {
    const response = await app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, json: response.body ? response.json() : {} };
  };
  await call("PUT", "/api/admin/settings", { delivery: { lieferando: { enabled: true, autoAccept: false, prepMinutes: 20 }, foodora: { enabled: true, autoAccept: true, prepMinutes: 15 } } });

  // Lieferando: accepted by the floor; the platform is down, then back.
  const hook = await call("POST", "/api/delivery/lieferando/orders", { OrderId: "jet-9", FriendlyOrderReference: "ABC123", Items: [{ Name: "Ramen", Quantity: 1, UnitPrice: 12.5 }] }, { authorization: `Bearer ${SECRET}` });
  assert.equal(hook.status, 201);
  const failed = await call("POST", `/api/admin/delivery/orders/${hook.json.id}/accept`, { prepMinutes: 25 });
  assert.equal(failed.json.order.status, "accepted", "the kitchen cooks whatever the platform's API says");
  assert.equal(failed.json.order.sync.status, "failed");
  assert.match(failed.json.order.sync.error, /503/);
  const accept = calls.at(-1);
  assert.deepEqual([accept.method, accept.url, accept.headers.authorization], ["PUT", "https://jet.example/orders/jet-9/accept", "JE-API-KEY jet-key"]);
  assert.ok(JSON.parse(accept.body).TimeAcceptedFor, "when it will be ready");
  platformUp = true;
  const resent = await call("POST", `/api/admin/delivery/orders/${hook.json.id}/resend`, {});
  assert.equal(resent.json.order.sync.status, "sent");
  assert.equal(calls.at(-1).url, "https://jet.example/orders/jet-9/accept");

  // foodora: accepted on arrival, signed in once for every call after.
  const before = calls.length;
  const fd = await call("POST", "/api/delivery/foodora/orders", { token: "fd-1", code: "F1", products: [{ name: "Ramen", quantity: 1, unitPrice: "12.50" }], price: { grandTotal: "12.50" } }, { "x-webhook-secret": SECRET });
  assert.equal(fd.json.status, "accepted");
  const ready = await call("POST", `/api/admin/delivery/orders/${fd.json.id}/ready`, {});
  assert.equal(ready.json.order.sync.status, "sent");
  const made = calls.slice(before);
  assert.deepEqual(made.map((entry) => entry.url), ["https://fd.example/v2/login", "https://fd.example/v2/order/status/fd-1", "https://fd.example/v2/order/status/fd-1"]);
  assert.deepEqual(made.slice(1).map((entry) => JSON.parse(entry.body).status), ["order_accepted", "order_prepared"]);
  assert.equal(made[1].headers.authorization, "Bearer fd-token");

  // The console's made-up order tells the platform nothing.
  const count = calls.length;
  const sample = await call("POST", "/api/admin/delivery/test/foodora");
  assert.equal(sample.json.order.test, true);
  await call("POST", `/api/admin/delivery/orders/${sample.json.order.id}/accept`, {});
  assert.equal(calls.length, count);
});

test("the kitchen's ticket names the platform, its number, and when it is due", () => {
  const payload = {
    kind: "order", orderNo: "ABC123", table: "Lieferando #ABC123", note: "Ohne Koriander",
    items: [{ name: "Ramen", names: { zh: "拉面", de: "Ramen", en: "Ramen" }, quantity: 2, modifiers: [{ name: "Extra Ei" }] }],
    delivery: { provider: "lieferando", name: "Lieferando", reference: "ABC123", type: "delivery", dueAt: "2026-09-28T18:30:00Z", customerName: "Anna" }
  };
  const text = renderTickets(payload, { capabilities: { printLanguage: "de", encoding: "utf8" } }, { station: "kitchen" }).toString("utf8");
  assert.match(text, /\*\*\* Lieferando · LIEFERUNG \*\*\*/);
  assert.match(text, /#ABC123/);
  assert.match(text, /Fertig um/);
  assert.match(text, /Anna/);
  assert.match(text, /2 x Ramen/);
  assert.match(text, /Extra Ei/);
});

test("a new order says which dishes the kitchen is out of, and accepting it takes today's portions", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-delivery-stock-"));
  const app = await buildServer({
    databasePath: path.join(directory, "restaurant.sqlite"),
    uploadDir: path.join(directory, "media"),
    adminToken: ADMIN,
    delivery: { lieferando: { webhookSecret: SECRET } },
    logger: false
  });
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const call = async (method, url, payload, headers = { "x-admin-token": ADMIN }) => {
    const response = await app.inject({ method, url, headers, ...(payload ? { payload } : {}) });
    return { status: response.statusCode, json: response.body ? response.json() : {} };
  };
  await call("PUT", "/api/admin/settings", { delivery: { lieferando: { enabled: true, autoAccept: false, prepMinutes: 20 }, foodora: { enabled: false, autoAccept: false, prepMinutes: 20 } } });
  assert.equal((await call("PUT", "/api/admin/products/photo-r1/stock", { dailyLimit: 1 })).status, 200);

  const hook = await call("POST", "/api/delivery/lieferando/orders", { OrderId: "jet-stock-1", FriendlyOrderReference: "ST1", Items: [{ Reference: "R1", Name: "Ramen", Quantity: 2, UnitPrice: 12.5 }] }, { authorization: `Bearer ${SECRET}` });
  assert.equal(hook.status, 201);

  const device = (await call("POST", "/api/admin/pos-devices", { name: "Counter" })).json.token;
  const staff = (await call("POST", "/api/admin/staff", { name: "Li", pin: "1234" })).json.staff;
  const token = (await call("POST", "/api/pos/sign-in", { staffId: staff.id, pin: "1234" }, { "x-device-token": device })).json.token;
  const floor = (await call("GET", "/api/pos/floor", null, { "x-admin-token": token })).json;
  assert.deepEqual(floor.delivery[0].shortages, [{ sku: "R1", name: "蔬菜拉面", wanted: 2, left: 1 }], "known before anyone says yes");

  assert.equal((await call("POST", `/api/admin/delivery/orders/${hook.json.id}/accept`, {})).json.order.status, "accepted", "the floor may still say yes");
  const ramen = (await call("GET", "/api/admin/products")).json.products.find((product) => product.id === "photo-r1");
  assert.equal(ramen.leftToday, 0, "and the count is down to nothing, not below");
  assert.equal((await call("GET", "/api/pos/floor", null, { "x-admin-token": token })).json.delivery[0].shortages, undefined, "accepted: nothing more to warn about");
});

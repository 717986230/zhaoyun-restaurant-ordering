import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "../index.mjs";

test("catalog, orders, service requests and print routing work together", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-api-"));
  const app = await buildServer({
    databasePath: path.join(directory, "restaurant.sqlite"),
    uploadDir: path.join(directory, "media"),
    adminToken: "test-admin-token",
    logger: false
  });
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const adminHeaders = { "x-admin-token": "test-admin-token" };
  const denied = await app.inject({ method: "GET", url: "/api/admin/products" });
  assert.equal(denied.statusCode, 401);

  const catalog = await app.inject({ method: "GET", url: "/api/catalog" });
  assert.equal(catalog.statusCode, 200);
  const catalogProducts = catalog.json().products;
  assert.equal(catalogProducts.length, 111);
  assert.ok(catalogProducts.some((product) => product.sku === "R1" && product.category === "RAMEN"));
  assert.ok(catalogProducts.some((product) => product.sku === "N1-6" && product.kind === "sushi" && product.printStation === "sushi"));
  assert.ok(catalogProducts.some((product) => product.sku === "BEER-WIESEL-FASS" && product.kind === "drink" && product.printStation === "bar"));
  const ramen = catalogProducts.find((product) => product.sku === "R1");
  const modifierOrder = await app.inject({
    method: "POST",
    url: "/api/orders",
    payload: { clientRequestId: "modifier-order-0001", table: "08", note: "", items: [{ id: ramen.id, qty: 1, modifiers: [{ id: "extra-noodles" }, { id: "no-cilantro" }, { id: "extra-chili" }] }] }
  });
  assert.equal(modifierOrder.statusCode, 201);
  assert.equal(modifierOrder.json().order.total, 15.5);
  assert.deepEqual(modifierOrder.json().order.items[0].modifiers.map((modifier) => modifier.name), ["加面", "不要香菜", "加辣椒"]);
  const concurrentPayload = {
    method: "POST",
    url: "/api/orders",
    payload: { clientRequestId: "concurrent-order-0001", table: "08", note: "", items: [{ id: ramen.id, qty: 1 }] }
  };
  const [concurrentA, concurrentB] = await Promise.all([app.inject(concurrentPayload), app.inject(concurrentPayload)]);
  assert.equal(concurrentA.statusCode, 201);
  assert.equal(concurrentB.statusCode, 201);
  assert.equal(concurrentA.json().order.id, concurrentB.json().order.id);

  const drinkResponse = await app.inject({
    method: "POST",
    url: "/api/admin/products",
    headers: adminHeaders,
    payload: {
      sku: "DRINK-WINE-01",
      kind: "drink",
      category: "WINE",
      names: { zh: "绿维特利纳白葡萄酒", de: "Gruener Veltliner", en: "Gruener Veltliner" },
      price: 6.9,
      printStation: "bar",
      published: true,
      available: true
    }
  });
  assert.equal(drinkResponse.statusCode, 201);
  const drink = drinkResponse.json().product;
  assert.equal(drink.kind, "drink");
  assert.equal(drink.printStation, "bar");

  const modifierConfig = {
    id: "sweetness",
    names: { zh: "甜度", de: "Süße", en: "Sweetness" },
    selection: "single",
    options: [
      { id: "less-sugar", names: { zh: "少糖", de: "Weniger Zucker", en: "Less sugar" }, priceCents: 0 },
      { id: "no-sugar", names: { zh: "无糖", de: "Ohne Zucker", en: "No sugar" }, priceCents: 0 }
    ]
  };
  const updatedDrink = await app.inject({
    method: "PUT",
    url: `/api/admin/products/${drink.id}`,
    headers: adminHeaders,
    payload: { ...drinkResponse.json().product, price: 6.9, modifiers: [modifierConfig] }
  });
  assert.equal(updatedDrink.statusCode, 200);
  assert.deepEqual(updatedDrink.json().product.modifiers, [modifierConfig]);
  const reloadedDrink = await app.inject({ method: "GET", url: `/api/admin/products/${drink.id}`, headers: adminHeaders });
  assert.deepEqual(reloadedDrink.json().modifiers, [modifierConfig]);

  const sushiResponse = await app.inject({
    method: "POST",
    url: "/api/admin/products",
    headers: adminHeaders,
    payload: {
      sku: "SUSHI-NIGIRI-01",
      kind: "sushi",
      category: "NIGIRI",
      names: { zh: "三文鱼握寿司", de: "Lachs Nigiri", en: "Salmon Nigiri" },
      price: 8.5,
      printStation: "sushi",
      published: true,
      available: true
    }
  });
  assert.equal(sushiResponse.statusCode, 201);
  const sushi = sushiResponse.json().product;

  const clientRequestId = "tablet-08-order-0001";
  const createOrder = () => app.inject({
    method: "POST",
    url: "/api/orders",
    payload: {
      clientRequestId,
      table: "08",
      note: "wine first",
      items: [
        { id: drink.id, qty: 2 },
        { id: sushi.id, qty: 1 }
      ]
    }
  });
  const firstOrder = await createOrder();
  const duplicateOrder = await createOrder();
  assert.equal(firstOrder.statusCode, 201);
  assert.equal(firstOrder.json().order.total, 22.3);
  assert.equal(firstOrder.json().order.id, duplicateOrder.json().order.id);

  const jobs = await app.inject({
    method: "GET",
    url: "/api/admin/print-jobs?status=queued",
    headers: adminHeaders
  });
  assert.deepEqual(
    jobs.json().jobs.map((job) => job.printerRole).sort(),
    ["bar", "kitchen", "kitchen", "sushi"]
  );

  const service = await app.inject({
    method: "POST",
    url: "/api/service-requests",
    payload: { table: "12", type: "pay" }
  });
  assert.equal(service.statusCode, 201);
  assert.equal(service.json().request.table, "12");
  const requestId = service.json().request.id;
  const requestList = await app.inject({ method: "GET", url: "/api/service-requests", headers: adminHeaders });
  assert.deepEqual(requestList.json().requests.map((row) => [row.table, row.type, row.status]), [["12", "pay", "open"]]);
  const completeService = await app.inject({
    method: "PATCH",
    url: `/api/service-requests/${requestId}/status`,
    headers: adminHeaders,
    payload: { status: "completed" }
  });
  assert.equal(completeService.json().request.status, "completed");

  const preparingOrder = await app.inject({
    method: "PATCH",
    url: `/api/orders/${firstOrder.json().order.id}/status`,
    headers: adminHeaders,
    payload: { status: "preparing" }
  });
  assert.equal(preparingOrder.json().order.status, "preparing");
  const completeOrder = await app.inject({
    method: "PATCH",
    url: `/api/orders/${firstOrder.json().order.id}/status`,
    headers: adminHeaders,
    payload: { status: "ready" }
  });
  assert.equal(completeOrder.json().order.status, "ready");
});

test("admin authentication rate-limits repeated invalid tokens", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-auth-"));
  const app = await buildServer({
    databasePath: path.join(directory, "restaurant.sqlite"),
    uploadDir: path.join(directory, "media"),
    adminToken: "test-admin-token",
    logger: false
  });
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await app.inject({ method: "GET", url: "/api/admin/products", headers: { "x-admin-token": "wrong-token" } });
    assert.equal(response.statusCode, 401);
  }
  const blocked = await app.inject({ method: "GET", url: "/api/admin/products", headers: { "x-admin-token": "wrong-token" } });
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.json().retryAfter > 0, true);
  assert.equal(blocked.headers["retry-after"] > 0, true);
});

test("API rejects malformed commands before reaching the database", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-schema-"));
  const app = await buildServer({
    databasePath: path.join(directory, "restaurant.sqlite"),
    uploadDir: path.join(directory, "media"),
    adminToken: "test-admin-token",
    logger: false
  });
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const invalidOrder = await app.inject({
    method: "POST",
    url: "/api/orders",
    payload: { clientRequestId: "short", table: "08", note: "", items: [] }
  });
  assert.equal(invalidOrder.statusCode, 400);
  assert.match(invalidOrder.json().error, /Invalid request/);
  assert.ok(invalidOrder.json().requestId);

  const invalidProduct = await app.inject({
    method: "POST",
    url: "/api/admin/products",
    headers: { "x-admin-token": "test-admin-token" },
    payload: {
      sku: "INVALID",
      kind: "food",
      category: "not valid",
      names: { zh: "测试", de: "Test", en: "Test" },
      price: -1,
      printStation: "kitchen"
    }
  });
  assert.equal(invalidProduct.statusCode, 400);
});

test("production bootstrap rejects short admin tokens even when overridden programmatically", async () => {
  await assert.rejects(
    () => buildServer({ isProduction: true, adminToken: "short-token", logger: false }),
    /Production ADMIN_TOKEN must be at least 32 characters/
  );
});

test("orders and print jobs keep the table the device was assigned to", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-table-"));
  const app = await buildServer({
    databasePath: path.join(directory, "restaurant.sqlite"),
    uploadDir: path.join(directory, "media"),
    adminToken: "test-admin-token",
    logger: false
  });
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const catalog = await app.inject({ method: "GET", url: "/api/catalog" });
  const dish = catalog.json().products[0];
  const created = await app.inject({
    method: "POST",
    url: "/api/orders",
    payload: { clientRequestId: "terrace-table-0001", table: "T-12", note: "", items: [{ id: dish.id, qty: 1 }] }
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().order.table, "T-12");

  const jobs = await app.inject({ method: "GET", url: "/api/admin/print-jobs?status=queued", headers: { "x-admin-token": "test-admin-token" } });
  assert.deepEqual(jobs.json().jobs.map((job) => job.payload.table), ["T-12"]);
});

test("public ordering endpoints throttle a single device", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-throttle-"));
  const app = await buildServer({
    databasePath: path.join(directory, "restaurant.sqlite"),
    uploadDir: path.join(directory, "media"),
    adminToken: "test-admin-token",
    orderRateLimitMax: 2,
    serviceRateLimitMax: 1,
    logger: false
  });
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const catalog = await app.inject({ method: "GET", url: "/api/catalog" });
  const dish = catalog.json().products[0];
  const order = (index) => app.inject({
    method: "POST",
    url: "/api/orders",
    payload: { clientRequestId: `throttle-order-${index}`, table: "05", note: "", items: [{ id: dish.id, qty: 1 }] }
  });
  assert.equal((await order(1)).statusCode, 201);
  assert.equal((await order(2)).statusCode, 201);
  const throttled = await order(3);
  assert.equal(throttled.statusCode, 429);
  assert.equal(throttled.json().retryAfter > 0, true);
  assert.equal(throttled.headers["retry-after"] > 0, true);

  const service = () => app.inject({ method: "POST", url: "/api/service-requests", payload: { table: "05", type: "water" } });
  assert.equal((await service()).statusCode, 201);
  assert.equal((await service()).statusCode, 429);

  const catalogStillOpen = await app.inject({ method: "GET", url: "/api/catalog" });
  assert.equal(catalogStillOpen.statusCode, 200);
});

test("responses carry hardening headers", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-headers-"));
  const app = await buildServer({
    databasePath: path.join(directory, "restaurant.sqlite"),
    uploadDir: path.join(directory, "media"),
    adminToken: "test-admin-token",
    logger: false
  });
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const response = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.equal(response.headers["x-frame-options"], "SAMEORIGIN");
});

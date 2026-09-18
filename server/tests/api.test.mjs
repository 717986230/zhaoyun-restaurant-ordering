import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "../index.mjs";
import { renderReceipt } from "../print-agent.mjs";

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

  const seededSpacedCategory = catalogProducts.find((product) => product.category.includes(" "));
  assert.ok(seededSpacedCategory, "seed catalog contains a category with a space");
  const resaveSpacedCategory = await app.inject({
    method: "PUT",
    url: `/api/admin/products/${seededSpacedCategory.id}`,
    headers: adminHeaders,
    payload: {
      sku: seededSpacedCategory.sku,
      kind: seededSpacedCategory.kind,
      category: seededSpacedCategory.category,
      names: seededSpacedCategory.names,
      description: seededSpacedCategory.description,
      price: seededSpacedCategory.price,
      details: seededSpacedCategory.details,
      allergens: seededSpacedCategory.allergens,
      modifiers: seededSpacedCategory.modifiers ?? [],
      printStation: seededSpacedCategory.printStation,
      available: true,
      published: true
    }
  });
  assert.equal(resaveSpacedCategory.statusCode, 200);
  assert.equal(resaveSpacedCategory.json().product.category, seededSpacedCategory.category);

  const service = await app.inject({
    method: "POST",
    url: "/api/service-requests",
    payload: { table: "12", type: "pay" }
  });
  assert.equal(service.statusCode, 201);
  const serviceRequest = service.json().request;
  // The DTO, not the row: `table_no` and friends must not reach a client.
  assert.deepEqual(Object.keys(serviceRequest).sort(), ["createdAt", "id", "status", "table", "type", "updatedAt"]);
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

test("table bill splits VAT by rate and prints once", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-bill-"));
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
  const catalog = (await app.inject({ method: "GET", url: "/api/catalog" })).json().products;
  const food = catalog.find((product) => product.sku === "R1");
  const drink = catalog.find((product) => product.kind === "drink");
  assert.equal(food.vatPercent, 10);
  assert.equal(drink.vatPercent, 20);

  await app.inject({
    method: "POST",
    url: "/api/orders",
    payload: { clientRequestId: "bill-order-0001", table: "07", note: "", items: [{ id: food.id, qty: 2 }, { id: drink.id, qty: 1 }] }
  });

  const preview = (await app.inject({ method: "GET", url: "/api/admin/tables/07/bill", headers: adminHeaders })).json().bill;
  const grossFood = food.price * 2;
  const expectedTotal = Number((grossFood + drink.price).toFixed(2));
  assert.equal(preview.total, expectedTotal);
  assert.equal(preview.fiscalReceipt, false);
  assert.deepEqual(preview.vatBreakdown.map((group) => group.percent), [10, 20]);
  const reduced = preview.vatBreakdown.find((group) => group.percent === 10);
  assert.equal(reduced.gross, grossFood);
  assert.equal(Number((reduced.net + reduced.vat).toFixed(2)), grossFood);
  assert.equal(reduced.net, Math.round((grossFood * 100) / 1.1) / 100);

  const settled = (await app.inject({ method: "POST", url: "/api/admin/tables/07/bill/settle", headers: adminHeaders })).json().bill;
  assert.equal(settled.total, expectedTotal);
  assert.ok(settled.printJobId);

  const jobs = (await app.inject({ method: "GET", url: "/api/admin/print-jobs?status=queued", headers: adminHeaders })).json().jobs;
  const billJob = jobs.find((job) => job.payload.kind === "bill");
  assert.equal(billJob.printerRole, "front");
  assert.equal(billJob.payload.table, "07");

  const emptied = await app.inject({ method: "GET", url: "/api/admin/tables/07/bill", headers: adminHeaders });
  assert.deepEqual(emptied.json().bill.items, []);
  const again = await app.inject({ method: "POST", url: "/api/admin/tables/07/bill/settle", headers: adminHeaders });
  assert.equal(again.statusCode, 409);

  const orders = (await app.inject({ method: "GET", url: "/api/orders", headers: adminHeaders })).json().orders;
  assert.ok(orders[0].billedAt);
});

test("allergen codes are validated and normalized", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-allergens-"));
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
  const base = {
    sku: "TEST-ALLERGEN-01",
    kind: "food",
    category: "MAIN",
    names: { zh: "测试", de: "Test", en: "Test" },
    price: 9.9,
    printStation: "kitchen",
    published: true,
    available: true
  };

  const rejected = await app.inject({ method: "POST", url: "/api/admin/products", headers: adminHeaders, payload: { ...base, allergens: ["Gluten"] } });
  assert.equal(rejected.statusCode, 400);

  const created = await app.inject({ method: "POST", url: "/api/admin/products", headers: adminHeaders, payload: { ...base, allergens: ["G", "A", "A"] } });
  assert.equal(created.statusCode, 201);
  assert.deepEqual(created.json().product.allergens, ["A", "G"]);
  assert.equal(created.json().product.vatPercent, 10);
});

test("registered tables require their own token", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-tables-"));
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
  const dish = (await app.inject({ method: "GET", url: "/api/catalog" })).json().products[0];
  const order = (id, table, headers = {}) => app.inject({
    method: "POST",
    url: "/api/orders",
    headers,
    payload: { clientRequestId: id, table, note: "", items: [{ id: dish.id, qty: 1 }] }
  });

  // An empty registry keeps a fresh install usable.
  assert.equal((await order("open-mode-0001", "09")).statusCode, 201);

  const registered = (await app.inject({ method: "POST", url: "/api/admin/tables", headers: adminHeaders, payload: { table: "t-9", label: "Terrasse" } })).json().table;
  assert.equal(registered.table, "T-9");
  assert.ok(registered.token.length >= 12);

  assert.equal((await order("guarded-0001", "T-9")).statusCode, 403);
  assert.equal((await order("guarded-0002", "T-9", { "x-table-token": "wrong" })).statusCode, 403);
  assert.equal((await order("guarded-0003", "99", { "x-table-token": registered.token })).statusCode, 403);

  const accepted = await order("guarded-0004", "t-9", { "x-table-token": registered.token });
  assert.equal(accepted.statusCode, 201);
  assert.equal(accepted.json().order.table, "T-9");

  const service = await app.inject({ method: "POST", url: "/api/service-requests", headers: { "x-table-token": registered.token }, payload: { table: "T-9", type: "water" } });
  assert.equal(service.statusCode, 201);
  const deniedService = await app.inject({ method: "POST", url: "/api/service-requests", payload: { table: "T-9", type: "water" } });
  assert.equal(deniedService.statusCode, 403);

  const listed = (await app.inject({ method: "GET", url: "/api/admin/tables", headers: adminHeaders })).json().tables;
  assert.deepEqual(listed.map((row) => row.table), ["T-9"]);
  const rotated = (await app.inject({ method: "POST", url: "/api/admin/tables", headers: adminHeaders, payload: { table: "T-9", rotateToken: true } })).json().table;
  assert.notEqual(rotated.token, registered.token);
  assert.equal((await order("guarded-0005", "T-9", { "x-table-token": registered.token })).statusCode, 403);
});

test("bill tickets carry localized names", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-bill-i18n-"));
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
  const dish = (await app.inject({ method: "GET", url: "/api/catalog" })).json().products.find((product) => product.sku === "R1");
  await app.inject({ method: "POST", url: "/api/orders", payload: { clientRequestId: "bill-i18n-0001", table: "04", note: "", items: [{ id: dish.id, qty: 1 }] } });
  const bill = (await app.inject({ method: "GET", url: "/api/admin/tables/04/bill", headers: adminHeaders })).json().bill;
  assert.equal(bill.items[0].names.de, dish.names.de);

  const settled = await app.inject({ method: "POST", url: "/api/admin/tables/04/bill/settle", headers: adminHeaders });
  assert.equal(settled.statusCode, 200);
  const jobs = (await app.inject({ method: "GET", url: "/api/admin/print-jobs?status=queued", headers: adminHeaders })).json().jobs;
  const billJob = jobs.find((job) => job.payload.kind === "bill");
  const ticket = renderReceipt(billJob.payload, { capabilities: { printLanguage: "de", encoding: "utf8" } }).toString("utf8");
  assert.match(ticket, /Rechnung/);
  assert.match(ticket, new RegExp(dish.names.de));
  assert.match(ticket, /kein Kassenbeleg/);
});

test("the settle list and table validation do not depend on the recent-order window", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-open-tables-"));
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
  const dish = (await app.inject({ method: "GET", url: "/api/catalog" })).json().products[0];
  const order = (id, table) => app.inject({
    method: "POST",
    url: "/api/orders",
    payload: { clientRequestId: id, table, note: "", items: [{ id: dish.id, qty: 1 }] }
  });

  // The board pages orders; the settle list must not inherit that window.
  await order("window-oldest-0001", "01");
  await order("window-newest-0001", "02");

  const page = (await app.inject({ method: "GET", url: "/api/orders?limit=1", headers: adminHeaders })).json().orders;
  assert.equal(page.length, 1);
  assert.equal(page[0].table, "02", "the page shows the newest order only");

  const openTables = (await app.inject({ method: "GET", url: "/api/admin/tables/open", headers: adminHeaders })).json().tables;
  assert.deepEqual(openTables, ["01", "02"]);

  const rejected = await order("window-invalid-0001", "THIS-TABLE-IS-FAR-TOO-LONG");
  assert.equal(rejected.statusCode, 400);
});

test("roles separate the floor from the office, and writes are recorded", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-roles-"));
  const app = await buildServer({
    databasePath: path.join(directory, "restaurant.sqlite"),
    uploadDir: path.join(directory, "media"),
    adminToken: "test-manager-token",
    staffToken: "test-staff-token",
    kitchenToken: "test-kitchen-token",
    logger: false
  });
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const manager = { "x-admin-token": "test-manager-token" };
  const staff = { "x-admin-token": "test-staff-token" };
  const kitchen = { "x-admin-token": "test-kitchen-token" };

  assert.equal((await app.inject({ method: "GET", url: "/api/admin/session", headers: manager })).json().role, "manager");
  assert.equal((await app.inject({ method: "GET", url: "/api/admin/session", headers: staff })).json().role, "staff");
  assert.equal((await app.inject({ method: "GET", url: "/api/admin/session", headers: kitchen })).json().role, "kitchen");

  const dish = (await app.inject({ method: "GET", url: "/api/catalog" })).json().products[0];
  const created = await app.inject({
    method: "POST",
    url: "/api/orders",
    payload: { clientRequestId: "role-order-0001", table: "06", note: "", items: [{ id: dish.id, qty: 1 }] }
  });
  const orderId = created.json().order.id;

  // Kitchen moves orders along and sees nothing else.
  assert.equal((await app.inject({ method: "PATCH", url: `/api/orders/${orderId}/status`, headers: kitchen, payload: { status: "preparing" } })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/api/service-requests", headers: kitchen })).statusCode, 403);
  assert.equal((await app.inject({ method: "GET", url: "/api/admin/products", headers: kitchen })).statusCode, 403);

  // Staff runs the floor but must not touch prices or the catalog.
  assert.equal((await app.inject({ method: "GET", url: "/api/service-requests", headers: staff })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/api/admin/tables/06/bill/settle", headers: staff })).statusCode, 200);
  const priceEdit = await app.inject({
    method: "PUT",
    url: `/api/admin/products/${dish.id}`,
    headers: staff,
    payload: { sku: dish.sku, kind: dish.kind, category: dish.category, names: dish.names, price: 0.01, printStation: dish.printStation }
  });
  assert.equal(priceEdit.statusCode, 403);
  assert.equal((await app.inject({ method: "DELETE", url: `/api/admin/products/${dish.id}`, headers: staff })).statusCode, 403);
  assert.equal((await app.inject({ method: "GET", url: "/api/admin/audit", headers: staff })).statusCode, 403);

  const unchanged = (await app.inject({ method: "GET", url: "/api/catalog" })).json().products.find((row) => row.id === dish.id);
  assert.equal(unchanged.price, dish.price, "the refused edit must not have changed the price");

  const entries = (await app.inject({ method: "GET", url: "/api/admin/audit", headers: manager })).json().entries;
  const kitchenAdvance = entries.find((row) => row.role === "kitchen" && row.method === "PATCH" && row.status === 200);
  assert.equal(kitchenAdvance.detail.status, "preparing");
  const refusedEdit = entries.find((row) => row.role === "staff" && row.status === 403 && row.method === "PUT");
  assert.equal(refusedEdit.detail.denied, "manager");
  assert.ok(entries.some((row) => row.role === "staff" && row.method === "POST" && row.route.includes("settle")));
  // Reads are noise in an audit log; only writes and refusals are kept.
  assert.equal(entries.some((row) => row.method === "GET" && row.status === 200), false);
});

test("optional role tokens are rejected when they collide or are too weak", async () => {
  await assert.rejects(
    () => buildServer({ adminToken: "same-token-for-both", staffToken: "same-token-for-both", logger: false }),
    /STAFF_TOKEN must differ from ADMIN_TOKEN/
  );
  await assert.rejects(
    () => buildServer({ isProduction: true, adminToken: "a".repeat(32), staffToken: "too-short", logger: false }),
    /Production STAFF_TOKEN must be at least 32 characters/
  );
});

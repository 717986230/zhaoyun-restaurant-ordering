import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDatabase } from "../database.mjs";
import { buildServer } from "../index.mjs";
import { createStore } from "../../shared/store.mjs";

/**
 * Tenant isolation: two restaurants (t_default and t_second) over the one
 * database. The default store is the first tenant; `withTenant` is the
 * second. Nothing one writes may be read, changed or paid by the other.
 */

async function openDatabase(context, { provision = true } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-tenant-"));
  const database = createDatabase(path.join(directory, "restaurant.sqlite"));
  context.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const tenant = await database.createTenant({ slug: "second", name: "Second" });
  const second = database.withTenant(tenant.id);
  if (provision) await second.provisionTenant(tenant.id);
  return { database, tenant, second, directory };
}

const productInput = (sku) => ({
  sku, kind: "food", category: "RAMEN",
  names: { zh: "隔离测试", de: "", en: "" },
  price: 9.9, printStation: "kitchen", published: true, available: true,
});

async function orderOn(store, product, table, requestId) {
  return store.createOrder({
    clientRequestId: requestId, table, note: "",
    items: [{ id: product.id, qty: 1 }],
  });
}

async function checkoutOn(store, table) {
  const bill = await store.billForTable(table);
  assert.ok(bill.items.length, "the table has a bill to pay");
  return store.checkout({
    clientRequestId: `checkout-${table}-${store.tenantId}`,
    table,
    items: bill.items.map((item) => ({ orderItemId: item.orderItemId, quantity: item.qty })),
    payments: [{ type: "cash", amount: bill.total, tendered: bill.total }],
  }, "manager");
}

test("a tenant is created and provisioned with its own catalogue", async (context) => {
  const { database, tenant, second } = await openDatabase(context);
  assert.equal(tenant.id, "t_second");
  assert.equal(tenant.slug, "second");
  assert.equal(tenant.name, "Second");
  assert.deepEqual((await database.listTenants()).map((row) => row.id), ["t_default", "t_second"]);

  const firstProducts = await database.listProducts();
  const secondProducts = await second.listProducts();
  assert.equal(secondProducts.length, firstProducts.length, "the seed catalogue is copied whole");
  assert.deepEqual(
    secondProducts.map((product) => product.sku).sort(),
    firstProducts.map((product) => product.sku).sort(),
    "the same dishes, under new ids",
  );
  assert.ok(secondProducts.every((product) => product.id.startsWith("t_second-")));
  assert.ok(!secondProducts.some((product) => firstProducts.some((first) => first.id === product.id)));

  // A set menu's bundle points at the second tenant's own dishes.
  const setMenu = secondProducts.find((product) => product.bundleItems?.length);
  assert.ok(setMenu, "a set menu was copied");
  const dishIds = new Set(secondProducts.map((product) => product.id));
  assert.ok(setMenu.bundleItems.every((item) => dishIds.has(item.productId)));

  // The photos were copied too, under new files the second tenant owns.
  const media = await second.driver.all(
    "SELECT product_media.*, media_files.tenant_id AS file_tenant FROM product_media JOIN media_files ON media_files.id = substr(product_media.url, 8) WHERE product_media.tenant_id = ? LIMIT 1",
    "t_second",
  );
  assert.ok(media.length, "a copied photo exists");
  assert.equal(media[0].file_tenant, "t_second");

  // Provisioning twice copies nothing again.
  assert.equal((await second.provisionTenant("t_second")).skipped, true);
  assert.equal((await second.listProducts()).length, firstProducts.length);
});

test("products, staff, customers and tables do not cross tenants", async (context) => {
  const { database, second } = await openDatabase(context);

  // The same SKU, staff name, customer email and table number in both.
  const firstDish = await database.saveProduct(productInput("ISO-1"));
  const secondDish = await second.saveProduct(productInput("ISO-1"));
  assert.notEqual(firstDish.id, secondDish.id);
  assert.equal((await database.getProduct(secondDish.id)), null);
  assert.equal((await second.getProduct(firstDish.id)), null);
  assert.equal(await second.deleteProduct(firstDish.id), false);
  assert.equal((await database.listProducts()).some((product) => product.sku === "ISO-1"), true);
  assert.equal((await second.listProducts()).some((product) => product.id === firstDish.id), false);

  const firstStaff = await database.saveStaff({ name: "Anna", role: "staff", pin: "1234" });
  const secondStaff = await second.saveStaff({ name: "Anna", role: "staff", pin: "1234" });
  assert.notEqual(firstStaff.id, secondStaff.id);
  assert.equal((await database.listStaff()).some((row) => row.id === secondStaff.id), false);
  const firstDevice = await database.pairDevice("Tablet A");
  assert.equal(await second.posSignIn(firstDevice.device, firstStaff.id, "1234"), null);

  const firstCustomer = await database.customers.register({ email: "guest@example.com", name: "Guest", password: "guest-pass-1" });
  const secondCustomer = await second.customers.register({ email: "guest@example.com", name: "Guest", password: "guest-pass-1" });
  assert.notEqual(firstCustomer.customer.id, secondCustomer.customer.id);
  assert.equal((await database.customers.byLogin("guest@example.com"))?.id, firstCustomer.customer.id);
  assert.equal((await second.customers.byLogin("guest@example.com"))?.id, secondCustomer.customer.id);
  // A session signed in on one tenant is nothing on the other.
  assert.equal(await second.customers.session(firstCustomer.token), null);
  assert.equal((await database.customers.session(firstCustomer.token))?.id, firstCustomer.customer.id);

  const firstTable = await database.saveTable({ table: "5" });
  const secondTable = await second.saveTable({ table: "5" });
  assert.notEqual(firstTable.token, secondTable.token);
  assert.equal(await second.deleteTable("5"), true);
  assert.ok(await database.getTable("5"), "deleting the second tenant's table leaves the first's");
});

test("orders, receipts and their numbers are per tenant", async (context) => {
  const { database, second } = await openDatabase(context);
  const firstProduct = (await database.listProducts(true))[0];
  const secondProduct = (await second.listProducts(true))[0];

  const firstOrder = await orderOn(database, firstProduct, "01", "iso-first-0001");
  const secondOrder = await orderOn(second, secondProduct, "01", "iso-second-0001");
  assert.notEqual(firstOrder.id, secondOrder.id);

  assert.deepEqual((await database.listOrders()).map((order) => order.id), [firstOrder.id]);
  assert.deepEqual((await second.listOrders()).map((order) => order.id), [secondOrder.id]);

  // Neither tenant can read, cancel or pay the other's order.
  assert.equal(await second.updateOrder(firstOrder.id, "cancelled"), null);
  assert.equal((await database.listOrders())[0].status, "new");
  assert.equal((await second.billForTable("01")).items.length, 1);
  assert.equal((await database.billForTable("01")).items.length, 1);

  // Receipt numbers run from 1 in each tenant.
  const firstReceipt = await checkoutOn(database, "01");
  const secondReceipt = await checkoutOn(second, "01");
  assert.equal(firstReceipt.receiptNo, 1);
  assert.equal(secondReceipt.receiptNo, 1);
  assert.equal(await second.getReceipt(firstReceipt.id), null);
  assert.equal(await database.getReceipt(secondReceipt.id), null);
  assert.deepEqual((await database.listReceipts()).map((row) => row.receiptNo), [1]);
  assert.deepEqual((await second.listReceipts()).map((row) => row.receiptNo), [1]);

  // The default tenant's data is untouched by the second's writes.
  const secondAgain = await orderOn(second, secondProduct, "02", "iso-second-0002");
  await checkoutOn(second, "02");
  assert.deepEqual((await database.listOrders()).map((order) => order.id), [firstOrder.id]);
  assert.deepEqual((await database.listReceipts()).map((row) => row.receiptNo), [1]);
  assert.equal(secondAgain.table, "02");
});

test("settings and the journal are per tenant", async (context) => {
  const { database, second } = await openDatabase(context);
  await database.saveSettings({ restaurantName: "First", menuTheme: "teal" });
  await second.saveSettings({ restaurantName: "Second" });
  assert.equal((await database.getSettings()).restaurantName, "First");
  assert.equal((await database.getSettings()).menuTheme, "teal");
  assert.equal((await second.getSettings()).restaurantName, "Second");
  assert.equal((await second.getSettings()).menuTheme, "jade");

  const product = (await database.listProducts(true))[0];
  await orderOn(database, product, "03", "iso-journal-0001");
  const firstJournal = await database.exportJournal("2000-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z");
  const secondJournal = await second.exportJournal("2000-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z");
  assert.equal(firstJournal.verification.ok, true);
  assert.equal(secondJournal.verification.ok, true);
  assert.ok(firstJournal.entries.length > 0);
  assert.equal(secondJournal.entries.length, 0, "the second tenant has written nothing yet");
});

test("owner password view/change, invites and tenant tokens", async (context) => {
  const { database, second } = await openDatabase(context);
  const viewKey = randomBytes(32).toString("base64");
  const keyed = createStore(database.driver, { passwordViewKey: viewKey });

  await database.registerAccount({ login: "owner", name: "Owner", password: "owner-pass-1" });
  // No view key, no copy: nothing to see.
  assert.equal(await database.viewAccountPassword("missing"), null);

  const invited = await keyed.inviteAccount({ tenantId: "t_second", login: "second-admin", name: "Second Admin", email: "second@example.com" });
  assert.equal(invited.account.tenantId, "t_second");
  assert.equal(invited.account.role, "admin");
  assert.equal(typeof invited.token, "string");
  assert.ok(invited.token.length > 20);
  const stored = await database.driver.first("SELECT token_hash FROM account_tokens WHERE account_id = ?", invited.account.id);
  assert.notEqual(stored.token_hash, invited.token, "only the hash is stored");
  // No password yet: the invite cannot sign in.
  assert.equal(await database.signInAccount("second-admin", "second-pass-1"), null);

  const used = await keyed.useAccountToken(invited.token, { password: "second-pass-1" });
  assert.equal(used?.id, invited.account.id);
  assert.equal(await keyed.useAccountToken(invited.token, { password: "second-pass-1" }), null, "a link works once");
  assert.ok(await database.signInAccount("second-admin", "second-pass-1"), "the invite's password signs in");

  // The owner sees the password only with the view key configured.
  assert.equal(await keyed.viewAccountPassword(invited.account.id), "second-pass-1");
  assert.equal(await database.viewAccountPassword(invited.account.id), null);
  await keyed.setAccountPassword(invited.account.id, { password: "second-pass-2" });
  assert.equal(await keyed.viewAccountPassword(invited.account.id), "second-pass-2");
  assert.ok(await database.signInAccount("second-admin", "second-pass-2"));
  assert.equal(await database.signInAccount("second-admin", "second-pass-1"), null, "the old password dies");

  // A reset link: unknown logins stay unknown, and the link sets a new password.
  assert.equal(await keyed.requestPasswordReset("nobody"), null);
  const reset = await keyed.requestPasswordReset("second-admin");
  assert.ok(reset?.token);
  assert.ok(await keyed.useAccountToken(reset.token, { password: "second-pass-3" }));
  assert.ok(await database.signInAccount("second-admin", "second-pass-3"));

  // Tenant role tokens.
  const kitchen = await keyed.createTenantToken("t_second", "kitchen");
  const found = await keyed.tenantTokenFor(kitchen.token);
  assert.equal(found?.tenantId, "t_second");
  assert.equal(found?.role, "kitchen");
  assert.ok(found?.createdAt);
  assert.equal(await keyed.tenantTokenFor("no-such-token"), null);
  assert.equal(second.tenantId, "t_second");
});

test("purgeExpired sweeps only what is past its life", async (context) => {
  const { database } = await openDatabase(context, { provision: false });
  await database.driver.run(
    "INSERT INTO mail_outbox (tenant_id, id, to_email, subject, text, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    "t_default", "old-mail-1", "old@example.com", "old", "old", "2020-01-01T00:00:00.000Z",
  );
  await database.customers.recordOutbox({ to: "new@example.com", subject: "new", text: "new" });
  const counts = await database.purgeExpired();
  assert.deepEqual(Object.keys(counts).sort(), [
    "accountSessions", "accountTokens", "auditLog", "authThrottle",
    "customerSessions", "emailCodes", "mailOutbox", "posSessions",
  ]);
  assert.equal(counts.mailOutbox, 1);
  assert.equal((await database.customers.outbox(10)).length, 1, "the fresh message survives");
  assert.equal((await database.customers.outbox(10))[0].to, "new@example.com");
});

test("the HTTP layer still serves the default tenant's catalogue only", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-tenant-http-"));
  const databasePath = path.join(directory, "restaurant.sqlite");
  const database = createDatabase(databasePath);
  const tenant = await database.createTenant({ slug: "second", name: "Second" });
  const second = database.withTenant(tenant.id);
  await second.provisionTenant(tenant.id);
  const onlySecond = await second.saveProduct(productInput("SECOND-ONLY"));
  assert.equal(onlySecond.sku, "SECOND-ONLY");
  database.close();

  // A request that names no tenant resolves to the default tenant, so the
  // second tenant's dish must not leak into it.
  const app = await buildServer({
    databasePath, uploadDir: path.join(directory, "media"),
    adminToken: "test-admin-token-for-tenant-http", logger: false,
  });
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const catalog = await app.inject({ method: "GET", url: "/api/catalog" });
  assert.equal(catalog.statusCode, 200);
  const products = catalog.json().products;
  assert.ok(products.length > 0);
  assert.equal(products.some((product) => product.sku === "SECOND-ONLY"), false);
  assert.equal(products.some((product) => product.id === onlySecond.id), false);
});

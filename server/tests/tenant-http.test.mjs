import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createDatabase } from "../database.mjs";
import { buildServer } from "../index.mjs";

/**
 * The owner routes over HTTP (shared/http.mjs): a tenant is opened and
 * provisioned, its admin is invited and sets their own password, the owner
 * can view and change that password, and nothing crosses tenants — not the
 * catalogue, not the orders, not a status change, not the export or the
 * delete. The store-level isolation is server/tests/tenant-isolation.test.mjs;
 * this is the same proof through the API a client actually calls.
 */

const productInput = (sku) => ({
  sku, kind: "food", category: "RAMEN",
  names: { zh: "隔离测试", de: "", en: "" },
  price: 9.9, printStation: "kitchen", published: true, available: true,
});

async function openServer(context) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-tenant-http-"));
  const databasePath = path.join(directory, "restaurant.sqlite");
  const viewKey = randomBytes(32).toString("base64");
  const app = await buildServer({
    databasePath, uploadDir: path.join(directory, "media"),
    adminToken: "tenant-http-admin-token-tenant-http-admin-token",
    passwordViewKey: viewKey, mail: { provider: "outbox" }, logger: false,
  });
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { app, databasePath, directory };
}

const signIn = (app, login, password) =>
  app.inject({ method: "POST", url: "/api/account/sign-in", payload: { login, password } });

test("the owner opens a restaurant, invites its admin, and the admin sees only their restaurant", async (context) => {
  const { app, databasePath } = await openServer(context);
  const owner = (await app.inject({ method: "POST", url: "/api/account/register", payload: { login: "owner", name: "Owner", password: "owner-pass-1" } }));
  assert.equal(owner.statusCode, 201, owner.body);
  const ownerToken = owner.json().token;
  const ownerHeaders = { "x-admin-token": ownerToken };
  assert.equal(owner.json().account.role, "owner");

  // The owner opens a second restaurant; a tenant admin may not.
  const created = await app.inject({ method: "POST", url: "/api/admin/tenants", headers: ownerHeaders, payload: { slug: "nope", name: "Nope" } });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().tenant.id, "t_nope");
  const tenants = (await app.inject({ method: "GET", url: "/api/admin/tenants", headers: ownerHeaders })).json().tenants;
  assert.deepEqual(tenants.map((row) => row.id), ["t_default", "t_nope"]);

  // The invite, by email: no token in the response, the link in the outbox.
  const invited = await app.inject({
    method: "POST", url: "/api/account/invite", headers: ownerHeaders,
    payload: { tenantId: "t_nope", login: "nope-admin", name: "Nope Admin", email: "nope@example.com" },
  });
  assert.equal(invited.statusCode, 201, invited.body);
  assert.equal(invited.json().token, undefined, "an emailed invite keeps its token out of the response");
  assert.match(invited.json().inviteUrl, /\/set-password\?token=/);
  // The invite mail is recorded in the invited tenant's outbox, not the
  // owner's — the outbox is tenant data, like everything else.
  const reader = createDatabase(databasePath);
  const inviteMail = (await reader.withTenant("t_nope").customers.outbox(50)).find((message) => message.to === "nope@example.com");
  reader.close();
  assert.ok(inviteMail, "the invite was emailed");
  const token = inviteMail.text.match(/set-password\?token=(\S+)/)?.[1];
  assert.ok(token, "the link carries the token");

  // The link sets the password, once.
  const set = await app.inject({ method: "POST", url: "/api/account/set-password", payload: { token, password: "nope-pass-1" } });
  assert.equal(set.statusCode, 200, set.body);
  assert.equal(set.json().account.login, "nope-admin");
  assert.equal(set.json().account.role, "admin");
  assert.equal(set.json().account.tenantId, "t_nope");
  const spent = await app.inject({ method: "POST", url: "/api/account/set-password", payload: { token, password: "nope-pass-2" } });
  assert.equal(spent.statusCode, 401, "a link works once");
  const signedIn = await signIn(app, "nope-admin", "nope-pass-1");
  assert.equal(signedIn.statusCode, 200, signedIn.body);
  const adminToken = signedIn.json().token;
  const adminHeaders = { "x-admin-token": adminToken };

  // The admin's session is their tenant: the catalogue is theirs, even when
  // the query names the default restaurant — the session wins over the slug.
  const catalog = (await app.inject({ method: "GET", url: "/api/catalog?restaurant=default", headers: adminHeaders })).json();
  assert.ok(catalog.products.length > 0);
  assert.ok(catalog.products.every((product) => product.id.startsWith("t_nope-")), "no default-tenant dish leaks in");
  // And the public catalogue, without a session, is the default tenant's.
  const publicCatalog = (await app.inject({ method: "GET", url: "/api/catalog" })).json();
  assert.ok(publicCatalog.products.every((product) => !product.id.startsWith("t_nope-")));
  const secondCatalog = (await app.inject({ method: "GET", url: "/api/catalog?restaurant=nope" })).json();
  assert.ok(secondCatalog.products.every((product) => product.id.startsWith("t_nope-")), "the slug names the restaurant for guests");

  // The owner sees the password the admin set, and changes it; the admin
  // may not see anyone's password, including their own.
  const accountId = set.json().account.id;
  const seen = await app.inject({ method: "GET", url: `/api/admin/accounts/${accountId}/password`, headers: ownerHeaders });
  assert.equal(seen.statusCode, 200, seen.body);
  assert.equal(seen.json().password, "nope-pass-1");
  const denied = await app.inject({ method: "GET", url: `/api/admin/accounts/${accountId}/password`, headers: adminHeaders });
  assert.equal(denied.statusCode, 403, "a tenant admin is not the owner");
  const refusedTenant = await app.inject({ method: "POST", url: "/api/admin/tenants", headers: adminHeaders, payload: { slug: "other", name: "Other" } });
  assert.equal(refusedTenant.statusCode, 403, "a tenant admin may not open tenants either");
  const changed = await app.inject({ method: "PUT", url: `/api/admin/accounts/${accountId}/password`, headers: ownerHeaders, payload: { password: "nope-pass-2" } });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal((await signIn(app, "nope-admin", "nope-pass-1")).statusCode, 401, "the old password dies at once");
  assert.equal((await signIn(app, "nope-admin", "nope-pass-2")).statusCode, 200, "the new one works");
  assert.equal((await app.inject({ method: "GET", url: "/api/admin/accounts/no-such-id/password", headers: ownerHeaders })).statusCode, 404);

  // Forgot-password leaks nothing: an unknown login gets the same answer,
  // and the token never rides in the response.
  const forgotten = await app.inject({ method: "POST", url: "/api/account/forgot-password", payload: { login: "nobody" } });
  assert.deepEqual(forgotten.json(), { ok: true });
  const reset = await app.inject({ method: "POST", url: "/api/account/forgot-password", payload: { login: "nope-admin" } });
  assert.deepEqual(reset.json(), { ok: true });
  assert.equal(reset.json().token, undefined);
});

test("one tenant's order cannot be read or changed through the other's session", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-tenant-http-"));
  const databasePath = path.join(directory, "restaurant.sqlite");
  // One order in the default tenant, made before the server starts.
  const database = createDatabase(databasePath);
  const product = await database.saveProduct(productInput("DEFAULT-ONLY"));
  const order = await database.createOrder({
    clientRequestId: "cross-tenant-order", table: "5", note: "",
    items: [{ id: product.id, qty: 1 }],
  });
  const tenant = await database.createTenant({ slug: "second", name: "Second" });
  await database.withTenant(tenant.id).provisionTenant(tenant.id);
  database.close();

  const app = await buildServer({
    databasePath, uploadDir: path.join(directory, "media"),
    adminToken: "tenant-http-admin-token-tenant-http-admin-token",
    passwordViewKey: randomBytes(32).toString("base64"), mail: { provider: "outbox" }, logger: false,
  });
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const owner = (await app.inject({ method: "POST", url: "/api/account/register", payload: { login: "owner", name: "Owner", password: "owner-pass-1" } })).json();
  const ownerHeaders = { "x-admin-token": owner.token };
  const invited = (await app.inject({
    method: "POST", url: "/api/account/invite", headers: ownerHeaders,
    payload: { tenantId: "t_second", login: "second-admin" },
  })).json();
  assert.ok(invited.token, "without an email the owner gets the token to hand over");
  await app.inject({ method: "POST", url: "/api/account/set-password", payload: { token: invited.token, password: "second-pass-1" } });
  const adminToken = (await signIn(app, "second-admin", "second-pass-1")).json().token;
  const adminHeaders = { "x-admin-token": adminToken };

  // The second tenant's order list is empty: the default tenant's order is not in it.
  const secondOrders = (await app.inject({ method: "GET", url: "/api/orders", headers: adminHeaders })).json().orders;
  assert.deepEqual(secondOrders, []);
  const defaultOrders = (await app.inject({ method: "GET", url: "/api/orders", headers: ownerHeaders })).json().orders;
  assert.equal(defaultOrders.some((row) => row.id === order.id), true);

  // And the status change the second tenant tries on it is not found there.
  const patched = await app.inject({
    method: "PATCH", url: `/api/orders/${order.id}/status`, headers: adminHeaders,
    payload: { status: "cancelled" },
  });
  assert.equal(patched.statusCode, 404, patched.body);
  const stillThere = (await app.inject({ method: "GET", url: "/api/orders", headers: ownerHeaders })).json().orders;
  assert.equal(stillThere.find((row) => row.id === order.id).status, "new", "untouched");
});

test("a tenant's export holds only its rows, and its delete leaves the others alone", async (context) => {
  const { app } = await openServer(context);
  const owner = (await app.inject({ method: "POST", url: "/api/account/register", payload: { login: "owner", name: "Owner", password: "owner-pass-1" } })).json();
  const ownerHeaders = { "x-admin-token": owner.token };
  const created = (await app.inject({ method: "POST", url: "/api/admin/tenants", headers: ownerHeaders, payload: { slug: "gone", name: "Gone" } })).json();
  assert.equal(created.tenant.id, "t_gone");
  assert.ok(created.provisioned.products > 0);

  const exported = (await app.inject({ method: "GET", url: "/api/admin/tenants/t_gone/export", headers: ownerHeaders })).json();
  assert.equal(exported.tenant.id, "t_gone");
  assert.ok(exported.tables.products.length > 0);
  assert.ok(exported.tables.products.every((row) => row.tenant_id === "t_gone"));
  assert.ok(Object.values(exported.tables).flat().every((row) => row.tenant_id === "t_gone"), "no other tenant's row in the export");

  // The default tenant cannot be deleted; an unknown one is not found.
  assert.equal((await app.inject({ method: "DELETE", url: "/api/admin/tenants/t_default", headers: ownerHeaders })).statusCode, 400);
  assert.equal((await app.inject({ method: "DELETE", url: "/api/admin/tenants/t_nope", headers: ownerHeaders })).statusCode, 404);

  const deleted = (await app.inject({ method: "DELETE", url: "/api/admin/tenants/t_gone", headers: ownerHeaders })).json();
  assert.equal(deleted.tenant.id, "t_gone");
  assert.ok(deleted.deleted.products > 0, "its dishes went");
  assert.equal((await app.inject({ method: "GET", url: "/api/admin/tenants", headers: ownerHeaders })).json().tenants.length, 1);
  assert.equal((await app.inject({ method: "GET", url: "/api/admin/tenants/t_gone/export", headers: ownerHeaders })).statusCode, 404);
  const catalog = (await app.inject({ method: "GET", url: "/api/catalog" })).json();
  assert.ok(catalog.products.length > 0, "the default tenant's menu is intact");
});

test("the export walks exactly the tables that carry a tenant", async (context) => {
  const { app, databasePath } = await openServer(context);
  const owner = (await app.inject({ method: "POST", url: "/api/account/register", payload: { login: "owner", name: "Owner", password: "owner-pass-1" } })).json();
  const exported = (await app.inject({ method: "GET", url: "/api/admin/tenants/t_default/export", headers: { "x-admin-token": owner.token } })).json();

  const raw = new DatabaseSync(databasePath);
  const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
  const withTenant = tables.filter((name) => raw.prepare(`PRAGMA table_info(${name})`).all().some((column) => column.name === "tenant_id"));
  raw.close();
  assert.deepEqual(Object.keys(exported.tables).sort(), withTenant, "a table added without tenant_id would show up here");
});

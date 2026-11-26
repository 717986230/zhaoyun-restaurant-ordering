import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createDatabase } from "../database.mjs";
import { generate, generatePhotos, generatePhotoRefresh, generateSets, committed, PHOTO_MIGRATION_LAST, REFRESH_HD_LAST } from "../../scripts/export-d1-migrations.mjs";
import { dishPhotos } from "../dish-photos.mjs";

function schemaOf(db) {
  return db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name").all();
}

function inTempDatabase(run) {
  const directory = mkdtempSync(path.join(tmpdir(), "zy-mig-"));
  try {
    return run(path.join(directory, "db.sqlite"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

/**
 * The hand-written migrations after 0001/0002, each with the objects it
 * exists to create. `drop` rebuilds the database that migration was written
 * for: one deployed before those objects were added to 0001.
 */
const incremental = [
  { file: "0003_admin_password_gate.sql", drop: "DROP INDEX idx_admin_sessions_expiry; DROP TABLE admin_sessions; DROP TABLE admin_gate;" },
  { file: "0004_app_settings.sql", drop: "DROP TABLE app_settings;" },
  // 0051 added a table 0052 takes away again: a database from before either
  // goes through both, and one that applied 0051 gets only 0052.
  { file: "0051_product_schedules.sql", then: "0052_drop_product_schedules.sql", drop: "" },
  { file: "0052_drop_product_schedules.sql", drop: readFileSync(path.join(migrationsDir, "0051_product_schedules.sql"), "utf8") },
  { file: "0053_order_item_vat_split.sql", drop: "DROP TABLE order_item_vat_splits;" },
  // Receipts come back without 0060's index, which 0060 then adds.
  { file: "0054_register.sql", then: "0060_receipts_created.sql", drop: "DROP INDEX idx_receipts_one_storno; DROP INDEX idx_receipt_items_item; DROP TABLE journal; DROP TABLE staff_settlements; DROP TABLE order_staff; DROP TABLE table_claims; DROP TABLE pos_sessions; DROP TABLE staff; DROP TABLE pos_devices; DROP TABLE day_closings; DROP TABLE vouchers; DROP TABLE receipt_items; DROP TABLE receipts;" },
  { file: "0055_accounts.sql", drop: "DROP INDEX idx_account_sessions_expiry; DROP TABLE account_sessions; DROP TABLE accounts;" },
  { file: "0056_item_voids.sql", drop: "DROP INDEX idx_order_item_voids_staff; DROP INDEX idx_order_item_voids_item; DROP TABLE order_item_voids;" },
  { file: "0057_customers.sql", drop: "DROP INDEX idx_guest_orders_customer; DROP INDEX idx_guest_orders_table; DROP INDEX idx_points_ledger_ref; DROP INDEX idx_points_ledger_customer; DROP INDEX idx_customer_sessions_expiry; DROP TABLE table_sessions; DROP TABLE guest_orders; DROP TABLE points_ledger; DROP TABLE customer_favorites; DROP TABLE customer_sessions; DROP TABLE customers;" },
  { file: "0058_print_bridge.sql", drop: "DROP TABLE printer_status; DROP TABLE print_bridges;" },
  { file: "0059_discovered_printers.sql", drop: "DROP TABLE discovered_printers;" },
  { file: "0060_receipts_created.sql", drop: "DROP INDEX idx_receipts_created;" },
  { file: "0061_auth_throttle.sql", drop: "DROP TABLE auth_throttle;" },
  { file: "0062_reservations.sql", drop: "DROP INDEX idx_reservations_customer; DROP INDEX idx_reservations_date; DROP TABLE reservations;" },
  { file: "0063_delivery_orders.sql", drop: "DROP INDEX idx_delivery_orders_status; DROP INDEX idx_delivery_orders_created; DROP TABLE delivery_orders;" },
  { file: "0064_product_stock.sql", drop: "DROP TABLE product_stock;" },
  { file: "0065_cash_drawer.sql", drop: "DROP INDEX idx_drawer_movements_session; DROP TABLE drawer_movements; DROP INDEX idx_drawer_sessions_closed; DROP TABLE drawer_sessions;" },
  { file: "0066_email_verification.sql", drop: "DROP TABLE mail_outbox; DROP TABLE customer_verified_emails; DROP INDEX idx_email_codes_customer; DROP TABLE email_codes;" },
  // Data only: it changes no table, on any database.
  { file: "0068_hide_hot_pot.sql", drop: "" },
  // Data only: the category tidy (CHIRI ROLLS -> URAMAKI ROLLS, TEA ->
  // NON-ALCOHOLIC); the seed already says it, this moves deployed rows.
  { file: "0111_category_cleanup.sql", drop: "" },
  { file: "0069_member_balance.sql", drop: "DROP INDEX idx_balance_ledger_ref; DROP INDEX idx_balance_ledger_customer; DROP TABLE balance_ledger; DROP TABLE member_balances;" },
  { file: "0070_member_birthday.sql", drop: "DROP TABLE member_birthdays;" },
  { file: "0071_birthday_greetings.sql", drop: "DROP TABLE birthday_greetings;" },
  { file: "0072_balance_operator.sql", drop: "DROP TABLE balance_operators;" },
  { file: "0073_waitlist.sql", drop: "DROP INDEX idx_waitlist_status; DROP TABLE waitlist;" },
  { file: "0074_reservation_reminders.sql", drop: "DROP TABLE reservation_reminders;" },
  // The collaborative-table flag and the table lock's fencing token.
  { file: "0108_shared_table_claims.sql", drop: "DROP TABLE table_claim_meta;" },
  { file: "0109_order_item_notes.sql", drop: "DROP TABLE order_item_notes;" },
  { file: "0110_order_item_holds.sql", drop: "DROP TABLE order_item_holds;" },
  { file: "0113_promotions.sql", drop: "DROP INDEX idx_promotions_tenant; DROP TABLE promotions;" },
  { file: "0114_member_marketing.sql", drop: "DROP TABLE broadcast_sends; DROP INDEX idx_broadcasts_tenant; DROP TABLE broadcasts; DROP INDEX idx_member_consent_token; DROP TABLE member_consent;" },
  { file: "0115_roster.sql", drop: "DROP INDEX idx_roster_shifts_date; DROP TABLE roster_shifts;" },
  // 0112 rebuilds every tenant table under the new definition: the drop
  // restores the pre-tenant shape of each one from a fixture built from the
  // 0001 that shipped before tenants.
  { file: "0112_multi_tenancy.sql", drop: readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "pre-tenant-schema.sql"), "utf8") },
  { file: "0118_query_indexes.sql", drop: "DROP INDEX idx_product_media_tenant_product; DROP INDEX idx_orders_open; DROP INDEX idx_service_requests_status;" }
].map((migration) => ({
  ...migration,
  sql: [migration.file, migration.then].filter(Boolean).map((file) => readFileSync(path.join(migrationsDir, file), "utf8")).join("\n")
}))
  // The photo parts each create media_files, so each has to stand alone on a
  // database deployed before that table existed.
  .concat([...committed().photos, ...committed().refresh].map((part) => ({ file: part.name, drop: "DROP TABLE media_files;", sql: part.sql })));

test("the committed migrations match the schema and seed the server creates", () => {
  const generated = generate();
  const onDisk = committed();
  assert.equal(onDisk.schema, generated.schema, "migrations/0001_init.sql is stale — run: npm run d1:migrations");
  assert.equal(onDisk.catalog, generated.catalog, "migrations/0002_seed_catalog.sql is stale — run: npm run d1:migrations");
  assert.deepEqual(onDisk.photos, generatePhotos(), "the dish photo migrations are stale — run: npm run d1:migrations");
  assert.deepEqual(onDisk.refresh, generatePhotoRefresh(), "the photo refresh migrations are stale — run: npm run d1:migrations");
  // The 800×600 batch keeps to 0100–0119, clear of the hand-written migrations.
  for (const part of onDisk.refresh) assert.ok(Number(part.name.slice(0, 4)) <= REFRESH_HD_LAST, `${part.name} runs past ${REFRESH_HD_LAST}`);
  assert.equal(onDisk.sets, generateSets(), "migrations/0050_set_menus.sql is stale — run: npm run d1:migrations");
  // The photo parts are numbered from 0005 up; they must never reach the set menus' number.
  for (const part of onDisk.photos) assert.ok(Number(part.name.slice(0, 4)) <= PHOTO_MIGRATION_LAST, `${part.name} would collide with 0050`);
});

/**
 * Every dish photo reaches D1 as the same bytes, under the same URL the Node
 * server gives it, and a D1 database that already had pictures keeps them.
 */
test("the photo migrations give D1 the dishes' photos, byte for byte", () => {
  const sql = committed();
  const photos = dishPhotos();
  const migrated = inTempDatabase((file) => {
    const db = new DatabaseSync(file);
    db.exec(sql.schema);
    db.exec(sql.catalog);
    // A dish the owner already gave a picture must not get a second one.
    if (photos.length) {
      db.prepare("INSERT INTO product_media (id, product_id, type, url, poster_url, sort_order, created_at) VALUES ('own', ?, 'image', '/media/own.jpg', NULL, 0, 'x')").run(photos[0].productId);
    }
    for (const part of sql.photos) db.exec(part.sql);
    const result = {
      media: db.prepare("SELECT product_id, url FROM product_media ORDER BY product_id, url").all(),
      files: db.prepare("SELECT id, bytes FROM media_files").all()
    };
    db.close();
    return result;
  });
  const seeded = inTempDatabase((file) => {
    createDatabase(file).close();
    const db = new DatabaseSync(file);
    const result = db.prepare("SELECT product_id, url FROM product_media ORDER BY product_id, url").all();
    db.close();
    return result;
  });

  // D1 refuses any single statement over 100 KB, and one photo is one statement.
  for (const part of sql.photos) {
    for (const statement of part.sql.split("\n")) assert.ok(statement.length < 100_000, `${part.name} has a ${statement.length}-byte statement`);
  }
  assert.equal(migrated.files.length, photos.length);
  for (const photo of photos) {
    const row = migrated.files.find((file) => file.id === photo.fileId);
    assert.ok(row, `${photo.fileId} is missing from D1`);
    assert.ok(Buffer.from(row.bytes).equals(photo.bytes), `${photo.fileId} changed on the way into D1`);
  }
  const withOwn = migrated.media.filter((item) => item.product_id === photos[0]?.productId);
  if (photos.length) assert.deepEqual(withOwn.map((item) => item.url), ["/media/own.jpg"]);
  // Apart from the dish given its own picture above, D1 and the Node server agree.
  assert.deepEqual(migrated.media.filter((item) => item.url !== "/media/own.jpg"), seeded.filter((item) => item.product_id !== photos[0]?.productId));
});

/**
 * A D1 that took the photo parts while the photos were 480×360 still shows
 * those: the parts never run again. The refresh swaps each seeded picture for
 * its 800×600 copy and drops the old bytes, and leaves alone a picture the
 * owner uploaded.
 */
test("the photo refresh migrations replace the seeded photos an earlier deploy put in D1", () => {
  const sql = committed();
  const replacing = dishPhotos().filter((photo) => photo.hd);
  assert.ok(replacing.length > 0, "expected photos at 800×600");
  assert.ok(sql.refresh.length > 0, "expected the photo refresh migrations");
  const [owned, ...seededBefore] = replacing;
  const migrated = inTempDatabase((file) => {
    const db = new DatabaseSync(file);
    db.exec(sql.schema);
    db.exec(sql.catalog);
    db.exec("CREATE TABLE IF NOT EXISTS media_files (id TEXT PRIMARY KEY, content_type TEXT NOT NULL, bytes BLOB NOT NULL, credit TEXT, source_url TEXT, created_at TEXT NOT NULL)");
    const media = db.prepare("INSERT INTO product_media (id, product_id, type, url, poster_url, sort_order, created_at) VALUES (?, ?, 'image', ?, NULL, 0, 'x')");
    const bytes = db.prepare("INSERT INTO media_files (id, content_type, bytes, credit, source_url, created_at) VALUES (?, 'image/jpeg', X'00', 'old', NULL, 'x')");
    for (const photo of seededBefore) {
      bytes.run(`dish-${photo.productId}-old.jpg`);
      media.run(`seed-dish-${photo.productId}-old.jpg`, photo.productId, `/media/dish-${photo.productId}-old.jpg`);
    }
    media.run("own", owned.productId, "/media/own.jpg");
    for (const part of sql.refresh) db.exec(part.sql);
    const result = {
      media: db.prepare("SELECT product_id, url FROM product_media").all(),
      files: db.prepare("SELECT id FROM media_files").all().map((row) => row.id)
    };
    db.close();
    return result;
  });

  for (const part of sql.refresh) {
    for (const statement of part.sql.split("\n")) assert.ok(statement.length < 100_000, `${part.name} has a ${statement.length}-byte statement`);
  }
  for (const photo of seededBefore) {
    assert.deepEqual(migrated.media.filter((item) => item.product_id === photo.productId).map((item) => item.url), [`/media/${photo.fileId}`]);
    assert.ok(migrated.files.includes(photo.fileId), `${photo.fileId} is missing from D1`);
    assert.ok(!migrated.files.includes(`dish-${photo.productId}-old.jpg`), `the old photo of ${photo.productId} is still stored`);
  }
  assert.deepEqual(migrated.media.filter((item) => item.product_id === owned.productId).map((item) => item.url), ["/media/own.jpg"]);
});

/**
 * The Node server's database gets the same swap when it starts: a dish still
 * showing a photo seeded earlier shows the new one.
 */
test("the Node server swaps a seeded photo for its replacement on start", () => {
  const [photo] = dishPhotos().filter((item) => item.hd);
  const url = inTempDatabase((file) => {
    createDatabase(file).close();
    let db = new DatabaseSync(file);
    db.prepare("DELETE FROM media_files WHERE id = ?").run(photo.fileId);
    db.prepare("UPDATE product_media SET url = '/media/dish-old.jpg' WHERE product_id = ?").run(photo.productId);
    db.close();
    createDatabase(file).close();
    db = new DatabaseSync(file);
    const rows = db.prepare("SELECT url FROM product_media WHERE product_id = ?").all(photo.productId).map((row) => row.url);
    db.close();
    return rows;
  });
  assert.deepEqual(url, [`/media/${photo.fileId}`]);
});

/**
 * The point of the migrations is that a D1 database ends up indistinguishable
 * from the one the Node server builds for itself. Applying them to an empty
 * SQLite file and diffing against that database is as close as this can be
 * checked without reaching Cloudflare.
 */
test("applying the migrations reproduces the server's database", () => {
  const sql = committed();

  const migrated = inTempDatabase((file) => {
    const db = new DatabaseSync(file);
    db.exec(sql.schema);
    db.exec(sql.catalog);
    db.exec(sql.sets);
    const result = {
      schema: schemaOf(db),
      products: db.prepare("SELECT * FROM products ORDER BY sort_order, id").all()
    };
    db.close();
    return result;
  });

  const seeded = inTempDatabase((file) => {
    createDatabase(file).close();
    const db = new DatabaseSync(file);
    const result = {
      schema: schemaOf(db),
      products: db.prepare("SELECT * FROM products ORDER BY sort_order, id").all()
    };
    db.close();
    return result;
  });

  assert.deepEqual(migrated.schema, seeded.schema);
  assert.equal(migrated.products.length, seeded.products.length);
  assert.ok(migrated.products.length > 100, `expected the full menu, got ${migrated.products.length}`);

  // Row timestamps are whenever each database was built; everything else has to
  // agree, the ids above all — an order placed from the app's bundled menu has
  // to name a product D1 knows.
  for (const [index, product] of migrated.products.entries()) {
    const { created_at: _c, updated_at: _u, ...actual } = product;
    const { created_at: _c2, updated_at: _u2, ...expected } = seeded.products[index];
    assert.deepEqual(actual, expected, `product ${product.sku} differs after migration`);
  }
});

/**
 * Wrangler applies each migration file once per database and never again, so
 * every hand-written migration meets two kinds of database in practice: one
 * created from today's 0001, which already has what it adds, and one deployed
 * before that existed, which does not. Both must end up where the Node server
 * does — the first untouched, the second brought up to date.
 */
test("the incremental migrations are no-ops on a fresh database and bring a deployed one up to date", () => {
  const sql = committed();
  const expected = inTempDatabase((file) => {
    createDatabase(file).close();
    const db = new DatabaseSync(file);
    const result = schemaOf(db);
    db.close();
    return result;
  });

  const fresh = inTempDatabase((file) => {
    const db = new DatabaseSync(file);
    db.exec(sql.schema);
    db.exec(sql.catalog);
    for (const migration of incremental) db.exec(migration.sql);
    const result = schemaOf(db);
    db.close();
    return result;
  });
  assert.deepEqual(fresh, expected, "an incremental migration must not change a database created from today's 0001");

  // A database that missed a migration takes it and everything after it —
  // wrangler applies them in order — so the check runs the rest of the chain
  // too: a later migration may rewrite the same table (0112 rebuilds every
  // tenant table), and the deployed database must still end up where the
  // Node server does.
  for (const [index, migration] of incremental.entries()) {
    const deployed = inTempDatabase((file) => {
      const db = new DatabaseSync(file);
      db.exec(sql.schema);
      db.exec(sql.catalog);
      db.exec(migration.drop);
      for (const later of incremental.slice(index)) db.exec(later.sql);
      const result = schemaOf(db);
      db.close();
      return result;
    });
    assert.deepEqual(deployed, expected, `${migration.file} must give an already-deployed database what it adds`);
  }
});

/**
 * 0112 moves the rows, not just the tables: an account becomes the platform
 * owner, every row lands under the default tenant, and the journal's hashes
 * — the fiscal chain — come across untouched.
 */
test("0112 carries a deployed database's rows into the default tenant", () => {
  const sql = committed();
  const fixture = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "pre-tenant-schema.sql"), "utf8");
  const result = inTempDatabase((file) => {
    const db = new DatabaseSync(file);
    db.exec(sql.schema);
    db.exec(sql.catalog);
    db.exec(fixture);
    // A deployed database, before tenants: an account, an order with an
    // item, a journal entry, a customer, a table — and a name for the house.
    db.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('restaurant_name', '\"Chiri\"', 'x')").run();
    db.prepare("INSERT INTO accounts (id, login, name, password_hash, password_salt, password_iterations, created_at, updated_at) VALUES ('acc-1', 'admin', 'Admin', 'h', 's', 100000, 'x', 'x')").run();
    db.prepare("INSERT INTO orders (id, order_no, client_request_id, table_no, status, note, total_cents, billed_at, created_at, updated_at) VALUES ('ord-1', '2026-11-19-1', 'cr-1', '5', 'open', '', 1250, NULL, 'x', 'x')").run();
    db.prepare("INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price_cents, print_station, modifiers_json, vat_percent) VALUES ('oi-1', 'ord-1', 'photo-r1', 'Ramen', 1, 1250, 'kitchen', '[]', 10)").run();
    db.prepare("INSERT INTO journal (seq, at, kind, ref, payload_json, prev_hash, hash) VALUES (1, 'x', 'order', 'ord-1', '{}', 'GENESIS', 'abc')").run();
    db.prepare("INSERT INTO customers (id, email, name, password_hash, password_salt, password_iterations, points, created_at, updated_at) VALUES ('cus-1', 'gast@example.at', 'Gast', 'h', 's', 100000, 10, 'x', 'x')").run();
    db.prepare("INSERT INTO restaurant_tables (table_no, label, token, enabled, locked_at, created_at, updated_at) VALUES ('5', 'Tisch 5', 'tok-5', 1, NULL, 'x', 'x')").run();
    // A dish the owner added: the fixture dropped the seeded catalog, so a
    // row put back here is what 0112 has to carry across.
    db.prepare("INSERT INTO products (id, sku, kind, category, name_zh, name_de, name_en, description, price_cents, allergens_json, prep_time, portion, level, ingredients, art, pattern, tag_color, available, published, sort_order, print_station, print_printer_id, modifiers_json, vat_percent, bundle_items_json, created_at, updated_at) VALUES ('dish-1', 'TEST-1', 'food', 'RAMEN', 'Test', 'Test', 'Test', '', 1000, '[]', '', '', '', '', '', 'lines', '', 1, 1, 0, 'kitchen', '', '[]', 10, '[]', 'x', 'x')").run();
    db.exec(readFileSync(path.join(migrationsDir, "0112_multi_tenancy.sql"), "utf8"));
    // Rows come back null-prototype; plain objects compare cleanly.
    const plain = (rows) => rows.map((row) => ({ ...row }));
    const out = {
      tenant: plain(db.prepare("SELECT id, slug, name, status FROM tenants").all()),
      account: plain(db.prepare("SELECT login, tenant_id, role, status FROM accounts").all()),
      order: plain(db.prepare("SELECT order_no, tenant_id, table_no FROM orders").all()),
      item: plain(db.prepare("SELECT order_id, tenant_id FROM order_items").all()),
      journal: plain(db.prepare("SELECT seq, tenant_id, hash FROM journal").all()),
      customer: plain(db.prepare("SELECT email, tenant_id FROM customers").all()),
      table: plain(db.prepare("SELECT table_no, tenant_id FROM restaurant_tables").all()),
      product: plain(db.prepare("SELECT id, sku, tenant_id FROM products").all()),
      products: db.prepare("SELECT COUNT(*) AS n FROM products WHERE tenant_id = 't_default'").get()
    };
    db.close();
    return out;
  });
  assert.deepEqual(result.tenant, [{ id: "t_default", slug: "default", name: "Chiri", status: "active" }]);
  assert.deepEqual(result.account, [{ login: "admin", tenant_id: "t_default", role: "owner", status: "active" }]);
  assert.deepEqual(result.order, [{ order_no: "2026-11-19-1", tenant_id: "t_default", table_no: "5" }]);
  assert.deepEqual(result.item, [{ order_id: "ord-1", tenant_id: "t_default" }]);
  assert.deepEqual(result.journal, [{ seq: 1, tenant_id: "t_default", hash: "abc" }]);
  assert.deepEqual(result.customer, [{ email: "gast@example.at", tenant_id: "t_default" }]);
  assert.deepEqual(result.table, [{ table_no: "5", tenant_id: "t_default" }]);
  assert.deepEqual(result.product, [{ id: "dish-1", sku: "TEST-1", tenant_id: "t_default" }]);
  assert.equal(result.products.n, 1);
});

/**
 * The live D1 was deployed in the window after the 2026-10-08 product columns
 * (modifiers_json, vat_percent, bundle_items_json) but before tag_color
 * (2026-11-08) and print_printer_id (2026-11-10), which only ever reached
 * existing databases through the Node server's start-up ALTER block — never
 * D1. So its products table has neither column, and 0112 must still rebuild it
 * without reading them: this is the drift that made the deploy fail with
 * "no such column: tag_color". The rows come across with both columns at the
 * default '', which is what the seed gives them anyway.
 */
test("0112 rebuilds products on a D1 deployed before tag_color and print_printer_id", () => {
  const sql = committed();
  const fixture = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "pre-tenant-schema.sql"), "utf8");
  const result = inTempDatabase((file) => {
    const db = new DatabaseSync(file);
    db.exec(sql.schema);
    db.exec(sql.catalog);
    db.exec(fixture);
    // Drop the two columns that D1 never got, so products reads as the live
    // database's does: the pre-tenant shape minus the two later additions.
    db.exec("ALTER TABLE products DROP COLUMN tag_color");
    db.exec("ALTER TABLE products DROP COLUMN print_printer_id");
    const columns = db.prepare("SELECT name FROM pragma_table_info('products')").all().map((row) => row.name);
    assert.ok(!columns.includes("tag_color") && !columns.includes("print_printer_id"), "the fixture should be missing both columns");
    // A dish the owner added, in the old shape (no tag_color / print_printer_id).
    db.prepare("INSERT INTO products (id, sku, kind, category, name_zh, name_de, name_en, description, price_cents, allergens_json, prep_time, portion, level, ingredients, art, pattern, available, published, sort_order, print_station, modifiers_json, vat_percent, bundle_items_json, created_at, updated_at) VALUES ('dish-1', 'TEST-1', 'food', 'RAMEN', 'Test', 'Test', 'Test', '', 1000, '[]', '', '', '', '', '', 'lines', 1, 1, 0, 'kitchen', '[]', 10, '[]', 'x', 'x')").run();
    db.exec(readFileSync(path.join(migrationsDir, "0112_multi_tenancy.sql"), "utf8"));
    const plain = (rows) => rows.map((row) => ({ ...row }));
    const out = {
      product: plain(db.prepare("SELECT id, sku, tenant_id, tag_color, print_printer_id FROM products WHERE id = 'dish-1'").all()),
      schema: schemaOf(db)
    };
    db.close();
    return out;
  });
  assert.deepEqual(result.product, [{ id: "dish-1", sku: "TEST-1", tenant_id: "t_default", tag_color: "", print_printer_id: "" }]);
  // The rebuilt products table ends up identical to the fresh one — the two
  // columns are back, with their defaults.
  const expected = inTempDatabase((file) => {
    createDatabase(file).close();
    const db = new DatabaseSync(file);
    const result = schemaOf(db).find((object) => object.name === "products");
    db.close();
    return result;
  });
  assert.equal(result.schema.find((object) => object.name === "products").sql, expected.sql);
});

/**
 * 0111 renames the two tidied categories, nothing else.
 */
test("0111 renames the two tidied categories, nothing else", () => {
  const sql = committed();
  const result = inTempDatabase((file) => {
    const db = new DatabaseSync(file);
    db.exec(sql.schema);
    db.exec(sql.catalog);
    db.exec(sql.sets);
    // A deployed database still carries the old names (the seed it was built
    // from said CHIRI ROLLS / TEA); put them back before the tidy runs.
    db.exec("UPDATE products SET category = 'CHIRI ROLLS' WHERE category = 'URAMAKI ROLLS'");
    db.exec("UPDATE products SET category = 'TEA' WHERE id = 'photo-tea'");
    db.exec(readFileSync(path.join(migrationsDir, "0111_category_cleanup.sql"), "utf8"));
    const rows = db.prepare("SELECT id, category FROM products").all();
    db.close();
    return rows;
  });
  assert.deepEqual(result.filter((row) => row.category === "URAMAKI ROLLS").map((row) => row.id).sort(),
    ["photo-x1", "photo-x2", "photo-x3", "photo-x4", "photo-x5", "photo-x6", "photo-x7", "photo-x8", "photo-x9"]);
  assert.deepEqual(result.filter((row) => row.category === "TEA").map((row) => row.id), []);
  assert.equal(result.find((row) => row.id === "photo-tea")?.category, "NON-ALCOHOLIC");
  assert.ok(result.every((row) => row.category !== "CHIRI ROLLS"));
  // A category the owner renamed by hand is not touched by the tidy.
  assert.ok(result.some((row) => row.category === "HOT POT"));
});

/**
 * 0068 hides hot pot: its dishes and the hot pot set leave the guest menu, so
 * its tab goes too, and every other dish stays as it was.
 */
test("0068 takes the hot pot dishes and the hot pot set off the menu, nothing else", () => {
  const sql = committed();
  const result = inTempDatabase((file) => {
    const db = new DatabaseSync(file);
    db.exec(sql.schema);
    db.exec(sql.catalog);
    db.exec(sql.sets);
    db.exec(readFileSync(path.join(migrationsDir, "0068_hide_hot_pot.sql"), "utf8"));
    const rows = db.prepare("SELECT id, category, published FROM products").all();
    db.close();
    return rows;
  });
  const hidden = result.filter((row) => !row.published).map((row) => row.id).sort();
  assert.deepEqual(hidden, ["photo-h1", "photo-h2", "photo-h3", "photo-h4", "set-hot-pot-for-two"]);
  assert.ok(result.filter((row) => row.published).every((row) => row.category !== "HOT POT"));
});

/**
 * 0053 puts right what the Worker got wrong before it: drinks it saved at 10%
 * go to 20%, and the open bills' lines take their dish's rate — while a bill
 * already settled stays exactly as it was.
 */
test("0053 moves drinks to 20% and fixes open bills, never settled ones", () => {
  const sql = committed();
  const result = inTempDatabase((file) => {
    const db = new DatabaseSync(file);
    db.exec(sql.schema);
    db.exec(sql.catalog);
    db.exec("DROP TABLE order_item_vat_splits;");
    const at = "2026-09-01T00:00:00.000Z";
    db.exec(`INSERT INTO products (id, sku, kind, category, name_zh, name_de, name_en, price_cents, vat_percent, created_at, updated_at)
      VALUES ('cola', 'D-1', 'drink', 'DRINKS', 'x', 'x', 'x', 400, 10, '${at}', '${at}'),
             ('tea13', 'D-2', 'drink', 'DRINKS', 'x', 'x', 'x', 400, 13, '${at}', '${at}')`);
    db.exec(`INSERT INTO orders (id, order_no, client_request_id, table_no, status, note, total_cents, created_at, updated_at, billed_at)
      VALUES ('open', 'A', 'a', '1', 'new', '', 400, '${at}', '${at}', NULL), ('paid', 'B', 'b', '2', 'new', '', 400, '${at}', '${at}', '${at}')`);
    db.exec(`INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price_cents, print_station)
      VALUES ('i-open', 'open', 'cola', 'x', 1, 400, 'bar'), ('i-paid', 'paid', 'cola', 'x', 1, 400, 'bar')`);
    db.exec(readFileSync(path.join(migrationsDir, "0053_order_item_vat_split.sql"), "utf8"));
    const rates = Object.fromEntries(db.prepare("SELECT id, vat_percent FROM products WHERE id IN ('cola', 'tea13')").all().map((row) => [row.id, row.vat_percent]));
    const lines = Object.fromEntries(db.prepare("SELECT id, vat_percent FROM order_items WHERE id IN ('i-open', 'i-paid')").all().map((row) => [row.id, row.vat_percent]));
    db.close();
    return { rates, lines };
  });
  assert.deepEqual(result.rates, { cola: 20, tea13: 13 }, "a drink at 10% goes to 20%; a rate the owner chose stays");
  assert.deepEqual(result.lines, { "i-open": 20, "i-paid": 10 }, "the open bill is put right, the settled one is history");
});

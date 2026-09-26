import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { photoMenuDishes } from "./photo-menu.mjs";
import { dishPhotos } from "./dish-photos.mjs";
import { SET_MENU_SEED_KEY, setMenuProducts } from "./set-menus.mjs";
import { sqliteDriver } from "./sqlite-driver.mjs";
import { DEFAULT_VAT_PERCENT, mapProduct, normalizeProduct, now, parseJson } from "../shared/rules.mjs";
import { createStore, PRODUCT_INSERT_SQL, productInsertParams } from "../shared/store.mjs";

/**
 * The Node server's database: the file, its schema, and the menu it starts
 * with. Everything the API reads and writes is shared/store.mjs — the same
 * code the Worker runs over D1 — through server/sqlite-driver.mjs.
 *
 * The schema below is the source of migrations/0001_init.sql (npm run
 * d1:migrations): a new table goes here and, for a D1 already deployed, into
 * a hand-written migration of its own.
 */
const SCHEMA_VERSION = 9;
const BUSY_TIMEOUT_MS = Number(process.env.SQLITE_BUSY_TIMEOUT_MS || 5000);

export function createDatabase(databasePath, { busyTimeoutMs = BUSY_TIMEOUT_MS } = {}) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  // The API server and every print agent open the same file from separate processes.
  // Without a busy timeout the second writer fails immediately with SQLITE_BUSY.
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = ${Number(busyTimeoutMs) || 0};
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      sku TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('food','drink','sushi')),
      category TEXT NOT NULL,
      name_zh TEXT NOT NULL DEFAULT '',
      name_de TEXT NOT NULL DEFAULT '',
      name_en TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      allergens_json TEXT NOT NULL DEFAULT '[]',
      prep_time TEXT NOT NULL DEFAULT '',
      portion TEXT NOT NULL DEFAULT '',
      level TEXT NOT NULL DEFAULT '',
      ingredients TEXT NOT NULL DEFAULT '',
      art TEXT NOT NULL DEFAULT '',
      pattern TEXT NOT NULL DEFAULT 'lines',
      available INTEGER NOT NULL DEFAULT 1,
      published INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      print_station TEXT NOT NULL DEFAULT 'kitchen',
      modifiers_json TEXT NOT NULL DEFAULT '[]',
      vat_percent INTEGER NOT NULL DEFAULT 10,
      bundle_items_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_media (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('image','video')),
      url TEXT NOT NULL,
      poster_url TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_no TEXT NOT NULL UNIQUE,
      client_request_id TEXT UNIQUE,
      table_no TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      note TEXT NOT NULL DEFAULT '',
      total_cents INTEGER NOT NULL,
      billed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price_cents INTEGER NOT NULL,
      print_station TEXT NOT NULL,
      modifiers_json TEXT NOT NULL DEFAULT '[]',
      vat_percent INTEGER NOT NULL DEFAULT 10
    );

    CREATE TABLE IF NOT EXISTS order_item_vat_splits (
      order_item_id TEXT PRIMARY KEY REFERENCES order_items(id) ON DELETE CASCADE,
      split_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY,
      receipt_no INTEGER NOT NULL UNIQUE,
      client_request_id TEXT NOT NULL UNIQUE,
      cash_register_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('sale','storno')),
      table_no TEXT,
      lines_json TEXT NOT NULL,
      vat_json TEXT NOT NULL,
      total_cents INTEGER NOT NULL,
      payments_json TEXT NOT NULL,
      refers_to TEXT REFERENCES receipts(id),
      reason TEXT,
      staff_role TEXT NOT NULL,
      fiscal_status TEXT NOT NULL DEFAULT 'unsigned',
      fiscal_json TEXT,
      created_at TEXT NOT NULL,
      staff_id TEXT,
      staff_name TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_one_storno ON receipts(refers_to) WHERE refers_to IS NOT NULL;

    CREATE TABLE IF NOT EXISTS receipt_items (
      receipt_id TEXT NOT NULL REFERENCES receipts(id),
      order_item_id TEXT NOT NULL REFERENCES order_items(id),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      PRIMARY KEY (receipt_id, order_item_id)
    );

    CREATE INDEX IF NOT EXISTS idx_receipt_items_item ON receipt_items(order_item_id);

    CREATE TABLE IF NOT EXISTS vouchers (
      code TEXT PRIMARY KEY,
      value_cents INTEGER NOT NULL,
      balance_cents INTEGER NOT NULL CHECK (balance_cents >= 0),
      sold_receipt_id TEXT NOT NULL REFERENCES receipts(id),
      voided_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS day_closings (
      id TEXT PRIMARY KEY,
      closing_no INTEGER NOT NULL UNIQUE,
      first_receipt_no INTEGER NOT NULL,
      last_receipt_no INTEGER NOT NULL UNIQUE,
      totals_json TEXT NOT NULL,
      staff_role TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pos_devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      last_seen_at TEXT
    );

    CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK (role IN ('staff','manager')),
      pin_hash TEXT NOT NULL,
      pin_salt TEXT NOT NULL,
      pin_iterations INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pos_sessions (
      token_hash TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL REFERENCES pos_devices(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS table_claims (
      table_no TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      staff_id TEXT,
      staff_name TEXT,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_staff (
      order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
      staff_id TEXT,
      staff_name TEXT,
      pickup_no INTEGER,
      created_at TEXT NOT NULL
    );

    -- Dishes taken off a bill after they went to the kitchen (退菜), each
    -- with its reason and who did it; the order stays as it was sent
    -- (shared/register.mjs, planVoid). See migrations/0056_item_voids.sql.
    CREATE TABLE IF NOT EXISTS order_item_voids (
      id TEXT PRIMARY KEY,
      order_item_id TEXT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
      order_id TEXT NOT NULL,
      table_no TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      amount_cents INTEGER NOT NULL,
      reason TEXT NOT NULL,
      staff_id TEXT,
      staff_name TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS staff_settlements (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL,
      staff_name TEXT NOT NULL,
      last_receipt_no INTEGER NOT NULL,
      totals_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS journal (
      seq INTEGER PRIMARY KEY,
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      ref TEXT,
      payload_json TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS service_requests (
      id TEXT PRIMARY KEY,
      table_no TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      role TEXT NOT NULL,
      ip TEXT NOT NULL DEFAULT '',
      method TEXT NOT NULL,
      route TEXT NOT NULL,
      status INTEGER NOT NULL,
      detail_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS restaurant_tables (
      table_no TEXT PRIMARY KEY,
      label TEXT NOT NULL DEFAULT '',
      token TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      locked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS printer_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      transport TEXT NOT NULL CHECK (transport IN ('lan','bluetooth','usb')),
      address TEXT NOT NULL,
      port INTEGER,
      role TEXT NOT NULL CHECK (role IN ('kitchen','bar','sushi','front')),
      enabled INTEGER NOT NULL DEFAULT 1,
      capabilities_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS print_jobs (
      id TEXT PRIMARY KEY,
      order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
      printer_role TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      claimed_by TEXT,
      lease_until TEXT,
      next_attempt_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS restaurant_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      menu_theme TEXT NOT NULL DEFAULT 'jade',
      updated_at TEXT NOT NULL
    );

    -- The console's password. One restaurant, one row: there is nothing to
    -- name or list, so a table of accounts would be a table of one. The hash
    -- is stored, never the password.
    --
    -- A table of its own rather than four columns on restaurant_settings,
    -- because that is what a deployed D1 can be given: CREATE TABLE IF NOT
    -- EXISTS is a no-op on a database that already has it, and SQLite has no
    -- ADD COLUMN IF NOT EXISTS. See migrations/0003_admin_password_gate.sql.
    CREATE TABLE IF NOT EXISTS admin_gate (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_iterations INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Settings that are one value each, keyed by name. A key/value table
    -- rather than another column on restaurant_settings, because a deployed
    -- D1 database can only be given a new table safely: CREATE TABLE IF NOT
    -- EXISTS is a no-op where it exists, and SQLite has no ADD COLUMN IF NOT
    -- EXISTS. The next setting is a new key here, not a migration.
    -- See migrations/0004_app_settings.sql.
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Pictures kept in the database itself, served at /media/<id>. The Worker
    -- has no disk and no bucket, so this is where its photos live; the Node
    -- server keeps the seeded dish photos here too, so both answer the same
    -- URL. Uploads on the Node server still go to UPLOAD_DIR.
    -- See migrations/0005_dish_photos.sql.
    CREATE TABLE IF NOT EXISTS media_files (
      id TEXT PRIMARY KEY,
      content_type TEXT NOT NULL,
      bytes BLOB NOT NULL,
      credit TEXT,
      source_url TEXT,
      created_at TEXT NOT NULL
    );

    -- Only the SHA-256 of a session token is kept, so the table is useless to
    -- anyone who reads it: it cannot be replayed as a credential.
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- The restaurant's account (shared/account.mjs): registered once, signed
    -- in with its name and password; the waiters are under it. admin_gate and
    -- admin_sessions above are the one-password door it replaced, kept only
    -- so a password set there becomes the account "admin" and still works.
    -- See migrations/0055_accounts.sql.
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      login TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_iterations INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS account_sessions (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- Guests' own accounts (shared/customer.mjs): an email and a password,
    -- their favourite dishes and their points. The balance may never go below
    -- zero: two orders spending the same points cannot both be written.
    -- See migrations/0057_customers.sql.
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_iterations INTEGER NOT NULL,
      points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customer_sessions (
      token_hash TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customer_favorites (
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (customer_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS points_ledger (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL CHECK (reason IN ('earn','reverse','redeem','refund','adjust')),
      ref TEXT,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    -- A guest's own order from the menu (shared/ordering.mjs): at the table or
    -- for pickup, by whom when signed in, and the points it spent.
    CREATE TABLE IF NOT EXISTS guest_orders (
      order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
      customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
      channel TEXT NOT NULL CHECK (channel IN ('dine-in','pickup')),
      table_no TEXT NOT NULL,
      pickup_no INTEGER,
      payment TEXT NOT NULL DEFAULT 'in-store',
      points_spent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    -- Tables a waiter opened for guests to order from (开台).
    CREATE TABLE IF NOT EXISTS table_sessions (
      table_no TEXT PRIMARY KEY,
      opened_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      staff_name TEXT
    );

    INSERT INTO accounts (id, login, name, password_hash, password_salt, password_iterations, created_at, updated_at)
    SELECT 'owner', 'admin', 'Admin', password_hash, password_salt, password_iterations, updated_at, updated_at
    FROM admin_gate WHERE id = 1 AND NOT EXISTS (SELECT 1 FROM accounts);
    DELETE FROM admin_gate;
    DELETE FROM admin_sessions;

    -- Hours were briefly kept per dish; they belong to the promotions and set
    -- menus pages (app_settings). See migrations/0052_drop_product_schedules.sql.
    DROP TABLE IF EXISTS product_schedules;

    CREATE INDEX IF NOT EXISTS idx_products_catalog ON products(published, available, sort_order);
    CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_account_sessions_expiry ON account_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_order_item_voids_item ON order_item_voids(order_item_id);
    CREATE INDEX IF NOT EXISTS idx_order_item_voids_staff ON order_item_voids(staff_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_customer_sessions_expiry ON customer_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_points_ledger_customer ON points_ledger(customer_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_points_ledger_ref ON points_ledger(ref, reason);
    CREATE INDEX IF NOT EXISTS idx_guest_orders_table ON guest_orders(table_no, created_at);
    CREATE INDEX IF NOT EXISTS idx_guest_orders_customer ON guest_orders(customer_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at DESC);
  `);
  for (const statement of [
    "ALTER TABLE products ADD COLUMN modifiers_json TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE order_items ADD COLUMN modifiers_json TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE print_jobs ADD COLUMN claimed_by TEXT",
    "ALTER TABLE print_jobs ADD COLUMN lease_until TEXT",
    "ALTER TABLE print_jobs ADD COLUMN next_attempt_at TEXT",
    "ALTER TABLE products ADD COLUMN vat_percent INTEGER NOT NULL DEFAULT 10",
    "ALTER TABLE order_items ADD COLUMN vat_percent INTEGER NOT NULL DEFAULT 10",
    "ALTER TABLE orders ADD COLUMN billed_at TEXT",
    "ALTER TABLE restaurant_tables ADD COLUMN locked_at TEXT",
    "ALTER TABLE products ADD COLUMN bundle_items_json TEXT NOT NULL DEFAULT '[]'"
  ]) {
    try {
      db.exec(statement);
      // Existing catalogs predate the VAT column: drinks are billed at the standard rate.
      if (statement.startsWith("ALTER TABLE products ADD COLUMN vat_percent")) {
        db.exec(`UPDATE products SET vat_percent = ${DEFAULT_VAT_PERCENT.drink} WHERE kind = 'drink'`);
      }
    } catch (error) {
      if (!String(error.message).includes("duplicate column name")) throw error;
    }
  }
  const currentSchemaVersion = Number(db.prepare("PRAGMA user_version").get().user_version || 0);
  if (currentSchemaVersion > SCHEMA_VERSION) throw new Error(`Unsupported database schema version: ${currentSchemaVersion}`);
  if (currentSchemaVersion < SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);

  const driver = sqliteDriver(db);
  seed(driver.sync, db);
  return { ...createStore(driver), close: () => db.close() };
}

/** One transaction, for the seeding: nothing else runs yet. */
function transaction(db, work) {
  db.exec("BEGIN");
  try {
    work();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function insertProduct(sql, input) {
  const product = normalizeProduct(input, {});
  sql.run(PRODUCT_INSERT_SQL, ...productInsertParams(product, now()));
}

/**
 * The menu a new restaurant starts with, its set menus and the dishes'
 * photos. Each runs once: a dish, set or photo the owner removes stays removed.
 */
function seed(sql, db) {
  seedDishes(sql, db);
  seedSetMenus(sql, db);
  seedPhotos(sql, db);
}

function seedDishes(sql, db) {
  const existing = sql.all("SELECT sku FROM products");
  const isLegacyDemoCatalog = existing.length > 0 && existing.length <= 15 && existing.every((row) => row.sku.startsWith("FOOD-"));
  if (isLegacyDemoCatalog) db.exec("DELETE FROM products");
  if (sql.get("SELECT COUNT(*) AS count FROM products").count) {
    // A catalogue from before the dishes had options gets them.
    const ramen = sql.get("SELECT * FROM products WHERE sku = ?", "R1");
    if (ramen && !parseJson(ramen.modifiers_json, []).length) {
      for (const dish of photoMenuDishes) {
        const current = sql.get("SELECT * FROM products WHERE sku = ?", dish.sku);
        if (current) sql.run("UPDATE products SET modifiers_json = ?, updated_at = ? WHERE id = ?", normalizeProduct({ modifiers: dish.modifiers || [] }, current).modifiersJson, now(), current.id);
      }
    }
    return;
  }
  transaction(db, () => photoMenuDishes.forEach((dish, index) => insertProduct(sql, {
    id: String(dish.id),
    sku: dish.sku || `FOOD-${dish.id}`,
    kind: dish.kind || "food",
    category: dish.cat,
    names: { zh: dish.zh, de: dish.de, en: dish.en },
    description: dish.intro,
    price: dish.price,
    allergens: Array.isArray(dish.allergens) ? dish.allergens : dish.allergens.split(",").map((item) => item.trim()).filter(Boolean),
    details: { time: dish.time, people: dish.people, level: dish.level, ingredients: dish.ingredients },
    appearance: { art: dish.art, pattern: dish.pattern },
    modifiers: dish.modifiers || [],
    sortOrder: index,
    printStation: dish.station || (dish.kind === "drink" ? "bar" : dish.kind === "sushi" ? "sushi" : "kitchen")
  })));
}

/** The starting set menus, once: the marker, not the products, records that it happened. */
function seedSetMenus(sql, db) {
  if (sql.get("SELECT 1 AS done FROM app_settings WHERE key = ?", SET_MENU_SEED_KEY)) return;
  transaction(db, () => {
    const dishes = sql.all("SELECT * FROM products ORDER BY sort_order, created_at").map((row) => mapProduct(row, []));
    for (const set of setMenuProducts(dishes)) {
      if (!sql.get("SELECT id FROM products WHERE id = ? OR sku = ?", set.id, set.sku)) insertProduct(sql, set);
    }
    sql.run("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", SET_MENU_SEED_KEY, "true", now());
  });
}

/**
 * A photo for every dish that has none. Each photo is attached once: its row
 * in media_files is the record that it was, so a photo the owner later
 * removes from a dish stays removed across restarts.
 */
function seedPhotos(sql, db) {
  const photos = dishPhotos();
  if (!photos.length) return;
  transaction(db, () => {
    for (const photo of photos) {
      if (sql.get("SELECT 1 AS seen FROM media_files WHERE id = ?", photo.fileId)) continue;
      sql.run("INSERT INTO media_files (id, content_type, bytes, credit, source_url, created_at) VALUES (?, ?, ?, ?, ?, ?)", photo.fileId, photo.contentType, photo.bytes, photo.credit, photo.sourceUrl, now());
      if (sql.get("SELECT id FROM products WHERE id = ?", photo.productId) && !sql.get("SELECT COUNT(*) AS count FROM product_media WHERE product_id = ?", photo.productId).count) {
        sql.run("INSERT INTO product_media (id, product_id, type, url, poster_url, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", `seed-${photo.fileId}`, photo.productId, "image", `/media/${photo.fileId}`, null, 0, now());
      }
    }
  });
}

import { mkdirSync } from "node:fs";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { photoMenuDishes } from "./photo-menu.mjs";
import { dishPhotos } from "./dish-photos.mjs";
import { SET_MENU_SEED_KEY, setMenuProducts } from "./set-menus.mjs";
// The table and audit shapes the two backends must agree on, byte for byte.
import {
  assertPassword, assertSetServed, auditView, billView, hashPassword,
  duplicateInput, hashSessionToken, newSessionToken, normalizeCategoryName, normalizeSettingsInput,
  mapProduct, normalizeProduct, planOrder, bundleComponentIds, normalizeVatPercent, DEFAULT_VAT_PERCENT,
  normalizeTableNo, PASSWORD_ITERATIONS, settingsView,
  orderView as sharedOrderView, renamedCategorySettings, tablesOverviewView, tableView, verifyPassword, RECENT_ORDERS_SQL, OPEN_TABLE_ORDERS_SQL
} from "../shared/rules.mjs";
import {
  CHECKOUT_ITEMS_SQL, closingPrintPayload, closingTotals, companyOf, closingView, CREDIT_VOUCHER_SQL, DEBIT_VOUCHER_SQL, INSERT_JOURNAL_SQL, INSERT_RECEIPT_SQL,
  INSERT_VOUCHER_SQL, journalEntry, journalText, journalView, normalizeVoucherCode, OPEN_RECEIPTS_SQL, ORDER_ITEMS_SQL, ORDER_PAID_SQL,
  orderJournalPayload, planCheckout, planStorno, plannedReceiptView, receiptPrintPayload, receiptRow, receiptView, REOPEN_ORDERS_SQL, SETTLE_PAID_TABLE_SQL,
  UNLOCK_PAID_TABLE_SQL, verifyJournal, VOID_VOUCHER_SQL
} from "../shared/register.mjs";
import {
  assertClaim, claimView, CLAIM_TTL_MS, holdsClaim, CLAIM_UPSERT_SQL, deviceView, isTakeaway, NEXT_PICKUP_SQL, normalizeDeviceName,
  normalizeStaffInput, OPEN_STAFF_RECEIPTS_SQL, POS_SESSION_TTL_MS, LIVE_POS_SESSIONS_SQL, staffActivityView, settlementTotals, settlementView, staffView, TAKEAWAY_PREFIX
} from "../shared/pos.mjs";
import {
  ACCOUNT_BY_ID_SQL, ACCOUNT_BY_LOGIN_SQL, ACCOUNT_COUNT_SQL, ACCOUNT_SESSION_SQL, ACCOUNT_SESSION_TTL_MS, accountView, DELETE_ACCOUNT_SESSION_SQL,
  DELETE_ACCOUNT_SESSIONS_SQL, DELETE_EXPIRED_ACCOUNT_SESSIONS_SQL, INSERT_ACCOUNT_SESSION_SQL, MIGRATED_LOGIN, normalizeAccountName, normalizeLogin,
  normalizeRegistration, OWNER_ACCOUNT_SQL, REGISTER_ACCOUNT_SQL, storedPassword, UPDATE_ACCOUNT_SQL
} from "../shared/account.mjs";

// 16 zero bytes. A salt for nobody: signing in against a console that has no
// password yet still spends the same PBKDF2 work as one that does, so the
// response time does not say which it was.
const ABSENT_PASSWORD_SALT = "AAAAAAAAAAAAAAAAAAAAAA==";

const ORDER_STATUSES = new Set(["new", "preparing", "ready", "completed", "cancelled"]);
const REQUEST_STATUSES = new Set(["open", "acknowledged", "completed", "cancelled"]);
const PRINT_STATIONS = new Set(["kitchen", "bar", "sushi", "front"]);
const SCHEMA_VERSION = 9;
const BUSY_TIMEOUT_MS = Number(process.env.SQLITE_BUSY_TIMEOUT_MS || 5000);
const ORDER_TRANSITIONS = new Map([
  ["new", new Set(["preparing", "cancelled"])],
  ["preparing", new Set(["ready", "cancelled"])],
  ["ready", new Set(["completed", "cancelled"])],
  ["completed", new Set()],
  ["cancelled", new Set()]
]);
const REQUEST_TRANSITIONS = new Map([
  ["open", new Set(["acknowledged", "completed", "cancelled"])],
  ["acknowledged", new Set(["completed", "cancelled"])],
  ["completed", new Set()],
  ["cancelled", new Set()]
]);

function now() {
  return new Date().toISOString();
}

function bool(value, fallback = true) {
  if (value === undefined) return fallback ? 1 : 0;
  return value ? 1 : 0;
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

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
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
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

  const statements = {
    productCount: db.prepare("SELECT COUNT(*) AS count FROM products"),
    productById: db.prepare("SELECT * FROM products WHERE id = ?"),
    productBySku: db.prepare("SELECT * FROM products WHERE sku = ?"),
    allProducts: db.prepare("SELECT * FROM products ORDER BY sort_order, created_at"),
    catalogProducts: db.prepare("SELECT * FROM products WHERE published = 1 AND available = 1 ORDER BY sort_order, created_at"),
    // The credit comes along for pictures kept in media_files (the seeded
    // photos); an upload has none to give.
    mediaForProduct: db.prepare(`
      SELECT product_media.*, media_files.credit AS credit FROM product_media
      LEFT JOIN media_files ON product_media.url = '/media/' || media_files.id
      WHERE product_media.product_id = ? ORDER BY product_media.sort_order, product_media.created_at
    `),
    mediaFile: db.prepare("SELECT content_type, bytes FROM media_files WHERE id = ?"),
    mediaFileExists: db.prepare("SELECT 1 FROM media_files WHERE id = ?"),
    insertMediaFile: db.prepare("INSERT INTO media_files (id, content_type, bytes, credit, source_url, created_at) VALUES (?, ?, ?, ?, ?, ?)"),
    mediaCount: db.prepare("SELECT COUNT(*) AS count FROM product_media WHERE product_id = ?"),
    insertProduct: db.prepare(`
      INSERT INTO products (
        id, sku, kind, category, name_zh, name_de, name_en, description, price_cents,
        allergens_json, prep_time, portion, level, ingredients, art, pattern, available,
        published, sort_order, print_station, modifiers_json, vat_percent, bundle_items_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateProduct: db.prepare(`
      UPDATE products SET sku = ?, kind = ?, category = ?, name_zh = ?, name_de = ?,
        name_en = ?, description = ?, price_cents = ?, allergens_json = ?, prep_time = ?,
        portion = ?, level = ?, ingredients = ?, art = ?, pattern = ?, available = ?,
        published = ?, sort_order = ?, print_station = ?, modifiers_json = ?, vat_percent = ?,
        bundle_items_json = ?, updated_at = ? WHERE id = ?
    `),
    deleteProduct: db.prepare("DELETE FROM products WHERE id = ?"),
    insertMedia: db.prepare("INSERT INTO product_media (id, product_id, type, url, poster_url, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"),
    deleteMedia: db.prepare("DELETE FROM product_media WHERE id = ?"),
    orderByClientId: db.prepare("SELECT * FROM orders WHERE client_request_id = ?"),
    orderById: db.prepare("SELECT * FROM orders WHERE id = ?"),
    orderItems: db.prepare(ORDER_ITEMS_SQL),
    insertVatSplit: db.prepare("INSERT INTO order_item_vat_splits (order_item_id, split_json) VALUES (?, ?)"),
    lastJournal: db.prepare("SELECT seq, hash FROM journal ORDER BY seq DESC LIMIT 1"),
    insertOrderStaff: db.prepare("INSERT INTO order_staff (order_id, staff_id, staff_name, pickup_no, created_at) VALUES (?, ?, ?, ?, ?)"),
    claimByTable: db.prepare("SELECT * FROM table_claims WHERE table_no = ?"),
    upsertClaim: db.prepare(CLAIM_UPSERT_SQL),
    releaseClaim: db.prepare("DELETE FROM table_claims WHERE table_no = ? AND (device_id = ? OR ? = 1)"),
    liveClaims: db.prepare("SELECT * FROM table_claims WHERE expires_at > ?"),
    insertDevice: db.prepare("INSERT INTO pos_devices (id, name, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, NULL)"),
    deviceByHash: db.prepare("SELECT * FROM pos_devices WHERE token_hash = ?"),
    touchDevice: db.prepare("UPDATE pos_devices SET last_seen_at = ? WHERE id = ?"),
    listDevices: db.prepare("SELECT * FROM pos_devices ORDER BY created_at"),
    deleteDevice: db.prepare("DELETE FROM pos_devices WHERE id = ?"),
    staffById: db.prepare("SELECT * FROM staff WHERE id = ?"),
    listStaff: db.prepare("SELECT * FROM staff ORDER BY active DESC, name"),
    insertStaff: db.prepare("INSERT INTO staff (id, name, role, pin_hash, pin_salt, pin_iterations, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"),
    updateStaff: db.prepare("UPDATE staff SET name = ?, role = ?, active = ?, updated_at = ? WHERE id = ?"),
    updateStaffPin: db.prepare("UPDATE staff SET pin_hash = ?, pin_salt = ?, pin_iterations = ?, updated_at = ? WHERE id = ?"),
    deleteStaffSessions: db.prepare("DELETE FROM pos_sessions WHERE staff_id = ?"),
    insertPosSession: db.prepare("INSERT INTO pos_sessions (token_hash, staff_id, device_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"),
    posSessionByHash: db.prepare("SELECT pos_sessions.*, staff.name AS staff_name, staff.role AS staff_role, staff.active AS staff_active FROM pos_sessions JOIN staff ON staff.id = pos_sessions.staff_id WHERE token_hash = ?"),
    deletePosSession: db.prepare("DELETE FROM pos_sessions WHERE token_hash = ?"),
    nextPickup: db.prepare(NEXT_PICKUP_SQL),
    moveTableOrders: db.prepare("UPDATE orders SET table_no = ?, updated_at = ? WHERE table_no = ? AND billed_at IS NULL AND status <> 'cancelled'"),
    openStaffReceipts: db.prepare(OPEN_STAFF_RECEIPTS_SQL),
    insertSettlement: db.prepare("INSERT INTO staff_settlements (id, staff_id, staff_name, last_receipt_no, totals_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"),
    settlementById: db.prepare("SELECT * FROM staff_settlements WHERE id = ?"),
    recentSettlements: db.prepare("SELECT * FROM staff_settlements ORDER BY created_at DESC LIMIT ?"),
    insertJournal: db.prepare(INSERT_JOURNAL_SQL),
    insertReceipt: db.prepare(INSERT_RECEIPT_SQL),
    insertReceiptItem: db.prepare("INSERT INTO receipt_items (receipt_id, order_item_id, quantity) VALUES (?, ?, ?)"),
    receiptById: db.prepare("SELECT * FROM receipts WHERE id = ?"),
    receiptByRequest: db.prepare("SELECT * FROM receipts WHERE client_request_id = ?"),
    stornoOf: db.prepare("SELECT * FROM receipts WHERE refers_to = ?"),
    lastReceiptNo: db.prepare("SELECT MAX(receipt_no) AS no FROM receipts"),
    recentReceipts: db.prepare("SELECT * FROM receipts ORDER BY receipt_no DESC LIMIT ?"),
    voucherByCode: db.prepare("SELECT * FROM vouchers WHERE code = ?"),
    vouchersSoldBy: db.prepare("SELECT * FROM vouchers WHERE sold_receipt_id = ?"),
    insertVoucher: db.prepare(INSERT_VOUCHER_SQL),
    debitVoucher: db.prepare(DEBIT_VOUCHER_SQL),
    creditVoucher: db.prepare(CREDIT_VOUCHER_SQL),
    voidVoucher: db.prepare(VOID_VOUCHER_SQL),
    reopenOrders: db.prepare(REOPEN_ORDERS_SQL),
    settlePaidTable: db.prepare(SETTLE_PAID_TABLE_SQL),
    unlockPaidTable: db.prepare(UNLOCK_PAID_TABLE_SQL),
    orderPaid: db.prepare(ORDER_PAID_SQL),
    openReceipts: db.prepare(OPEN_RECEIPTS_SQL),
    lastClosingNo: db.prepare("SELECT MAX(closing_no) AS no FROM day_closings"),
    insertClosing: db.prepare("INSERT INTO day_closings (id, closing_no, first_receipt_no, last_receipt_no, totals_json, staff_role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"),
    closingById: db.prepare("SELECT * FROM day_closings WHERE id = ?"),
    recentClosings: db.prepare("SELECT * FROM day_closings ORDER BY closing_no DESC LIMIT ?"),
    journalBetween: db.prepare("SELECT * FROM journal WHERE at >= ? AND at < ? ORDER BY seq"),
    journalBySeq: db.prepare("SELECT * FROM journal WHERE seq = ?"),
    listOrders: db.prepare(RECENT_ORDERS_SQL),
    openBillOrders: db.prepare("SELECT * FROM orders WHERE table_no = ? AND billed_at IS NULL AND status <> 'cancelled' ORDER BY created_at"),
    openBillTables: db.prepare("SELECT DISTINCT table_no FROM orders WHERE billed_at IS NULL AND status <> 'cancelled' ORDER BY table_no"),
    insertOrder: db.prepare("INSERT INTO orders (id, order_no, client_request_id, table_no, status, note, total_cents, created_at, updated_at) VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?)"),
    insertOrderItem: db.prepare("INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price_cents, print_station, modifiers_json, vat_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"),
    updateOrderStatus: db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?"),
    insertPrintJob: db.prepare("INSERT INTO print_jobs (id, order_id, printer_role, payload_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)"),
    listPrintJobs: db.prepare("SELECT * FROM print_jobs WHERE status = ? ORDER BY created_at LIMIT ?"),
    claimablePrintJob: db.prepare("SELECT * FROM print_jobs WHERE printer_role = ? AND ((status = 'queued') OR (status = 'retry-wait' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)) OR (status = 'claimed' AND lease_until <= ?)) ORDER BY created_at LIMIT 1"),
    claimPrintJob: db.prepare("UPDATE print_jobs SET status = 'claimed', claimed_by = ?, lease_until = ?, updated_at = ? WHERE id = ? AND (status = 'queued' OR status = 'retry-wait' OR (status = 'claimed' AND lease_until <= ?))"),
    completePrintJob: db.prepare("UPDATE print_jobs SET status = 'printed', claimed_by = NULL, lease_until = NULL, next_attempt_at = NULL, error = NULL, updated_at = ? WHERE id = ? AND status = 'claimed' AND claimed_by = ?"),
    printJobById: db.prepare("SELECT * FROM print_jobs WHERE id = ?"),
    failPrintJob: db.prepare("UPDATE print_jobs SET status = ?, attempts = attempts + 1, error = ?, claimed_by = NULL, lease_until = NULL, next_attempt_at = ?, updated_at = ? WHERE id = ? AND status = 'claimed' AND claimed_by = ?"),
    retryPrintJob: db.prepare("UPDATE print_jobs SET status = 'queued', attempts = 0, error = NULL, claimed_by = NULL, lease_until = NULL, next_attempt_at = NULL, updated_at = ? WHERE id = ? AND status = 'failed'"),
    listRequests: db.prepare("SELECT * FROM service_requests ORDER BY created_at DESC, rowid DESC LIMIT ?"),
    requestById: db.prepare("SELECT * FROM service_requests WHERE id = ?"),
    insertRequest: db.prepare("INSERT INTO service_requests (id, table_no, type, status, created_at, updated_at) VALUES (?, ?, ?, 'open', ?, ?)"),
    updateRequest: db.prepare("UPDATE service_requests SET status = ?, updated_at = ? WHERE id = ?"),
    insertAudit: db.prepare("INSERT INTO audit_log (id, at, role, ip, method, route, status, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
    listAudit: db.prepare("SELECT * FROM audit_log ORDER BY at DESC, rowid DESC LIMIT ?"),
    tableCount: db.prepare("SELECT COUNT(*) AS count FROM restaurant_tables"),
    listTables: db.prepare("SELECT * FROM restaurant_tables ORDER BY table_no"),
    tableByNo: db.prepare("SELECT * FROM restaurant_tables WHERE table_no = ?"),
    upsertTable: db.prepare(`
      INSERT INTO restaurant_tables (table_no, label, token, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(table_no) DO UPDATE SET label = excluded.label, token = excluded.token, enabled = excluded.enabled, updated_at = excluded.updated_at
    `),
    deleteTable: db.prepare("DELETE FROM restaurant_tables WHERE table_no = ?"),
    setTableLock: db.prepare("UPDATE restaurant_tables SET locked_at = ?, updated_at = ? WHERE table_no = ?"),
    openOrdersForTables: db.prepare(OPEN_TABLE_ORDERS_SQL),
    livePosSessions: db.prepare(LIVE_POS_SESSIONS_SQL),
    accountCount: db.prepare(ACCOUNT_COUNT_SQL),
    accountById: db.prepare(ACCOUNT_BY_ID_SQL),
    accountByLogin: db.prepare(ACCOUNT_BY_LOGIN_SQL),
    ownerAccount: db.prepare(OWNER_ACCOUNT_SQL),
    registerAccount: db.prepare(REGISTER_ACCOUNT_SQL),
    updateAccount: db.prepare(UPDATE_ACCOUNT_SQL),
    insertAccountSession: db.prepare(INSERT_ACCOUNT_SESSION_SQL),
    accountSession: db.prepare(ACCOUNT_SESSION_SQL),
    deleteAccountSession: db.prepare(DELETE_ACCOUNT_SESSION_SQL),
    deleteAccountSessions: db.prepare(DELETE_ACCOUNT_SESSIONS_SQL),
    deleteExpiredAccountSessions: db.prepare(DELETE_EXPIRED_ACCOUNT_SESSIONS_SQL),
    getSettings: db.prepare("SELECT * FROM restaurant_settings WHERE id = 1"),
    allAppSettings: db.prepare("SELECT key, value FROM app_settings"),
    setAppSetting: db.prepare(`
      INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `),
    upsertSettings: db.prepare(`
      INSERT INTO restaurant_settings (id, menu_theme, updated_at) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET menu_theme = excluded.menu_theme, updated_at = excluded.updated_at
    `),
    listPrinters: db.prepare("SELECT * FROM printer_profiles ORDER BY role, name"),
    printerById: db.prepare("SELECT * FROM printer_profiles WHERE id = ?"),
    insertPrinter: db.prepare("INSERT INTO printer_profiles (id, name, transport, address, port, role, enabled, capabilities_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
    updatePrinter: db.prepare("UPDATE printer_profiles SET name = ?, transport = ?, address = ?, port = ?, role = ?, enabled = ?, capabilities_json = ?, updated_at = ? WHERE id = ?"),
    deletePrinter: db.prepare("DELETE FROM printer_profiles WHERE id = ?")
  };

  function mediaMap(rows) {
    const map = new Map();
    for (const row of rows) map.set(row.id, statements.mediaForProduct.all(row.id));
    return map;
  }

  function getProduct(id) {
    const row = statements.productById.get(String(id));
    return row ? mapProduct(row, statements.mediaForProduct.all(row.id)) : null;
  }

  function saveProduct(input, id) {
    const current = id ? statements.productById.get(String(id)) : null;
    if (id && !current) return null;
    const product = normalizeProduct({ ...input, id: id || input.id }, current || {});
    if (!product.sku) product.sku = `ITEM-${product.id.slice(0, 8).toUpperCase()}`;
    if (!product.nameZh && !product.nameDe && !product.nameEn) throw new Error("At least one product name is required");
    const timestamp = now();
    if (current) {
      statements.updateProduct.run(
        product.sku, product.kind, product.category, product.nameZh, product.nameDe,
        product.nameEn, product.description, product.priceCents, product.allergensJson,
        product.prepTime, product.portion, product.level, product.ingredients, product.art,
        product.pattern, product.available, product.published, product.sortOrder,
        product.printStation, product.modifiersJson, product.vatPercent, product.bundleItemsJson, timestamp, product.id
      );
    } else {
      statements.insertProduct.run(
        product.id, product.sku, product.kind, product.category, product.nameZh,
        product.nameDe, product.nameEn, product.description, product.priceCents,
        product.allergensJson, product.prepTime, product.portion, product.level,
        product.ingredients, product.art, product.pattern, product.available,
        product.published, product.sortOrder, product.printStation, product.modifiersJson,
        product.vatPercent, product.bundleItemsJson, timestamp, timestamp
      );
    }
    return getProduct(product.id);
  }

  function listProducts(publishedOnly = false) {
    const rows = publishedOnly ? statements.catalogProducts.all() : statements.allProducts.all();
    const media = mediaMap(rows);
    return rows.map((row) => mapProduct(row, media.get(row.id)));
  }

  /**
   * Every dish in one category moved to another name, and the settings that
   * name the category with it (its place among the first tabs, its names).
   * Onto an existing category, the two become one. Null when no dish is in
   * the category.
   */
  function renameCategory(fromInput, toInput) {
    const from = normalizeCategoryName(fromInput);
    const to = normalizeCategoryName(toInput);
    if (from === to) throw new Error("The new name is the same as the old one");
    db.exec("BEGIN");
    try {
      const { changes } = db.prepare("UPDATE products SET category = ?, updated_at = ? WHERE category = ?").run(to, now(), from);
      if (!changes) {
        db.exec("ROLLBACK");
        return null;
      }
      const settings = saveSettings(renamedCategorySettings(getSettings(), from, to));
      db.exec("COMMIT");
      return { renamed: Number(changes), category: to, settings };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  /** A new, unpublished dish with everything the original had, photos included. */
  function duplicateProduct(id) {
    const original = getProduct(id);
    if (!original) return null;
    db.exec("BEGIN");
    try {
      const copy = saveProduct(duplicateInput(original));
      for (const media of original.media) {
        statements.insertMedia.run(randomUUID(), copy.id, media.type, media.url, media.posterUrl || null, Number(media.sortOrder || 0), now());
      }
      db.exec("COMMIT");
      return getProduct(copy.id);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function addMedia(productId, media) {
    if (!statements.productById.get(String(productId))) return null;
    const id = randomUUID();
    statements.insertMedia.run(id, String(productId), media.type, media.url, media.posterUrl || null, Number(media.sortOrder || 0), now());
    return getProduct(productId);
  }

  /** The shared view (shared/rules.mjs), with the order's lines read here. */
  function orderView(row) {
    return row ? sharedOrderView(row, statements.orderItems.all(row.id)) : null;
  }

  function serviceRequestView(row) {
    if (!row) return null;
    return {
      id: row.id,
      table: row.table_no,
      type: row.type,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function printJobView(row) {
    return {
      id: row.id,
      orderId: row.order_id,
      printerRole: row.printer_role,
      status: row.status,
      attempts: row.attempts,
      error: row.error,
      claimedBy: row.claimed_by,
      leaseUntil: row.lease_until,
      nextAttemptAt: row.next_attempt_at,
      payload: parseJson(row.payload_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * The order rules are shared/rules.mjs's (planOrder), so this server and
   * the Worker write the same rows — VAT split and kitchen tickets included.
   * What is left here is reading the products and writing in one transaction.
   */
  function createOrder(input, pos = null) {
    const requestId = String(input.clientRequestId || randomUUID());
    const existing = statements.orderByClientId.get(requestId);
    if (existing) return orderView(existing);

    const products = new Map();
    const load = (id) => {
      const row = statements.productById.get(String(id));
      if (row) products.set(String(row.id), row);
    };
    for (const item of Array.isArray(input.items) ? input.items : []) load(item.id);
    // The dishes inside a set, for its VAT split.
    for (const id of bundleComponentIds(products.values())) if (!products.has(id)) load(id);
    const pickupNo = pos && isTakeaway(input.table) ? Number(String(input.table).slice(TAKEAWAY_PREFIX.length)) || null : null;
    const plan = planOrder({ ...input, clientRequestId: requestId }, products, getSettings(), { staffName: pos?.staff?.name, pickupNo });
    const { id, orderNo, table, note, totalCents, timestamp } = plan.order;

    // A locked table is one whose bill is being settled. Refusing here is the
    // whole point of the lock: an order that lands mid-settle is either missing
    // from the bill the guest just paid or reopens a table that was released.
    const tableRow = statements.tableByNo.get(table.toUpperCase());
    // The lock is against guests adding to a bill being paid; the floor staff
    // who set it may still add to it. Another device's open table is theirs.
    if (pos) assertClaim(statements.claimByTable.get(table.toUpperCase()), pos.deviceId);
    if (tableRow?.locked_at && !pos) {
      const error = new Error("This table is locked; please ask a waiter");
      error.code = "TABLE_LOCKED";
      throw error;
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const committed = statements.orderByClientId.get(requestId);
      if (committed) {
        db.exec("COMMIT");
        return orderView(committed);
      }
      statements.insertOrder.run(id, orderNo, requestId, table, note, totalCents, timestamp, timestamp);
      for (const item of plan.items) {
        statements.insertOrderItem.run(item.id, id, item.productId, item.productName, item.quantity, item.unitPriceCents, item.printStation, item.modifiersJson, item.vatPercent);
        if (item.vatSplitJson) statements.insertVatSplit.run(item.id, item.vatSplitJson);
      }
      for (const job of plan.printJobs) statements.insertPrintJob.run(job.id, id, job.printerRole, job.payloadJson, timestamp, timestamp);
      if (pos) statements.insertOrderStaff.run(id, pos.staff?.id ?? null, pos.staff?.name ?? null, pickupNo, timestamp);
      journal("order.created", id, { ...orderJournalPayload(plan), ...(pos ? { staffName: pos.staff?.name ?? null, pickupNo } : {}) }, timestamp);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return orderView(statements.orderById.get(id));
  }

  /**
   * Every dish of one category at one VAT rate. Set menus are left alone:
   * their rate is their dishes' (vatSplit). Null when the category has no
   * dish this applies to.
   */
  function setCategoryVat(categoryInput, percentInput) {
    const category = normalizeCategoryName(categoryInput);
    const vatPercent = normalizeVatPercent(percentInput);
    const { changes } = db.prepare("UPDATE products SET vat_percent = ?, updated_at = ? WHERE category = ? AND bundle_items_json IN ('', '[]')").run(vatPercent, now(), category);
    return changes ? { updated: Number(changes), category, vatPercent } : null;
  }

  /**
   * The VAT split itself lives in `shared/rules.mjs`, so the Worker computes a
   * bill the same way rather than a second, guessed way. All that is left here
   * is reading the rows, which is the one thing the two cannot share.
   */
  function billForTable(tableNo) {
    const orders = statements.openBillOrders.all(String(tableNo));
    const itemsByOrderId = new Map(orders.map((order) => [order.id, statements.orderItems.all(order.id)]));
    const productsById = new Map();
    for (const rows of itemsByOrderId.values()) {
      for (const row of rows) {
        if (productsById.has(row.product_id)) continue;
        const product = statements.productById.get(row.product_id);
        if (product) productsById.set(row.product_id, product);
      }
    }
    return billView(tableNo, orders, itemsByOrderId, productsById);
  }

  /**
   * The table's bill on the front printer: what is still to pay, for the
   * guest to read. An interim bill (Zwischenrechnung), not a receipt — it
   * frees nothing and marks nothing paid. Paying is a receipt (checkout).
   */
  function printTableBill(tableNo) {
    const bill = billForTable(String(tableNo));
    if (!bill.items.length) return null;
    const jobId = randomUUID();
    const timestamp = now();
    statements.insertPrintJob.run(jobId, bill.orderIds[0], "front", JSON.stringify({ kind: "bill", ...bill, issuedAt: timestamp }), timestamp, timestamp);
    return { ...bill, issuedAt: timestamp, printJobId: jobId };
  }

  const sha256 = (text) => createHash("sha256").update(text).digest("hex");

  /**
   * Adds an entry to the journal, chained to the one before. Only ever
   * called inside a transaction, so two entries cannot take the same place.
   */
  function journal(kind, ref, payload, at = now()) {
    const entry = journalEntry(statements.lastJournal.get() ?? null, kind, ref, payload, at);
    statements.insertJournal.run(entry.seq, entry.at, entry.kind, entry.ref, entry.payloadJson, entry.prevHash, sha256(journalText(entry)));
  }

  function receiptDetail(row) {
    if (!row) return null;
    const storno = statements.stornoOf.get(row.id);
    const referred = row.refers_to ? statements.receiptById.get(row.refers_to) : null;
    return receiptView(row, { cancelledBy: storno?.id ?? null, referredNo: referred?.receipt_no ?? null });
  }

  /** A sale at the register (planCheckout): the receipt, and the table freed once it is all paid. */
  function checkout(input, role, pos = null) {
    const requestId = String(input.clientRequestId || randomUUID());
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = statements.receiptByRequest.get(requestId);
      if (existing) {
        db.exec("COMMIT");
        return receiptDetail(existing);
      }
      const ids = [...new Set((Array.isArray(input.items) ? input.items : []).map((item) => String(item.orderItemId)))];
      const itemRows = ids.length ? db.prepare(CHECKOUT_ITEMS_SQL.replace("(?)", `(${ids.map(() => "?").join(", ")})`)).all(...ids) : [];
      const codes = [...new Set((Array.isArray(input.payments) ? input.payments : []).filter((payment) => payment.type === "voucher").map((payment) => normalizeVoucherCode(payment.voucherCode)))];
      const voucherRows = codes.map((code) => statements.voucherByCode.get(code)).filter(Boolean);
      // Another device's open table is theirs to pay, before anything else is looked at.
      const table = input.table || itemRows[0]?.table_no;
      if (pos && table) assertClaim(statements.claimByTable.get(String(table).toUpperCase()), pos.deviceId);
      const settings = getSettings();
      const plan = planCheckout({ ...input, clientRequestId: requestId }, {
        itemRows, voucherRows, receiptNo: (statements.lastReceiptNo.get()?.no ?? 0) + 1, settings, role, staff: pos?.staff ?? null
      });
      const at = plan.receipt.createdAt;
      statements.insertReceipt.run(...receiptRow(plan.receipt));
      for (const item of plan.receiptItems) statements.insertReceiptItem.run(plan.receipt.id, item.orderItemId, item.quantity);
      for (const voucher of plan.vouchers) statements.insertVoucher.run(voucher.code, voucher.valueCents, voucher.valueCents, plan.receipt.id, at, at);
      for (const debit of plan.voucherDebits) statements.debitVoucher.run(debit.amountCents, at, debit.code);
      if (plan.receipt.table) {
        statements.settlePaidTable.run(at, at, plan.receipt.table, plan.receipt.table);
        statements.unlockPaidTable.run(at, plan.receipt.table.toUpperCase(), plan.receipt.table);
      }
      const view = plannedReceiptView(plan.receipt);
      journal("receipt.issued", plan.receipt.id, view, at);
      statements.insertPrintJob.run(randomUUID(), null, "front", JSON.stringify(receiptPrintPayload(view, settings)), at, at);
      db.exec("COMMIT");
      return receiptDetail(statements.receiptById.get(plan.receipt.id));
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Cancels a receipt with a storno receipt (planStorno). Null when there is no such receipt. */
  function stornoReceipt(id, reason, role, pos = null) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const original = statements.receiptById.get(String(id));
      if (!original) {
        db.exec("COMMIT");
        return null;
      }
      if (statements.stornoOf.get(original.id)) throw new Error("This receipt has already been cancelled");
      const settings = getSettings();
      const plan = planStorno(original, {
        receiptNo: (statements.lastReceiptNo.get()?.no ?? 0) + 1, reason, soldVoucherRows: statements.vouchersSoldBy.all(original.id), role, staff: pos?.staff ?? null
      });
      const at = plan.receipt.createdAt;
      statements.insertReceipt.run(...receiptRow(plan.receipt));
      for (const refund of plan.refunds) statements.creditVoucher.run(refund.amountCents, at, refund.code);
      for (const code of plan.voided) statements.voidVoucher.run(at, at, code);
      statements.reopenOrders.run(at, original.id);
      const view = plannedReceiptView(plan.receipt, original.receipt_no);
      journal("receipt.storno", plan.receipt.id, view, at);
      statements.insertPrintJob.run(randomUUID(), null, "front", JSON.stringify(receiptPrintPayload(view, settings)), at, at);
      db.exec("COMMIT");
      return receiptDetail(statements.receiptById.get(plan.receipt.id));
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  /** The day's closing (Z report) over the receipts since the last one. Null when there are none. */
  function closeDay(role) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const rows = statements.openReceipts.all();
      if (!rows.length) {
        db.exec("COMMIT");
        return null;
      }
      const totals = closingTotals(rows);
      const id = randomUUID();
      const at = now();
      const closingNo = (statements.lastClosingNo.get()?.no ?? 0) + 1;
      statements.insertClosing.run(id, closingNo, totals.firstReceiptNo, totals.lastReceiptNo, JSON.stringify(totals), role, at);
      const view = closingView(statements.closingById.get(id));
      journal("day.closed", id, view, at);
      statements.insertPrintJob.run(randomUUID(), null, "front", JSON.stringify(closingPrintPayload(view, getSettings())), at, at);
      db.exec("COMMIT");
      return view;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  // ——— The POS (shared/pos.mjs): devices, waiters, open tables, takeaway, settlement.

  /** Pairs a device (the manager's doing); its token is shown once. */
  async function pairDevice(nameInput) {
    const name = normalizeDeviceName(nameInput);
    const token = newSessionToken();
    const id = randomUUID();
    statements.insertDevice.run(id, name, await hashSessionToken(token), now());
    return { device: deviceView(statements.listDevices.all().find((row) => row.id === id)), token };
  }

  async function deviceForToken(token) {
    if (!token) return null;
    const row = statements.deviceByHash.get(await hashSessionToken(token));
    if (row) statements.touchDevice.run(now(), row.id);
    return row ?? null;
  }

  async function saveStaff(input, id = null) {
    const current = id ? statements.staffById.get(String(id)) : null;
    if (id && !current) return null;
    const staff = normalizeStaffInput(input, current);
    const at = now();
    try {
      if (current) {
        statements.updateStaff.run(staff.name, staff.role, staff.active ? 1 : 0, at, current.id);
        if (staff.pin) {
          const { hash, salt, iterations } = await hashPassword(staff.pin);
          statements.updateStaffPin.run(hash, salt, iterations, at, current.id);
        }
        // A waiter switched off, or given a new PIN, is signed out everywhere.
        if (!staff.active || staff.pin) statements.deleteStaffSessions.run(current.id);
        return staffView(statements.staffById.get(current.id));
      }
      const { hash, salt, iterations } = await hashPassword(staff.pin);
      const newId = randomUUID();
      statements.insertStaff.run(newId, staff.name, staff.role, hash, salt, iterations, staff.active ? 1 : 0, at, at);
      return staffView(statements.staffById.get(newId));
    } catch (error) {
      if (/UNIQUE constraint failed: staff\.name/.test(String(error.message))) throw new Error("There is already a waiter of that name");
      throw error;
    }
  }

  /** A waiter's PIN, on a paired device, for a POS session. Null when either is wrong. */
  async function posSignIn(device, staffId, pin) {
    const row = statements.staffById.get(String(staffId ?? ""));
    const stored = row ? { hash: row.pin_hash, salt: row.pin_salt, iterations: row.pin_iterations } : { hash: "", salt: ABSENT_PASSWORD_SALT, iterations: PASSWORD_ITERATIONS };
    const correct = await verifyPassword(String(pin ?? ""), stored);
    if (!row || !row.active || !correct) return null;
    const token = newSessionToken();
    const at = now();
    statements.insertPosSession.run(await hashSessionToken(token), row.id, device.id, new Date(Date.now() + POS_SESSION_TTL_MS).toISOString(), at);
    return { token, staff: staffView(row), expiresInMs: POS_SESSION_TTL_MS };
  }

  async function posSession(token) {
    if (!token) return null;
    const row = statements.posSessionByHash.get(await hashSessionToken(token));
    if (!row) return null;
    if (row.expires_at <= now() || !row.staff_active) {
      statements.deletePosSession.run(row.token_hash);
      return null;
    }
    return { role: row.staff_role === "manager" ? "manager" : "staff", staff: { id: row.staff_id, name: row.staff_name }, deviceId: row.device_id };
  }

  async function posSignOut(token) {
    if (!token) return false;
    return statements.deletePosSession.run(await hashSessionToken(token)).changes > 0;
  }

  /**
   * Opens a table on a device, or keeps it open: locked to that device for
   * CLAIM_TTL_MS after its last touch. Throws with who has it when another
   * device does.
   */
  function claimTable(tableInput, pos) {
    const table = String(tableInput).trim().toUpperCase();
    const at = now();
    statements.upsertClaim.run(table, pos.deviceId, pos.staff?.id ?? null, pos.staff?.name ?? null, new Date(Date.now() + CLAIM_TTL_MS).toISOString(), at);
    const row = statements.claimByTable.get(table);
    assertClaim(row, pos.deviceId, at);
    return claimView(row, at);
  }

  function holdsTable(tableInput, deviceId) {
    return holdsClaim(statements.claimByTable.get(String(tableInput).trim().toUpperCase()), deviceId);
  }

  /** Closes a table on this device; a manager may close it on any. */
  function releaseTable(tableInput, pos, force = false) {
    return statements.releaseClaim.run(String(tableInput).trim().toUpperCase(), pos.deviceId, force ? 1 : 0).changes > 0;
  }

  /** A new takeaway: the next pickup number today, opened on this device. */
  function newTakeaway(pos) {
    const since = `${now().slice(0, 10)}T00:00:00.000Z`;
    let next = statements.nextPickup.get(since)?.next ?? 1;
    // A number another device has open but not yet ordered on is taken too.
    for (;; next += 1) {
      try {
        return { table: `${TAKEAWAY_PREFIX}${next}`, pickupNo: next, claim: claimTable(`${TAKEAWAY_PREFIX}${next}`, pos) };
      } catch (error) {
        if (error.code !== "TABLE_CLAIMED") throw error;
      }
    }
  }

  /** Moves a table's open orders to another table (the guests changed tables). */
  function moveTable(fromInput, toInput, pos) {
    const from = normalizeTableNo(fromInput);
    const to = normalizeTableNo(toInput);
    if (from === to) throw new Error("That is the same table");
    db.exec("BEGIN IMMEDIATE");
    try {
      assertClaim(statements.claimByTable.get(from), pos.deviceId);
      assertClaim(statements.claimByTable.get(to), pos.deviceId);
      const at = now();
      const moved = statements.moveTableOrders.run(to, at, from).changes;
      if (!moved) {
        db.exec("COMMIT");
        return null;
      }
      journal("table.moved", from, { from, to, orders: Number(moved), staffName: pos.staff?.name ?? null }, at);
      statements.releaseClaim.run(from, pos.deviceId, 0);
      db.exec("COMMIT");
      return { from, to, moved: Number(moved) };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  /** A waiter's settlement at the end of the shift. Null when they took nothing since the last. */
  function settleStaff(staffId, role) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const staff = statements.staffById.get(String(staffId));
      const rows = staff ? statements.openStaffReceipts.all(staff.id, staff.id) : [];
      if (!rows.length) {
        db.exec("COMMIT");
        return null;
      }
      const totals = settlementTotals(rows);
      const id = randomUUID();
      const at = now();
      statements.insertSettlement.run(id, staff.id, staff.name, totals.lastReceiptNo, JSON.stringify(totals), at);
      const view = settlementView(statements.settlementById.get(id));
      journal("staff.settled", id, { ...view, by: role }, at);
      statements.insertPrintJob.run(randomUUID(), null, "front", JSON.stringify({ kind: "settlement", company: companyOf(getSettings()), settlement: view }), at, at);
      db.exec("COMMIT");
      return view;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * The journal between two days (from inclusive, to exclusive, as ISO
   * dates), checked link by link from the entry before the first.
   */
  async function exportJournal(from, to) {
    const rows = statements.journalBetween.all(from, to);
    const before = rows.length && rows[0].seq > 1 ? statements.journalBySeq.get(rows[0].seq - 1) : null;
    return { entries: rows.map(journalView), verification: await verifyJournal(rows, before) };
  }


  function updateOrder(id, status) {
    if (!ORDER_STATUSES.has(status)) throw new Error("Unsupported order status");
    const current = statements.orderById.get(String(id));
    if (!current) return null;
    if (current.status !== status && !ORDER_TRANSITIONS.get(current.status)?.has(status)) {
      throw new Error(`Invalid order transition: ${current.status} -> ${status}`);
    }
    if (current.status === status) return orderView(current);
    db.exec("BEGIN IMMEDIATE");
    try {
      // A paid line stays paid: cancelling it is a storno of its receipt.
      if (status === "cancelled" && statements.orderPaid.get(current.id)) throw new Error("This order is on a receipt; cancel the receipt first");
      const at = now();
      statements.updateOrderStatus.run(status, at, current.id);
      journal("order.status", current.id, { orderId: current.id, orderNo: current.order_no, table: current.table_no, from: current.status, to: status }, at);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return orderView(statements.orderById.get(String(id)));
  }

  function createServiceRequest(input) {
    const id = randomUUID();
    const timestamp = now();
    statements.insertRequest.run(id, String(input.table), String(input.type || "").trim(), timestamp, timestamp);
    return serviceRequestView(statements.requestById.get(id));
  }

  function updateServiceRequest(id, status) {
    if (!REQUEST_STATUSES.has(status)) throw new Error("Unsupported service request status");
    const current = statements.requestById.get(String(id));
    if (!current) return null;
    if (current.status !== status && !REQUEST_TRANSITIONS.get(current.status)?.has(status)) {
      throw new Error(`Invalid service request transition: ${current.status} -> ${status}`);
    }
    statements.updateRequest.run(status, now(), String(id));
    return serviceRequestView(statements.requestById.get(String(id)));
  }

  function saveTable(input) {
    const table = normalizeTableNo(input.table);
    const current = statements.tableByNo.get(table);
    const timestamp = now();
    const token = input.rotateToken || !current ? randomBytes(12).toString("base64url") : current.token;
    statements.upsertTable.run(table, String(input.label ?? current?.label ?? "").trim(), token, bool(input.enabled, current ? Boolean(current.enabled) : true), current?.created_at ?? timestamp, timestamp);
    return tableView(statements.tableByNo.get(table));
  }

  function printerView(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      transport: row.transport,
      address: row.address,
      port: row.port,
      role: row.role,
      enabled: Boolean(row.enabled),
      capabilities: parseJson(row.capabilities_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  // ——— The account (shared/account.mjs): registration, sign-in, sessions.

  function accountStatus() {
    return { registered: statements.accountCount.get().count > 0 };
  }

  async function openAccountSession(row) {
    const token = newSessionToken();
    const timestamp = now();
    statements.deleteExpiredAccountSessions.run(timestamp);
    statements.insertAccountSession.run(await hashSessionToken(token), row.id, new Date(Date.now() + ACCOUNT_SESSION_TTL_MS).toISOString(), timestamp);
    return { token, expiresInMs: ACCOUNT_SESSION_TTL_MS, account: accountView(row) };
  }

  /** The first account, and only the first: null once one exists. */
  async function registerAccount(input) {
    const { login, name, password } = normalizeRegistration(input);
    const stored = await hashPassword(password);
    const timestamp = now();
    const id = randomUUID();
    if (!statements.registerAccount.run(id, login, name, stored.hash, stored.salt, stored.iterations, timestamp, timestamp).changes) return null;
    return openAccountSession(statements.accountById.get(id));
  }

  /** An account name and its password for a session, or null — an unknown
   *  name costs the same PBKDF2 work as a wrong password, so timing says nothing. */
  async function signInAccount(loginInput, password) {
    const row = statements.accountByLogin.get(String(loginInput ?? "").trim().toLowerCase());
    const stored = row ? storedPassword(row) : { hash: "", salt: ABSENT_PASSWORD_SALT, iterations: PASSWORD_ITERATIONS };
    const correct = await verifyPassword(String(password ?? ""), stored);
    return row && correct ? openAccountSession(row) : null;
  }

  /**
   * Changes the account's name, its display name or its password, always
   * against the password in force — a session left open on a counter must not
   * be enough to take the account over. A new password ends every session and
   * hands this one a fresh token. Null on a wrong current password.
   */
  async function updateAccount(accountId, input) {
    const row = statements.accountById.get(String(accountId));
    if (!row || !(await verifyPassword(String(input?.currentPassword ?? ""), storedPassword(row)))) return null;
    const login = input.login === undefined ? row.login : normalizeLogin(input.login);
    const name = input.name === undefined ? row.name : normalizeAccountName(input.name, login);
    const stored = input.password === undefined ? storedPassword(row) : await hashPassword(assertPassword(input.password));
    if (login !== row.login && statements.accountByLogin.get(login)) throw new Error("That account name is taken");
    statements.updateAccount.run(login, name, stored.hash, stored.salt, stored.iterations, now(), row.id);
    if (input.password !== undefined) statements.deleteAccountSessions.run(row.id);
    const updated = statements.accountById.get(row.id);
    return input.password !== undefined ? openAccountSession(updated) : { account: accountView(updated) };
  }

  /**
   * The way back in with ADMIN_TOKEN when the password is forgotten: sets the
   * owner's password (and name, if given), or registers the owner when there
   * is no account yet. Every session of the owner ends.
   */
  async function recoverAccount(input) {
    const owner = statements.ownerAccount.get();
    if (!owner) {
      await registerAccount({ login: input?.login ?? MIGRATED_LOGIN, name: input?.name, password: input?.password });
      return { account: accountView(statements.ownerAccount.get()) };
    }
    const login = input?.login === undefined ? owner.login : normalizeLogin(input.login);
    const stored = await hashPassword(assertPassword(input?.password));
    statements.updateAccount.run(login, normalizeAccountName(input?.name ?? owner.name, login), stored.hash, stored.salt, stored.iterations, now(), owner.id);
    statements.deleteAccountSessions.run(owner.id);
    return { account: accountView(statements.accountById.get(owner.id)) };
  }

  /** Who a token belongs to: the account (as manager), a waiter on a POS
   *  device, or nobody — expired and revoked look the same to a caller. */
  async function roleForSession(token) {
    if (!token) return null;
    const tokenHash = await hashSessionToken(token);
    const row = statements.accountSession.get(tokenHash);
    if (!row) return posSession(token);
    if (row.expires_at <= now()) {
      statements.deleteAccountSession.run(tokenHash);
      return null;
    }
    return { role: "manager", account: accountView(row) };
  }

  async function signOut(token) {
    if (!token) return false;
    return statements.deleteAccountSession.run(await hashSessionToken(token)).changes > 0;
  }

  function getSettings() {
    const values = Object.fromEntries(statements.allAppSettings.all().map((row) => [row.key, row.value]));
    return settingsView(statements.getSettings.get(), values);
  }

  /** Any subset of the settings may come; the ones left out keep their value.
   *  All of it is checked before any of it is written. */
  function saveSettings(input) {
    const { menuTheme, rows } = normalizeSettingsInput(input);
    const timestamp = now();
    if (menuTheme !== undefined) statements.upsertSettings.run(menuTheme, timestamp);
    for (const [key, value] of rows) statements.setAppSetting.run(key, value, timestamp);
    return getSettings();
  }

  function savePrinter(input, id) {
    const current = id ? statements.printerById.get(String(id)) : null;
    if (id && !current) return null;
    const printer = {
      id: String(id || input.id || randomUUID()),
      name: String(input.name ?? current?.name ?? "").trim(),
      transport: String(input.transport ?? current?.transport ?? "lan"),
      address: String(input.address ?? current?.address ?? "").trim(),
      port: input.port === null ? null : Number(input.port ?? current?.port ?? 9100),
      role: String(input.role ?? current?.role ?? "front"),
      enabled: bool(input.enabled, current ? Boolean(current.enabled) : true),
      capabilities: JSON.stringify(input.capabilities ?? parseJson(current?.capabilities_json, {}))
    };
    if (!printer.name || !printer.address) throw new Error("Printer name and address are required");
    if (!["lan", "bluetooth", "usb"].includes(printer.transport)) throw new Error("Unsupported printer transport");
    if (!PRINT_STATIONS.has(printer.role)) throw new Error("Unsupported printer role");
    if (printer.port !== null && (!Number.isInteger(printer.port) || printer.port < 1 || printer.port > 65535)) throw new Error("Printer port must be between 1 and 65535");
    const timestamp = now();
    if (current) {
      statements.updatePrinter.run(printer.name, printer.transport, printer.address, printer.port, printer.role, printer.enabled, printer.capabilities, timestamp, printer.id);
    } else {
      statements.insertPrinter.run(printer.id, printer.name, printer.transport, printer.address, printer.port, printer.role, printer.enabled, printer.capabilities, timestamp, timestamp);
    }
    // The DTO, like the list route. Returning the row here made POST answer
    // `enabled: 1` and `capabilities_json` where GET answers `enabled: true`
    // and `capabilities` — one resource with two shapes depending on the verb.
    return printerView(statements.printerById.get(printer.id));
  }

  function seed() {
    const existing = statements.allProducts.all();
    const isLegacyDemoCatalog = existing.length > 0 && existing.length <= 15 && existing.every((row) => row.sku.startsWith("FOOD-"));
    if (isLegacyDemoCatalog) db.exec("DELETE FROM products");
    if (statements.productCount.get().count) {
      const ramen = statements.productBySku.get("R1");
      if (ramen && !parseJson(ramen.modifiers_json, []).length) {
        for (const dish of photoMenuDishes) {
          const current = statements.productBySku.get(dish.sku);
          if (current) saveProduct({ modifiers: dish.modifiers || [] }, current.id);
        }
      }
      return;
    }
    db.exec("BEGIN");
    try {
      photoMenuDishes.forEach((dish, index) => saveProduct({
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
      }));
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * A photo for every dish that has none. Each photo is attached once: its
   * row in media_files is the record that it was, so a photo the owner later
   * removes from a dish stays removed across restarts.
   */
  function seedPhotos() {
    const photos = dishPhotos();
    if (!photos.length) return;
    db.exec("BEGIN");
    try {
      for (const photo of photos) {
        if (statements.mediaFileExists.get(photo.fileId)) continue;
        statements.insertMediaFile.run(photo.fileId, photo.contentType, photo.bytes, photo.credit, photo.sourceUrl, now());
        if (statements.productById.get(photo.productId) && !statements.mediaCount.get(photo.productId).count) {
          statements.insertMedia.run(`seed-${photo.fileId}`, photo.productId, "image", `/media/${photo.fileId}`, null, 0, now());
        }
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function getMediaFile(id) {
    const row = statements.mediaFile.get(String(id));
    return row ? { contentType: row.content_type, bytes: Buffer.from(row.bytes) } : null;
  }

  /**
   * The starting set menus, once. The marker, not the products, records that
   * it happened, so a set the owner deletes is not put back on the next start.
   */
  function seedSetMenus() {
    if (statements.allAppSettings.all().some((row) => row.key === SET_MENU_SEED_KEY)) return;
    db.exec("BEGIN");
    try {
      for (const set of setMenuProducts(listProducts(false))) {
        if (!statements.productById.get(set.id) && !statements.productBySku.get(set.sku)) saveProduct(set);
      }
      statements.setAppSetting.run(SET_MENU_SEED_KEY, "true", now());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  seed();
  seedSetMenus();
  seedPhotos();

  return {
    close: () => db.close(),
    listProducts,
    getProduct,
    saveProduct,
    deleteProduct: (id) => statements.deleteProduct.run(String(id)).changes > 0,
    addMedia,
    duplicateProduct,
    renameCategory,
    setCategoryVat,
    getMediaFile,
    deleteMedia: (id) => statements.deleteMedia.run(String(id)).changes > 0,
    listOrders: (limit = 100) => statements.listOrders.all(Math.min(Number(limit) || 100, 500)).map(orderView),
    createOrder,
    updateOrder,
    billForTable,
    printTableBill,
    pairDevice,
    deviceForToken,
    listDevices: () => statements.listDevices.all().map(deviceView),
    deleteDevice: (id) => statements.deleteDevice.run(String(id)).changes > 0,
    listStaff: (activeOnly = false) => statements.listStaff.all().filter((row) => !activeOnly || row.active).map(staffView),
    saveStaff,
    posSignIn,
    posSession,
    posSignOut,
    claimTable,
    releaseTable,
    holdsTable,
    liveClaims: () => statements.liveClaims.all(now()).map((row) => claimView(row)),
    newTakeaway,
    moveTable,
    settleStaff,
    staffSettlementPreview: (staffId) => settlementTotals(statements.openStaffReceipts.all(String(staffId), String(staffId))),
    listSettlements: (limit = 30) => statements.recentSettlements.all(Math.min(Number(limit) || 30, 200)).map(settlementView),
    checkout,
    stornoReceipt,
    closeDay,
    exportJournal,
    closingPreview: () => closingTotals(statements.openReceipts.all()),
    listClosings: (limit = 30) => statements.recentClosings.all(Math.min(Number(limit) || 30, 366)).map(closingView),
    listReceipts: (limit = 50) => statements.recentReceipts.all(Math.min(Number(limit) || 50, 500)).map(receiptDetail),
    getReceipt: (id) => receiptDetail(statements.receiptById.get(String(id))),
    getVoucher: (code) => {
      const row = statements.voucherByCode.get(normalizeVoucherCode(code));
      return row ? { code: row.code, valueCents: row.value_cents, balanceCents: row.balance_cents, voided: Boolean(row.voided_at), createdAt: row.created_at } : null;
    },
    openBillTables: () => statements.openBillTables.all().map((row) => row.table_no),
    listServiceRequests: (limit = 100) => statements.listRequests.all(Math.min(Number(limit) || 100, 500)).map(serviceRequestView),
    createServiceRequest,
    updateServiceRequest,
    recordAudit: (entry) => {
      statements.insertAudit.run(randomUUID(), now(), String(entry.role), String(entry.ip ?? ""), String(entry.method), String(entry.route), Number(entry.status), JSON.stringify(entry.detail ?? {}));
    },
    listAudit: (limit = 100) => statements.listAudit.all(Math.min(Number(limit) || 100, 500)).map(auditView),
    /**
     * Every table the floor has to look at, whether or not it is registered.
     *
     * An unregistered table with orders on it is real — someone scanned a card
     * that was deleted, or typed a number — so it appears as seated rather
     * than not appearing at all.
     */
    tablesOverview: () => tablesOverviewView(
      statements.listTables.all(),
      statements.openOrdersForTables.all().map((row) => orderView(row)),
      statements.liveClaims.all(now()).map((row) => claimView(row))
    ),
    staffActivity: () => {
      const staffRows = statements.listStaff.all();
      const shifts = new Map(staffRows.map((row) => [row.id, settlementTotals(statements.openStaffReceipts.all(row.id, row.id))]));
      return staffActivityView(staffRows, statements.livePosSessions.all(now()), statements.liveClaims.all(now()).map((row) => claimView(row)), shifts);
    },
    setTableLock: (table, locked) => {
      const tableNo = normalizeTableNo(table);
      if (!statements.tableByNo.get(tableNo)) return null;
      const timestamp = now();
      statements.setTableLock.run(locked ? timestamp : null, timestamp, tableNo);
      return tableView(statements.tableByNo.get(tableNo));
    },
    hasTables: () => statements.tableCount.get().count > 0,
    listTables: () => statements.listTables.all().map(tableView),
    getTable: (table) => tableView(statements.tableByNo.get(String(table ?? "").trim().toUpperCase())),
    saveTable,
    deleteTable: (table) => statements.deleteTable.run(String(table ?? "").trim().toUpperCase()).changes > 0,
    listPrinters: () => statements.listPrinters.all().map(printerView),
    savePrinter,
    deletePrinter: (id) => statements.deletePrinter.run(String(id)).changes > 0,
    getSettings,
    saveSettings,
    accountStatus,
    registerAccount,
    signInAccount,
    updateAccount,
    recoverAccount,
    signOut,
    roleForSession,
    listPrintJobs: (status = "queued", limit = 100) => statements.listPrintJobs.all(String(status), Math.min(Number(limit) || 100, 500)).map(printJobView),
    claimPrintJob: (role, workerId, leaseMs = 30_000) => {
      const timestamp = now();
      const leaseUntil = new Date(Date.now() + leaseMs).toISOString();
      db.exec("BEGIN IMMEDIATE");
      try {
        const job = statements.claimablePrintJob.get(String(role), timestamp, timestamp);
        if (!job) { db.exec("COMMIT"); return null; }
        const changed = statements.claimPrintJob.run(String(workerId), leaseUntil, timestamp, job.id, timestamp).changes;
        db.exec("COMMIT");
        return changed ? { ...job, status: "claimed", claimed_by: String(workerId), lease_until: leaseUntil, payload: parseJson(job.payload_json, {}) } : null;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    completePrintJob: (id, workerId) => statements.completePrintJob.run(now(), String(id), String(workerId)).changes > 0,
    failPrintJob: (id, workerId, error, maxAttempts = 5) => {
      const current = statements.printJobById.get(String(id));
      if (!current || current.claimed_by !== String(workerId)) return false;
      const attempts = Number(current.attempts || 0) + 1;
      const status = attempts >= maxAttempts ? "failed" : "retry-wait";
      const nextAttemptAt = status === "failed" ? null : new Date(Date.now() + Math.min(300_000, 2_000 * 2 ** Math.min(attempts, 7))).toISOString();
      return statements.failPrintJob.run(status, String(error).slice(0, 1000), nextAttemptAt, now(), String(id), String(workerId)).changes > 0;
    },
    retryPrintJob: (id) => statements.retryPrintJob.run(now(), String(id)).changes > 0,
    printerForRole: (role) => {
      const row = statements.listPrinters.all().find((printer) => printer.role === String(role) && printer.enabled);
      return row ? { ...row, enabled: Boolean(row.enabled), capabilities: parseJson(row.capabilities_json, {}) } : null;
    }
  };
}

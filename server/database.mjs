import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { photoMenuDishes } from "./photo-menu.mjs";
import { dishPhotos } from "./dish-photos.mjs";
import { SET_MENU_SEED_KEY, setMenuProducts } from "./set-menus.mjs";
import { sqliteDriver } from "./sqlite-driver.mjs";
import { now, parseJson } from "../shared/core.mjs";
import { DEFAULT_TENANT_ID } from "../shared/tenant.mjs";
import { DEFAULT_VAT_PERCENT, mapProduct, normalizeProduct } from "../shared/products.mjs";
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
const SCHEMA_VERSION = 12;
const BUSY_TIMEOUT_MS = Number(process.env.SQLITE_BUSY_TIMEOUT_MS || 5000);

export function createDatabase(databasePath, { busyTimeoutMs = BUSY_TIMEOUT_MS, passwordViewKey = null } = {}) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  // The API server and every print agent open the same file from separate processes.
  // Without a busy timeout the second writer fails immediately with SQLITE_BUSY.
  // The schema, as one string so the tenant migration below can read a
  // table's own CREATE statement back out of it: a rebuild uses the exact
  // definition the server itself declares, so the two cannot drift apart.
  const SCHEMA_SQL = `
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = ${Number(busyTimeoutMs) || 0};
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      sku TEXT NOT NULL,
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
      tag_color TEXT NOT NULL DEFAULT '',
      available INTEGER NOT NULL DEFAULT 1,
      published INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      print_station TEXT NOT NULL DEFAULT 'kitchen',
      print_printer_id TEXT NOT NULL DEFAULT '',
      modifiers_json TEXT NOT NULL DEFAULT '[]',
      vat_percent INTEGER NOT NULL DEFAULT 10,
      bundle_items_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (tenant_id, sku)
    );

    CREATE TABLE IF NOT EXISTS product_media (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('image','video')),
      url TEXT NOT NULL,
      poster_url TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      order_no TEXT NOT NULL,
      client_request_id TEXT,
      table_no TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      note TEXT NOT NULL DEFAULT '',
      total_cents INTEGER NOT NULL,
      billed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (tenant_id, order_no),
      UNIQUE (tenant_id, client_request_id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
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
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      split_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_item_notes (
      order_item_id TEXT PRIMARY KEY REFERENCES order_items(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      note TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_item_holds (
      order_item_id TEXT PRIMARY KEY REFERENCES order_items(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      held_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      receipt_no INTEGER NOT NULL,
      client_request_id TEXT NOT NULL,
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
      staff_name TEXT,
      UNIQUE (tenant_id, receipt_no),
      UNIQUE (tenant_id, client_request_id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_one_storno ON receipts(refers_to) WHERE refers_to IS NOT NULL;

    CREATE TABLE IF NOT EXISTS receipt_items (
      receipt_id TEXT NOT NULL REFERENCES receipts(id),
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      order_item_id TEXT NOT NULL REFERENCES order_items(id),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      PRIMARY KEY (receipt_id, order_item_id)
    );

    CREATE INDEX IF NOT EXISTS idx_receipt_items_item ON receipt_items(order_item_id);

    CREATE TABLE IF NOT EXISTS vouchers (
      code TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      value_cents INTEGER NOT NULL,
      balance_cents INTEGER NOT NULL CHECK (balance_cents >= 0),
      sold_receipt_id TEXT NOT NULL REFERENCES receipts(id),
      voided_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, code)
    );

    CREATE TABLE IF NOT EXISTS day_closings (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      closing_no INTEGER NOT NULL,
      first_receipt_no INTEGER NOT NULL,
      last_receipt_no INTEGER NOT NULL,
      totals_json TEXT NOT NULL,
      staff_role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (tenant_id, closing_no),
      UNIQUE (tenant_id, last_receipt_no)
    );

    CREATE TABLE IF NOT EXISTS pos_devices (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      last_seen_at TEXT
    );

    CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('staff','manager')),
      pin_hash TEXT NOT NULL,
      pin_salt TEXT NOT NULL,
      pin_iterations INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (tenant_id, name)
    );

    CREATE TABLE IF NOT EXISTS pos_sessions (
      token_hash TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL REFERENCES pos_devices(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS table_claims (
      table_no TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      device_id TEXT NOT NULL,
      staff_id TEXT,
      staff_name TEXT,
      expires_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, table_no)
    );

    -- Collaborative tables (many devices at one table) and the table lock's
    -- fencing token, kept beside table_claims rather than on it: a deployed D1
    -- takes a new table safely but not a new column (SQLite has no ADD COLUMN
    -- IF NOT EXISTS), the way 0069/0072 do it. shared = 1 lets several devices
    -- order and void on the table at once — correctness still comes from the
    -- journal's optimistic lock (shared/store.mjs). epoch climbs by one each
    -- time the table changes hands, so a device whose hold lapsed can be told
    -- apart from the one that holds it now. See migrations/0108.
    CREATE TABLE IF NOT EXISTS table_claim_meta (
      table_no TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      shared INTEGER NOT NULL DEFAULT 0,
      epoch INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (tenant_id, table_no)
    );

    CREATE TABLE IF NOT EXISTS order_staff (
      order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
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
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
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
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      staff_id TEXT NOT NULL,
      staff_name TEXT NOT NULL,
      last_receipt_no INTEGER NOT NULL,
      totals_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS journal (
      seq INTEGER NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      ref TEXT,
      payload_json TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL,
      PRIMARY KEY (tenant_id, seq)
    );

    CREATE TABLE IF NOT EXISTS service_requests (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      table_no TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      at TEXT NOT NULL,
      role TEXT NOT NULL,
      ip TEXT NOT NULL DEFAULT '',
      method TEXT NOT NULL,
      route TEXT NOT NULL,
      status INTEGER NOT NULL,
      detail_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS restaurant_tables (
      table_no TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      label TEXT NOT NULL DEFAULT '',
      token TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      locked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, table_no)
    );

    CREATE TABLE IF NOT EXISTS printer_profiles (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
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
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
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
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      menu_theme TEXT NOT NULL DEFAULT 'jade',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id)
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
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, key)
    );

    -- Pictures kept in the database itself, served at /media/<id>. The Worker
    -- has no disk and no bucket, so this is where its photos live; the Node
    -- server keeps the seeded dish photos here too, so both answer the same
    -- URL. Uploads on the Node server still go to UPLOAD_DIR.
    -- See migrations/0005_dish_photos.sql.
    CREATE TABLE IF NOT EXISTS media_files (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
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
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      login TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_iterations INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('owner', 'admin')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
      email TEXT NOT NULL DEFAULT '',
      password_enc TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- The restaurants this deployment serves: one row per restaurant, and the
    -- data that belongs to it is every row carrying its id. The first tenant
    -- owns what was there before tenants existed. See migrations/0112.
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
      config_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- A tenant's role tokens: its kitchen screen and staff tablets sign in
    -- with these, because the shared tokens a deployment configures belong to
    -- the first tenant only. Only the SHA-256 of a token is stored.
    CREATE TABLE IF NOT EXISTS tenant_tokens (
      token_hash TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      role TEXT NOT NULL CHECK (role IN ('kitchen', 'staff', 'manager')),
      created_at TEXT NOT NULL
    );

    -- One-time links: an invite (a new admin sets their password) and a
    -- password reset (an existing account sets a new one). Only the SHA-256
    -- of the token is stored.
    CREATE TABLE IF NOT EXISTS account_tokens (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('invite', 'reset')),
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
      login TEXT,
      name TEXT,
      email TEXT,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_account_tokens_expiry ON account_tokens(expires_at);

    CREATE TABLE IF NOT EXISTS account_sessions (
      token_hash TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
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
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      email TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_iterations INTEGER NOT NULL,
      points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (tenant_id, email)
    );

    CREATE TABLE IF NOT EXISTS customer_sessions (
      token_hash TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customer_favorites (
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      product_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (customer_id, product_id)
    );

    CREATE TABLE IF NOT EXISTS points_ledger (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL CHECK (reason IN ('earn','reverse','redeem','refund','adjust')),
      ref TEXT,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    -- A member's stored value (会员储值): the running balance, and the ledger
    -- it is the sum of — money put in, the house's bonus, bills settled from
    -- it, refunds and the manager's hand-changes. A table of its own rather
    -- than a column on customers, because that is what a deployed D1 can be
    -- given safely. The balance may never go below zero, so two bills spending
    -- the same balance cannot both be written. See migrations/0069_member_balance.sql.
    CREATE TABLE IF NOT EXISTS member_balances (
      customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS balance_ledger (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      delta_cents INTEGER NOT NULL,
      reason TEXT NOT NULL CHECK (reason IN ('topup','bonus','spend','refund','adjust','reverse')),
      ref TEXT,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    -- Who booked each balance change (会员储值操作人): keyed by the ledger
    -- entry's id. A table of its own, not a column on balance_ledger, because a
    -- deployed D1 can be given a new table safely but not a new column (SQLite
    -- has no ADD COLUMN IF NOT EXISTS, and 0001 is regenerated from this schema
    -- so a later ADD COLUMN would collide on a fresh deploy). A top-up and a
    -- manager's hand-adjust record their operator here, so a member's ledger is
    -- a full audit trail. See migrations/0072_balance_operator.sql.
    CREATE TABLE IF NOT EXISTS balance_operators (
      ledger_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      operator TEXT NOT NULL DEFAULT ''
    );

    -- 会员生日 (生日营销, shared/customer.mjs): the member's birthday as a month
    -- and day only — never the year, so no age or full date of birth is kept.
    -- A table of its own, like the balances, because a deployed D1 takes a new
    -- table safely but not a new column. See migrations/0070_member_birthday.sql.
    CREATE TABLE IF NOT EXISTS member_birthdays (
      customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
      day INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
      updated_at TEXT NOT NULL
    );

    -- 生日祝福邮件: one greeting a member a year, claimed before it is sent, so
    -- two runs (or two Worker isolates) never mail the same member twice.
    -- See migrations/0071_birthday_greetings.sql.
    CREATE TABLE IF NOT EXISTS birthday_greetings (
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      year INTEGER NOT NULL,
      sent_at TEXT NOT NULL,
      PRIMARY KEY (customer_id, year)
    );

    -- A guest's own order from the menu (shared/ordering.mjs): at the table or
    -- for pickup, by whom when signed in, and the points it spent.
    CREATE TABLE IF NOT EXISTS guest_orders (
      order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
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
      table_no TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      opened_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      staff_name TEXT,
      PRIMARY KEY (tenant_id, table_no)
    );

    -- The print bridges in the restaurant (server/print-agent.mjs) and what
    -- each last found at its printers. See migrations/0058_print_bridge.sql.
    CREATE TABLE IF NOT EXISTS print_bridges (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      name TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '',
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS printer_status (
      printer_id TEXT PRIMARY KEY REFERENCES printer_profiles(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      bridge_id TEXT NOT NULL,
      ok INTEGER NOT NULL,
      error TEXT,
      checked_at TEXT NOT NULL
    );

    -- Wrong passwords and PINs, counted where every process sees the same
    -- count. See migrations/0061_auth_throttle.sql.
    CREATE TABLE IF NOT EXISTS auth_throttle (
      key TEXT PRIMARY KEY,
      failures INTEGER NOT NULL,
      reset_at TEXT NOT NULL
    );

    -- Guests' table bookings (shared/reservations.mjs). The day and time are
    -- the restaurant's own wall clock. See migrations/0062_reservations.sql.
    CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      reference TEXT NOT NULL,
      token_hash TEXT,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      party INTEGER NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      table_no TEXT,
      source TEXT NOT NULL,
      customer_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (tenant_id, reference)
    );

    -- One row per booking already reminded (shared/reminders.mjs): the
    -- day-before reminder email is sent once and never again, whatever the
    -- schedule fires. A row, not a column, so the migration is a no-op on a
    -- database created from today's schema. See migrations/0069_reservation_reminders.sql.
    CREATE TABLE IF NOT EXISTS reservation_reminders (
      reservation_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      sent_at TEXT NOT NULL
    );

    -- Walk-in waitlist (shared/waitlist.mjs, shared/waitlist-store.mjs): parties
    -- taken at the door when full, in arrival order; notified, then seated or
    -- gone. See migrations/0070_waitlist.sql.
    CREATE TABLE IF NOT EXISTS waitlist (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      party INTEGER NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      notified_at TEXT
    );

    -- Orders from the delivery platforms (shared/delivery.mjs), once per
    -- platform and platform id. See migrations/0063_delivery_orders.sql.
    CREATE TABLE IF NOT EXISTS delivery_orders (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      reference TEXT NOT NULL,
      status TEXT NOT NULL,
      type TEXT NOT NULL,
      placed_at TEXT,
      due_at TEXT,
      customer_name TEXT NOT NULL DEFAULT '',
      customer_phone TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      items_json TEXT NOT NULL,
      total_cents INTEGER NOT NULL,
      delivery_fee_cents INTEGER NOT NULL DEFAULT 0,
      paid_online INTEGER NOT NULL DEFAULT 1,
      test INTEGER NOT NULL DEFAULT 0,
      prep_minutes INTEGER,
      reject_reason TEXT,
      sync_status TEXT NOT NULL DEFAULT 'none',
      sync_error TEXT,
      synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (tenant_id, provider, external_id)
    );

    -- Portions a dish has left today (shared/stock.mjs): its daily limit and
    -- today's count. See migrations/0064_product_stock.sql.
    CREATE TABLE IF NOT EXISTS product_stock (
      product_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      daily_limit INTEGER,
      stock_day TEXT,
      stock_left INTEGER,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, product_id)
    );

    -- A guest's email proved by a code before they book (shared/email-verify.mjs):
    -- the codes sent (hashed), the addresses proved, and — MAIL_OUTBOX only,
    -- for the tests — the messages kept instead of sent. See
    -- migrations/0066_email_verification.sql.
    CREATE TABLE IF NOT EXISTS email_codes (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      customer_id TEXT NOT NULL,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_email_codes_customer ON email_codes(customer_id, created_at);
    CREATE TABLE IF NOT EXISTS customer_verified_emails (
      customer_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      email TEXT NOT NULL,
      verified_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mail_outbox (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- The cash drawer (shared/drawer.mjs): a shift's float, money in and
    -- out, and the count at the end. open_flag is 1 on the one open drawer
    -- and NULL once counted, so UNIQUE allows one open at a time. See
    -- migrations/0065_cash_drawer.sql.
    CREATE TABLE IF NOT EXISTS drawer_sessions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      open_flag INTEGER,
      after_receipt_no INTEGER NOT NULL,
      float_cents INTEGER NOT NULL,
      opened_by TEXT,
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      closed_by TEXT,
      last_receipt_no INTEGER,
      counted_cents INTEGER,
      counts_json TEXT,
      totals_json TEXT,
      note TEXT,
      UNIQUE (tenant_id, open_flag)
    );
    CREATE INDEX IF NOT EXISTS idx_drawer_sessions_closed ON drawer_sessions(closed_at);
    CREATE TABLE IF NOT EXISTS drawer_movements (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      session_id TEXT NOT NULL REFERENCES drawer_sessions(id),
      kind TEXT NOT NULL CHECK (kind IN ('in','out')),
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      reason TEXT NOT NULL,
      staff_id TEXT,
      staff_name TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_drawer_movements_session ON drawer_movements(session_id);

    -- The printers a bridge found on the shop's network, for the console to
    -- offer. See migrations/0059_discovered_printers.sql.
    CREATE TABLE IF NOT EXISTS discovered_printers (
      address TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      port INTEGER NOT NULL,
      escpos INTEGER NOT NULL DEFAULT 0,
      bridge_id TEXT NOT NULL,
      seen_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, address, port)
    );

    INSERT INTO accounts (id, login, name, password_hash, password_salt, password_iterations, created_at, updated_at)
    SELECT 'owner', 'admin', 'Admin', password_hash, password_salt, password_iterations, updated_at, updated_at
    FROM admin_gate WHERE id = 1 AND NOT EXISTS (SELECT 1 FROM accounts);
    DELETE FROM admin_gate;
    DELETE FROM admin_sessions;

    -- Hours were briefly kept per dish; they belong to the promotions and set
    -- menus pages (app_settings). See migrations/0052_drop_product_schedules.sql.
    DROP TABLE IF EXISTS product_schedules;

    CREATE INDEX IF NOT EXISTS idx_products_catalog ON products(tenant_id, published, available, sort_order);
    CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_account_sessions_expiry ON account_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_order_item_voids_item ON order_item_voids(order_item_id);
    CREATE INDEX IF NOT EXISTS idx_order_item_voids_staff ON order_item_voids(tenant_id, staff_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(tenant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_receipts_created ON receipts(tenant_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_customer_sessions_expiry ON customer_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_points_ledger_customer ON points_ledger(tenant_id, customer_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_points_ledger_ref ON points_ledger(ref, reason);
    CREATE INDEX IF NOT EXISTS idx_balance_ledger_customer ON balance_ledger(tenant_id, customer_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_balance_ledger_ref ON balance_ledger(ref, reason);
    CREATE INDEX IF NOT EXISTS idx_guest_orders_table ON guest_orders(tenant_id, table_no, created_at);
    CREATE INDEX IF NOT EXISTS idx_guest_orders_customer ON guest_orders(tenant_id, customer_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(tenant_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(tenant_id, at DESC);
    CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations(tenant_id, date, time);
    CREATE INDEX IF NOT EXISTS idx_waitlist_status ON waitlist(tenant_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_reservations_customer ON reservations(tenant_id, customer_id, date);
    CREATE INDEX IF NOT EXISTS idx_delivery_orders_created ON delivery_orders(tenant_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_delivery_orders_status ON delivery_orders(tenant_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_tenant_order ON order_items(tenant_id, order_id);
    CREATE INDEX IF NOT EXISTS idx_orders_table ON orders(tenant_id, table_no, billed_at);
    CREATE INDEX IF NOT EXISTS idx_product_media_product ON product_media(product_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_vouchers_receipt ON vouchers(sold_receipt_id);
    CREATE INDEX IF NOT EXISTS idx_pos_sessions_staff ON pos_sessions(staff_id);
    CREATE INDEX IF NOT EXISTS idx_account_sessions_account ON account_sessions(account_id);
    CREATE INDEX IF NOT EXISTS idx_customer_sessions_customer ON customer_sessions(customer_id);
    CREATE INDEX IF NOT EXISTS idx_service_requests_table ON service_requests(tenant_id, table_no, status);
    CREATE INDEX IF NOT EXISTS idx_reservations_table ON reservations(tenant_id, table_no);
    CREATE INDEX IF NOT EXISTS idx_order_item_voids_order ON order_item_voids(order_id);
    CREATE INDEX IF NOT EXISTS idx_staff_settlements_staff ON staff_settlements(staff_id);
    CREATE INDEX IF NOT EXISTS idx_print_jobs_order ON print_jobs(order_id);
    CREATE INDEX IF NOT EXISTS idx_printer_status_bridge ON printer_status(bridge_id);
    CREATE INDEX IF NOT EXISTS idx_email_codes_email ON email_codes(tenant_id, email);
    CREATE INDEX IF NOT EXISTS idx_tenant_tokens_tenant ON tenant_tokens(tenant_id, role);
  `;
  // The tables first: on a database from before tenants the indexes name
  // columns that do not exist yet, so they are created only after the
  // migration below has added them.
  const indexesAt = SCHEMA_SQL.indexOf("\n    CREATE INDEX IF NOT EXISTS idx_products_catalog");
  db.exec(SCHEMA_SQL.slice(0, indexesAt));
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
    "ALTER TABLE products ADD COLUMN bundle_items_json TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE products ADD COLUMN tag_color TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE products ADD COLUMN print_printer_id TEXT NOT NULL DEFAULT ''"
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

  // A database from before tenants gets them: the default tenant, its name
  // from the settings, and every row moved under it. A database already on
  // the new schema is untouched — each step checks before it writes.
  migrateToMultiTenant(db, SCHEMA_SQL);
  db.exec(SCHEMA_SQL.slice(indexesAt));

  const driver = sqliteDriver(db);
  seed(driver.sync, db);
  return { ...createStore(driver, { passwordViewKey }), close: () => db.close() };
}

/**
 * Tenants, on a database that predates them (migrations/0112 does the same
 * for a deployed D1; this is the Node server's equivalent, run on start).
 *
 * The shape of a rebuilt table is read out of SCHEMA_SQL — the definition
 * the server itself declares — so a rebuild cannot drift from a fresh
 * database: the new table is the old rows under the new definition, with
 * every row's tenant the default one, and its indexes recreated from the
 * same string. A table that already carries tenant_id is left alone, so
 * this is safe to run on every start.
 *
 * Two tables are special-cased, because tenant_id is not their second
 * column: restaurant_settings becomes one row per tenant, and app_settings
 * one row per tenant per key. Everything else rebuilds generically: the new
 * column sits after the first, and the rows move across with 't_default'.
 */
function migrateToMultiTenant(db, schemaSql) {
  const columnsOf = (table) => db.prepare("SELECT name FROM pragma_table_info(?)").all(table).map((row) => row.name);
  const hasTenant = (table) => columnsOf(table).includes("tenant_id");
  const timestamp = now();

  // The default tenant's name is the restaurant's own, while it is still
  // readable from the settings it was kept under.
  let tenantName = "Chiri";
  try {
    const stored = db.prepare("SELECT value FROM app_settings WHERE key = 'restaurant_name'").get();
    const name = parseJson(stored?.value, "");
    if (typeof name === "string" && name.trim()) tenantName = name.trim().slice(0, 40);
  } catch {
    // No settings yet: the default name stands.
  }
  db.prepare(
    `INSERT INTO tenants (id, slug, name, status, config_json, created_at, updated_at)
     SELECT ?, ?, ?, 'active', '{}', ?, ? WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE id = ?)`
  ).run(DEFAULT_TENANT_ID, "default", tenantName, timestamp, timestamp, DEFAULT_TENANT_ID);

  const foreignKeys = db.prepare("PRAGMA foreign_keys").get().foreign_keys;
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    // A table whose keys change with the tenant, or whose columns move to
    // make room for it, is rebuilt under the new definition, its rows
    // carried across. The definition is the server's own (SCHEMA_SQL), and
    // the indexes come back from the same string — so a rebuilt table reads
    // exactly as a fresh one does. The final table is created under its own
    // name, not renamed into it: a rename rewrites the stored definition
    // with the name quoted, and the two would no longer match.
    const createOf = (table) => {
      const found = schemaSql.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n    \\);`));
      if (!found) throw new Error(`No CREATE TABLE for ${table} in the schema`);
      return found[0];
    };
    const indexesOf = (table) => {
      const found = [];
      for (const match of schemaSql.matchAll(/CREATE (UNIQUE )?INDEX IF NOT EXISTS (\w+) ON (\w+)[^;]*;/g)) {
        if (match[3] === table) found.push(match[0]);
      }
      return found;
    };
    const rebuild = (table) => {
      if (hasTenant(table)) return;
      const oldColumns = columnsOf(table);
      const create = createOf(table);
      const temp = `${table}__tenant_new`;
      db.exec(create.replace(`CREATE TABLE IF NOT EXISTS ${table} (`, `CREATE TABLE IF NOT EXISTS ${temp} (`));
      const newColumns = [oldColumns[0], "tenant_id", ...oldColumns.slice(1)];
      const selectList = [oldColumns[0], "'t_default'", ...oldColumns.slice(1)].join(", ");
      db.exec(`INSERT INTO ${temp} (${newColumns.join(", ")}) SELECT ${selectList} FROM ${table}`);
      db.exec(`DROP TABLE ${table}`);
      db.exec(create);
      db.exec(`INSERT INTO ${table} (${newColumns.join(", ")}) SELECT ${newColumns.join(", ")} FROM ${temp}`);
      db.exec(`DROP TABLE ${temp}`);
      for (const index of indexesOf(table)) db.exec(index);
    };
    for (const table of [
      "accounts", "account_sessions", "products", "product_media", "orders", "order_items",
      "order_item_vat_splits", "order_item_notes", "order_item_holds",
      "receipts", "receipt_items", "day_closings", "pos_devices", "staff",
      "pos_sessions", "table_claims", "table_claim_meta", "order_staff",
      "order_item_voids", "staff_settlements", "journal", "service_requests",
      "audit_log", "restaurant_tables", "printer_profiles", "print_jobs",
      "print_bridges", "printer_status", "discovered_printers", "reservations",
      "reservation_reminders", "waitlist", "delivery_orders", "product_stock",
      "vouchers", "email_codes", "customer_verified_emails", "mail_outbox",
      "drawer_sessions", "drawer_movements", "customers", "customer_sessions",
      "customer_favorites", "points_ledger", "guest_orders", "table_sessions",
      "member_balances", "balance_ledger", "balance_operators",
      "member_birthdays", "birthday_greetings", "media_files"
    ]) rebuild(table);
    // The first account registered is the platform's owner; any other
    // account there already keeps administering the default tenant.
    db.exec(`UPDATE accounts SET role = 'owner' WHERE id = (SELECT id FROM accounts ORDER BY created_at, id LIMIT 1)`);

    // The settings, one row per tenant rather than one row in all. The
    // final tables are created under their own names from the server's own
    // definitions, never renamed into them (see rebuild, above).
    if (!hasTenant("restaurant_settings")) {
      db.exec(`CREATE TABLE IF NOT EXISTS restaurant_settings__tenant_new (
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      menu_theme TEXT NOT NULL DEFAULT 'jade',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id)
    );`);
      db.exec(`INSERT INTO restaurant_settings__tenant_new (tenant_id, menu_theme, updated_at)
               SELECT 't_default', menu_theme, updated_at FROM restaurant_settings`);
      db.exec("DROP TABLE restaurant_settings");
      db.exec(createOf("restaurant_settings"));
      db.exec(`INSERT INTO restaurant_settings (tenant_id, menu_theme, updated_at)
               SELECT tenant_id, menu_theme, updated_at FROM restaurant_settings__tenant_new`);
      db.exec("DROP TABLE restaurant_settings__tenant_new");
    }
    if (!hasTenant("app_settings")) {
      db.exec(`CREATE TABLE IF NOT EXISTS app_settings__tenant_new (
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, key)
    );`);
      db.exec(`INSERT INTO app_settings__tenant_new (tenant_id, key, value, updated_at)
               SELECT 't_default', key, value, updated_at FROM app_settings`);
      db.exec("DROP TABLE app_settings");
      db.exec(createOf("app_settings"));
      db.exec(`INSERT INTO app_settings (tenant_id, key, value, updated_at)
               SELECT tenant_id, key, value, updated_at FROM app_settings__tenant_new`);
      db.exec("DROP TABLE app_settings__tenant_new");
    }
  } finally {
    db.exec(`PRAGMA foreign_keys = ${foreignKeys ? "ON" : "OFF"}`);
  }
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
  const existing = sql.all("SELECT sku FROM products WHERE tenant_id = ?", DEFAULT_TENANT_ID);
  const isLegacyDemoCatalog = existing.length > 0 && existing.length <= 15 && existing.every((row) => row.sku.startsWith("FOOD-"));
  if (isLegacyDemoCatalog) db.exec("DELETE FROM products WHERE tenant_id = 't_default'");
  if (sql.get("SELECT COUNT(*) AS count FROM products WHERE tenant_id = ?", DEFAULT_TENANT_ID).count) {
    // The category tidy (migrations/0111_category_cleanup.sql): a database
    // seeded before it still carries CHIRI ROLLS and TEA. Only rows still
    // under the old names move — a category the owner renamed stays renamed.
    sql.run("UPDATE products SET category = 'URAMAKI ROLLS', updated_at = ? WHERE tenant_id = ? AND category = 'CHIRI ROLLS'", now(), DEFAULT_TENANT_ID);
    sql.run("UPDATE products SET category = 'NON-ALCOHOLIC', updated_at = ? WHERE tenant_id = ? AND category = 'TEA'", now(), DEFAULT_TENANT_ID);
    // A catalogue from before the dishes had options gets them.
    const ramen = sql.get("SELECT * FROM products WHERE tenant_id = ? AND sku = ?", DEFAULT_TENANT_ID, "R1");
    if (ramen && !parseJson(ramen.modifiers_json, []).length) {
      for (const dish of photoMenuDishes) {
        const current = sql.get("SELECT * FROM products WHERE tenant_id = ? AND sku = ?", DEFAULT_TENANT_ID, dish.sku);
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
    published: dish.published !== false,
    printStation: dish.station || (dish.kind === "drink" ? "bar" : dish.kind === "sushi" ? "sushi" : "kitchen")
  })));
}

/** The starting set menus, once: the marker, not the products, records that it happened. */
function seedSetMenus(sql, db) {
  if (sql.get("SELECT 1 AS done FROM app_settings WHERE tenant_id = ? AND key = ?", DEFAULT_TENANT_ID, SET_MENU_SEED_KEY)) return;
  transaction(db, () => {
    const dishes = sql.all("SELECT * FROM products WHERE tenant_id = ? ORDER BY sort_order, created_at", DEFAULT_TENANT_ID).map((row) => mapProduct(row, []));
    for (const set of setMenuProducts(dishes)) {
      if (!sql.get("SELECT id FROM products WHERE tenant_id = ? AND (id = ? OR sku = ?)", DEFAULT_TENANT_ID, set.id, set.sku)) insertProduct(sql, set);
    }
    sql.run("INSERT INTO app_settings (tenant_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", DEFAULT_TENANT_ID, SET_MENU_SEED_KEY, "true", now());
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
      sql.run("INSERT INTO media_files (id, tenant_id, content_type, bytes, credit, source_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", photo.fileId, DEFAULT_TENANT_ID, photo.contentType, photo.bytes, photo.credit, photo.sourceUrl, now());
      // A new photo for a dish still showing the one seeded before takes its
      // place; a photo the owner uploaded is not a seeded one and stays.
      const seeded = sql.get("SELECT id FROM product_media WHERE tenant_id = ? AND product_id = ? AND id LIKE 'seed-%'", DEFAULT_TENANT_ID, photo.productId);
      if (seeded) {
        sql.run("UPDATE product_media SET url = ? WHERE id = ?", `/media/${photo.fileId}`, seeded.id);
        continue;
      }
      if (sql.get("SELECT id FROM products WHERE tenant_id = ? AND id = ?", DEFAULT_TENANT_ID, photo.productId) && !sql.get("SELECT COUNT(*) AS count FROM product_media WHERE tenant_id = ? AND product_id = ?", DEFAULT_TENANT_ID, photo.productId).count) {
        sql.run("INSERT INTO product_media (id, tenant_id, product_id, type, url, poster_url, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", `seed-${photo.fileId}`, DEFAULT_TENANT_ID, photo.productId, "image", `/media/${photo.fileId}`, null, 0, now());
      }
    }
  });
}

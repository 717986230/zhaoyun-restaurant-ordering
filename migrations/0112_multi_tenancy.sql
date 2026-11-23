-- 0112_multi_tenancy.sql — tenants, on a D1 deployed before them.
--
-- Mirrors server/database.mjs's migrateToMultiTenant (the Node server's
-- equivalent, run on start): every tenant table is rebuilt under the new
-- definition, its rows carried across under the default tenant, and the
-- three new tables are created. A database built from today's 0001
-- already has all of this, so this file is a no-op there: the rebuilds
-- copy rows that are already the default tenant's, and every CREATE
-- carries IF NOT EXISTS.
--
-- Wrangler applies each migration once. The rebuild creates the final
-- table under its own name, never a rename: a rename rewrites the stored
-- definition with the table name quoted, and the result would no longer
-- read as the fresh database does.

PRAGMA foreign_keys = OFF;

-- tenants: new with tenants.
CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
      config_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

-- tenant_tokens: new with tenants.
CREATE TABLE IF NOT EXISTS tenant_tokens (
      token_hash TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      role TEXT NOT NULL CHECK (role IN ('kitchen', 'staff', 'manager')),
      created_at TEXT NOT NULL
    );

-- account_tokens: new with tenants.
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

-- The default tenant takes the restaurant's own name, while it is still
-- readable from the settings it was kept under (a JSON string, so the
-- surrounding quotes come off).
INSERT INTO tenants (id, slug, name, status, config_json, created_at, updated_at)
SELECT 't_default', 'default',
  COALESCE(NULLIF(TRIM((SELECT value FROM app_settings WHERE key = 'restaurant_name'), '"'), ''), 'Chiri'),
  'active', '{}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE id = 't_default');

-- accounts: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS accounts__tenant_new (
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
INSERT INTO accounts__tenant_new (id, tenant_id, login, name, password_hash, password_salt, password_iterations, created_at, updated_at) SELECT id, 't_default', login, name, password_hash, password_salt, password_iterations, created_at, updated_at FROM accounts;
DROP TABLE accounts;
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
INSERT INTO accounts (id, tenant_id, login, name, password_hash, password_salt, password_iterations, created_at, updated_at) SELECT id, tenant_id, login, name, password_hash, password_salt, password_iterations, created_at, updated_at FROM accounts__tenant_new;
DROP TABLE accounts__tenant_new;

-- account_sessions: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS account_sessions__tenant_new (
      token_hash TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
INSERT INTO account_sessions__tenant_new (token_hash, tenant_id, account_id, expires_at, created_at) SELECT token_hash, 't_default', account_id, expires_at, created_at FROM account_sessions;
DROP TABLE account_sessions;
CREATE TABLE IF NOT EXISTS account_sessions (
      token_hash TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
INSERT INTO account_sessions (token_hash, tenant_id, account_id, expires_at, created_at) SELECT token_hash, tenant_id, account_id, expires_at, created_at FROM account_sessions__tenant_new;
DROP TABLE account_sessions__tenant_new;

-- products: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS products__tenant_new (
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
INSERT INTO products__tenant_new (id, tenant_id, sku, kind, category, name_zh, name_de, name_en, description, price_cents, allergens_json, prep_time, portion, level, ingredients, art, pattern, tag_color, available, published, sort_order, print_station, print_printer_id, modifiers_json, vat_percent, bundle_items_json, created_at, updated_at) SELECT id, 't_default', sku, kind, category, name_zh, name_de, name_en, description, price_cents, allergens_json, prep_time, portion, level, ingredients, art, pattern, tag_color, available, published, sort_order, print_station, print_printer_id, modifiers_json, vat_percent, bundle_items_json, created_at, updated_at FROM products;
DROP TABLE products;
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
INSERT INTO products (id, tenant_id, sku, kind, category, name_zh, name_de, name_en, description, price_cents, allergens_json, prep_time, portion, level, ingredients, art, pattern, tag_color, available, published, sort_order, print_station, print_printer_id, modifiers_json, vat_percent, bundle_items_json, created_at, updated_at) SELECT id, tenant_id, sku, kind, category, name_zh, name_de, name_en, description, price_cents, allergens_json, prep_time, portion, level, ingredients, art, pattern, tag_color, available, published, sort_order, print_station, print_printer_id, modifiers_json, vat_percent, bundle_items_json, created_at, updated_at FROM products__tenant_new;
DROP TABLE products__tenant_new;

-- product_media: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS product_media__tenant_new (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('image','video')),
      url TEXT NOT NULL,
      poster_url TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
INSERT INTO product_media__tenant_new (id, tenant_id, product_id, type, url, poster_url, sort_order, created_at) SELECT id, 't_default', product_id, type, url, poster_url, sort_order, created_at FROM product_media;
DROP TABLE product_media;
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
INSERT INTO product_media (id, tenant_id, product_id, type, url, poster_url, sort_order, created_at) SELECT id, tenant_id, product_id, type, url, poster_url, sort_order, created_at FROM product_media__tenant_new;
DROP TABLE product_media__tenant_new;

-- orders: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS orders__tenant_new (
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
INSERT INTO orders__tenant_new (id, tenant_id, order_no, client_request_id, table_no, status, note, total_cents, billed_at, created_at, updated_at) SELECT id, 't_default', order_no, client_request_id, table_no, status, note, total_cents, billed_at, created_at, updated_at FROM orders;
DROP TABLE orders;
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
INSERT INTO orders (id, tenant_id, order_no, client_request_id, table_no, status, note, total_cents, billed_at, created_at, updated_at) SELECT id, tenant_id, order_no, client_request_id, table_no, status, note, total_cents, billed_at, created_at, updated_at FROM orders__tenant_new;
DROP TABLE orders__tenant_new;

-- order_items: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS order_items__tenant_new (
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
INSERT INTO order_items__tenant_new (id, tenant_id, order_id, product_id, product_name, quantity, unit_price_cents, print_station, modifiers_json, vat_percent) SELECT id, 't_default', order_id, product_id, product_name, quantity, unit_price_cents, print_station, modifiers_json, vat_percent FROM order_items;
DROP TABLE order_items;
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
INSERT INTO order_items (id, tenant_id, order_id, product_id, product_name, quantity, unit_price_cents, print_station, modifiers_json, vat_percent) SELECT id, tenant_id, order_id, product_id, product_name, quantity, unit_price_cents, print_station, modifiers_json, vat_percent FROM order_items__tenant_new;
DROP TABLE order_items__tenant_new;

-- order_item_vat_splits: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS order_item_vat_splits__tenant_new (
      order_item_id TEXT PRIMARY KEY REFERENCES order_items(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      split_json TEXT NOT NULL
    );
INSERT INTO order_item_vat_splits__tenant_new (order_item_id, tenant_id, split_json) SELECT order_item_id, 't_default', split_json FROM order_item_vat_splits;
DROP TABLE order_item_vat_splits;
CREATE TABLE IF NOT EXISTS order_item_vat_splits (
      order_item_id TEXT PRIMARY KEY REFERENCES order_items(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      split_json TEXT NOT NULL
    );
INSERT INTO order_item_vat_splits (order_item_id, tenant_id, split_json) SELECT order_item_id, tenant_id, split_json FROM order_item_vat_splits__tenant_new;
DROP TABLE order_item_vat_splits__tenant_new;

-- order_item_notes: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS order_item_notes__tenant_new (
      order_item_id TEXT PRIMARY KEY REFERENCES order_items(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      note TEXT NOT NULL
    );
INSERT INTO order_item_notes__tenant_new (order_item_id, tenant_id, note) SELECT order_item_id, 't_default', note FROM order_item_notes;
DROP TABLE order_item_notes;
CREATE TABLE IF NOT EXISTS order_item_notes (
      order_item_id TEXT PRIMARY KEY REFERENCES order_items(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      note TEXT NOT NULL
    );
INSERT INTO order_item_notes (order_item_id, tenant_id, note) SELECT order_item_id, tenant_id, note FROM order_item_notes__tenant_new;
DROP TABLE order_item_notes__tenant_new;

-- order_item_holds: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS order_item_holds__tenant_new (
      order_item_id TEXT PRIMARY KEY REFERENCES order_items(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      held_at TEXT NOT NULL
    );
INSERT INTO order_item_holds__tenant_new (order_item_id, tenant_id, held_at) SELECT order_item_id, 't_default', held_at FROM order_item_holds;
DROP TABLE order_item_holds;
CREATE TABLE IF NOT EXISTS order_item_holds (
      order_item_id TEXT PRIMARY KEY REFERENCES order_items(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      held_at TEXT NOT NULL
    );
INSERT INTO order_item_holds (order_item_id, tenant_id, held_at) SELECT order_item_id, tenant_id, held_at FROM order_item_holds__tenant_new;
DROP TABLE order_item_holds__tenant_new;

-- receipts: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS receipts__tenant_new (
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
INSERT INTO receipts__tenant_new (id, tenant_id, receipt_no, client_request_id, cash_register_id, type, table_no, lines_json, vat_json, total_cents, payments_json, refers_to, reason, staff_role, fiscal_status, fiscal_json, created_at, staff_id, staff_name) SELECT id, 't_default', receipt_no, client_request_id, cash_register_id, type, table_no, lines_json, vat_json, total_cents, payments_json, refers_to, reason, staff_role, fiscal_status, fiscal_json, created_at, staff_id, staff_name FROM receipts;
DROP TABLE receipts;
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
INSERT INTO receipts (id, tenant_id, receipt_no, client_request_id, cash_register_id, type, table_no, lines_json, vat_json, total_cents, payments_json, refers_to, reason, staff_role, fiscal_status, fiscal_json, created_at, staff_id, staff_name) SELECT id, tenant_id, receipt_no, client_request_id, cash_register_id, type, table_no, lines_json, vat_json, total_cents, payments_json, refers_to, reason, staff_role, fiscal_status, fiscal_json, created_at, staff_id, staff_name FROM receipts__tenant_new;
DROP TABLE receipts__tenant_new;

-- receipt_items: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS receipt_items__tenant_new (
      receipt_id TEXT NOT NULL REFERENCES receipts(id),
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      order_item_id TEXT NOT NULL REFERENCES order_items(id),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      PRIMARY KEY (receipt_id, order_item_id)
    );
INSERT INTO receipt_items__tenant_new (receipt_id, tenant_id, order_item_id, quantity) SELECT receipt_id, 't_default', order_item_id, quantity FROM receipt_items;
DROP TABLE receipt_items;
CREATE TABLE IF NOT EXISTS receipt_items (
      receipt_id TEXT NOT NULL REFERENCES receipts(id),
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      order_item_id TEXT NOT NULL REFERENCES order_items(id),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      PRIMARY KEY (receipt_id, order_item_id)
    );
INSERT INTO receipt_items (receipt_id, tenant_id, order_item_id, quantity) SELECT receipt_id, tenant_id, order_item_id, quantity FROM receipt_items__tenant_new;
DROP TABLE receipt_items__tenant_new;

-- day_closings: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS day_closings__tenant_new (
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
INSERT INTO day_closings__tenant_new (id, tenant_id, closing_no, first_receipt_no, last_receipt_no, totals_json, staff_role, created_at) SELECT id, 't_default', closing_no, first_receipt_no, last_receipt_no, totals_json, staff_role, created_at FROM day_closings;
DROP TABLE day_closings;
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
INSERT INTO day_closings (id, tenant_id, closing_no, first_receipt_no, last_receipt_no, totals_json, staff_role, created_at) SELECT id, tenant_id, closing_no, first_receipt_no, last_receipt_no, totals_json, staff_role, created_at FROM day_closings__tenant_new;
DROP TABLE day_closings__tenant_new;

-- pos_devices: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS pos_devices__tenant_new (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      last_seen_at TEXT
    );
INSERT INTO pos_devices__tenant_new (id, tenant_id, name, token_hash, created_at, last_seen_at) SELECT id, 't_default', name, token_hash, created_at, last_seen_at FROM pos_devices;
DROP TABLE pos_devices;
CREATE TABLE IF NOT EXISTS pos_devices (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      last_seen_at TEXT
    );
INSERT INTO pos_devices (id, tenant_id, name, token_hash, created_at, last_seen_at) SELECT id, tenant_id, name, token_hash, created_at, last_seen_at FROM pos_devices__tenant_new;
DROP TABLE pos_devices__tenant_new;

-- staff: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS staff__tenant_new (
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
INSERT INTO staff__tenant_new (id, tenant_id, name, role, pin_hash, pin_salt, pin_iterations, active, created_at, updated_at) SELECT id, 't_default', name, role, pin_hash, pin_salt, pin_iterations, active, created_at, updated_at FROM staff;
DROP TABLE staff;
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
INSERT INTO staff (id, tenant_id, name, role, pin_hash, pin_salt, pin_iterations, active, created_at, updated_at) SELECT id, tenant_id, name, role, pin_hash, pin_salt, pin_iterations, active, created_at, updated_at FROM staff__tenant_new;
DROP TABLE staff__tenant_new;

-- pos_sessions: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS pos_sessions__tenant_new (
      token_hash TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL REFERENCES pos_devices(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
INSERT INTO pos_sessions__tenant_new (token_hash, tenant_id, staff_id, device_id, expires_at, created_at) SELECT token_hash, 't_default', staff_id, device_id, expires_at, created_at FROM pos_sessions;
DROP TABLE pos_sessions;
CREATE TABLE IF NOT EXISTS pos_sessions (
      token_hash TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL REFERENCES pos_devices(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
INSERT INTO pos_sessions (token_hash, tenant_id, staff_id, device_id, expires_at, created_at) SELECT token_hash, tenant_id, staff_id, device_id, expires_at, created_at FROM pos_sessions__tenant_new;
DROP TABLE pos_sessions__tenant_new;

-- table_claims: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS table_claims__tenant_new (
      table_no TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      device_id TEXT NOT NULL,
      staff_id TEXT,
      staff_name TEXT,
      expires_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, table_no)
    );
INSERT INTO table_claims__tenant_new (table_no, tenant_id, device_id, staff_id, staff_name, expires_at) SELECT table_no, 't_default', device_id, staff_id, staff_name, expires_at FROM table_claims;
DROP TABLE table_claims;
CREATE TABLE IF NOT EXISTS table_claims (
      table_no TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      device_id TEXT NOT NULL,
      staff_id TEXT,
      staff_name TEXT,
      expires_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, table_no)
    );
INSERT INTO table_claims (table_no, tenant_id, device_id, staff_id, staff_name, expires_at) SELECT table_no, tenant_id, device_id, staff_id, staff_name, expires_at FROM table_claims__tenant_new;
DROP TABLE table_claims__tenant_new;

-- table_claim_meta: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS table_claim_meta__tenant_new (
      table_no TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      shared INTEGER NOT NULL DEFAULT 0,
      epoch INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (tenant_id, table_no)
    );
INSERT INTO table_claim_meta__tenant_new (table_no, tenant_id, shared, epoch, updated_at) SELECT table_no, 't_default', shared, epoch, updated_at FROM table_claim_meta;
DROP TABLE table_claim_meta;
CREATE TABLE IF NOT EXISTS table_claim_meta (
      table_no TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      shared INTEGER NOT NULL DEFAULT 0,
      epoch INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (tenant_id, table_no)
    );
INSERT INTO table_claim_meta (table_no, tenant_id, shared, epoch, updated_at) SELECT table_no, tenant_id, shared, epoch, updated_at FROM table_claim_meta__tenant_new;
DROP TABLE table_claim_meta__tenant_new;

-- order_staff: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS order_staff__tenant_new (
      order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      staff_id TEXT,
      staff_name TEXT,
      pickup_no INTEGER,
      created_at TEXT NOT NULL
    );
INSERT INTO order_staff__tenant_new (order_id, tenant_id, staff_id, staff_name, pickup_no, created_at) SELECT order_id, 't_default', staff_id, staff_name, pickup_no, created_at FROM order_staff;
DROP TABLE order_staff;
CREATE TABLE IF NOT EXISTS order_staff (
      order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      staff_id TEXT,
      staff_name TEXT,
      pickup_no INTEGER,
      created_at TEXT NOT NULL
    );
INSERT INTO order_staff (order_id, tenant_id, staff_id, staff_name, pickup_no, created_at) SELECT order_id, tenant_id, staff_id, staff_name, pickup_no, created_at FROM order_staff__tenant_new;
DROP TABLE order_staff__tenant_new;

-- order_item_voids: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS order_item_voids__tenant_new (
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
INSERT INTO order_item_voids__tenant_new (id, tenant_id, order_item_id, order_id, table_no, quantity, amount_cents, reason, staff_id, staff_name, created_at) SELECT id, 't_default', order_item_id, order_id, table_no, quantity, amount_cents, reason, staff_id, staff_name, created_at FROM order_item_voids;
DROP TABLE order_item_voids;
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
INSERT INTO order_item_voids (id, tenant_id, order_item_id, order_id, table_no, quantity, amount_cents, reason, staff_id, staff_name, created_at) SELECT id, tenant_id, order_item_id, order_id, table_no, quantity, amount_cents, reason, staff_id, staff_name, created_at FROM order_item_voids__tenant_new;
DROP TABLE order_item_voids__tenant_new;

-- staff_settlements: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS staff_settlements__tenant_new (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      staff_id TEXT NOT NULL,
      staff_name TEXT NOT NULL,
      last_receipt_no INTEGER NOT NULL,
      totals_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
INSERT INTO staff_settlements__tenant_new (id, tenant_id, staff_id, staff_name, last_receipt_no, totals_json, created_at) SELECT id, 't_default', staff_id, staff_name, last_receipt_no, totals_json, created_at FROM staff_settlements;
DROP TABLE staff_settlements;
CREATE TABLE IF NOT EXISTS staff_settlements (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      staff_id TEXT NOT NULL,
      staff_name TEXT NOT NULL,
      last_receipt_no INTEGER NOT NULL,
      totals_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
INSERT INTO staff_settlements (id, tenant_id, staff_id, staff_name, last_receipt_no, totals_json, created_at) SELECT id, tenant_id, staff_id, staff_name, last_receipt_no, totals_json, created_at FROM staff_settlements__tenant_new;
DROP TABLE staff_settlements__tenant_new;

-- journal: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS journal__tenant_new (
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
INSERT INTO journal__tenant_new (seq, tenant_id, at, kind, ref, payload_json, prev_hash, hash) SELECT seq, 't_default', at, kind, ref, payload_json, prev_hash, hash FROM journal;
DROP TABLE journal;
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
INSERT INTO journal (seq, tenant_id, at, kind, ref, payload_json, prev_hash, hash) SELECT seq, tenant_id, at, kind, ref, payload_json, prev_hash, hash FROM journal__tenant_new;
DROP TABLE journal__tenant_new;

-- service_requests: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS service_requests__tenant_new (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      table_no TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
INSERT INTO service_requests__tenant_new (id, tenant_id, table_no, type, status, created_at, updated_at) SELECT id, 't_default', table_no, type, status, created_at, updated_at FROM service_requests;
DROP TABLE service_requests;
CREATE TABLE IF NOT EXISTS service_requests (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      table_no TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
INSERT INTO service_requests (id, tenant_id, table_no, type, status, created_at, updated_at) SELECT id, tenant_id, table_no, type, status, created_at, updated_at FROM service_requests__tenant_new;
DROP TABLE service_requests__tenant_new;

-- audit_log: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS audit_log__tenant_new (
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
INSERT INTO audit_log__tenant_new (id, tenant_id, at, role, ip, method, route, status, detail_json) SELECT id, 't_default', at, role, ip, method, route, status, detail_json FROM audit_log;
DROP TABLE audit_log;
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
INSERT INTO audit_log (id, tenant_id, at, role, ip, method, route, status, detail_json) SELECT id, tenant_id, at, role, ip, method, route, status, detail_json FROM audit_log__tenant_new;
DROP TABLE audit_log__tenant_new;

-- restaurant_tables: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS restaurant_tables__tenant_new (
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
INSERT INTO restaurant_tables__tenant_new (table_no, tenant_id, label, token, enabled, locked_at, created_at, updated_at) SELECT table_no, 't_default', label, token, enabled, locked_at, created_at, updated_at FROM restaurant_tables;
DROP TABLE restaurant_tables;
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
INSERT INTO restaurant_tables (table_no, tenant_id, label, token, enabled, locked_at, created_at, updated_at) SELECT table_no, tenant_id, label, token, enabled, locked_at, created_at, updated_at FROM restaurant_tables__tenant_new;
DROP TABLE restaurant_tables__tenant_new;

-- printer_profiles: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS printer_profiles__tenant_new (
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
INSERT INTO printer_profiles__tenant_new (id, tenant_id, name, transport, address, port, role, enabled, capabilities_json, created_at, updated_at) SELECT id, 't_default', name, transport, address, port, role, enabled, capabilities_json, created_at, updated_at FROM printer_profiles;
DROP TABLE printer_profiles;
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
INSERT INTO printer_profiles (id, tenant_id, name, transport, address, port, role, enabled, capabilities_json, created_at, updated_at) SELECT id, tenant_id, name, transport, address, port, role, enabled, capabilities_json, created_at, updated_at FROM printer_profiles__tenant_new;
DROP TABLE printer_profiles__tenant_new;

-- print_jobs: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS print_jobs__tenant_new (
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
INSERT INTO print_jobs__tenant_new (id, tenant_id, order_id, printer_role, payload_json, status, attempts, error, claimed_by, lease_until, next_attempt_at, created_at, updated_at) SELECT id, 't_default', order_id, printer_role, payload_json, status, attempts, error, claimed_by, lease_until, next_attempt_at, created_at, updated_at FROM print_jobs;
DROP TABLE print_jobs;
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
INSERT INTO print_jobs (id, tenant_id, order_id, printer_role, payload_json, status, attempts, error, claimed_by, lease_until, next_attempt_at, created_at, updated_at) SELECT id, tenant_id, order_id, printer_role, payload_json, status, attempts, error, claimed_by, lease_until, next_attempt_at, created_at, updated_at FROM print_jobs__tenant_new;
DROP TABLE print_jobs__tenant_new;

-- print_bridges: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS print_bridges__tenant_new (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      name TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '',
      last_seen_at TEXT NOT NULL
    );
INSERT INTO print_bridges__tenant_new (id, tenant_id, name, version, last_seen_at) SELECT id, 't_default', name, version, last_seen_at FROM print_bridges;
DROP TABLE print_bridges;
CREATE TABLE IF NOT EXISTS print_bridges (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      name TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '',
      last_seen_at TEXT NOT NULL
    );
INSERT INTO print_bridges (id, tenant_id, name, version, last_seen_at) SELECT id, tenant_id, name, version, last_seen_at FROM print_bridges__tenant_new;
DROP TABLE print_bridges__tenant_new;

-- printer_status: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS printer_status__tenant_new (
      printer_id TEXT PRIMARY KEY REFERENCES printer_profiles(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      bridge_id TEXT NOT NULL,
      ok INTEGER NOT NULL,
      error TEXT,
      checked_at TEXT NOT NULL
    );
INSERT INTO printer_status__tenant_new (printer_id, tenant_id, bridge_id, ok, error, checked_at) SELECT printer_id, 't_default', bridge_id, ok, error, checked_at FROM printer_status;
DROP TABLE printer_status;
CREATE TABLE IF NOT EXISTS printer_status (
      printer_id TEXT PRIMARY KEY REFERENCES printer_profiles(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      bridge_id TEXT NOT NULL,
      ok INTEGER NOT NULL,
      error TEXT,
      checked_at TEXT NOT NULL
    );
INSERT INTO printer_status (printer_id, tenant_id, bridge_id, ok, error, checked_at) SELECT printer_id, tenant_id, bridge_id, ok, error, checked_at FROM printer_status__tenant_new;
DROP TABLE printer_status__tenant_new;

-- discovered_printers: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS discovered_printers__tenant_new (
      address TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      port INTEGER NOT NULL,
      escpos INTEGER NOT NULL DEFAULT 0,
      bridge_id TEXT NOT NULL,
      seen_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, address, port)
    );
INSERT INTO discovered_printers__tenant_new (address, tenant_id, port, escpos, bridge_id, seen_at) SELECT address, 't_default', port, escpos, bridge_id, seen_at FROM discovered_printers;
DROP TABLE discovered_printers;
CREATE TABLE IF NOT EXISTS discovered_printers (
      address TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      port INTEGER NOT NULL,
      escpos INTEGER NOT NULL DEFAULT 0,
      bridge_id TEXT NOT NULL,
      seen_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, address, port)
    );
INSERT INTO discovered_printers (address, tenant_id, port, escpos, bridge_id, seen_at) SELECT address, tenant_id, port, escpos, bridge_id, seen_at FROM discovered_printers__tenant_new;
DROP TABLE discovered_printers__tenant_new;

-- reservations: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS reservations__tenant_new (
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
INSERT INTO reservations__tenant_new (id, tenant_id, reference, token_hash, date, time, party, name, phone, email, notes, language, status, table_no, source, customer_id, created_at, updated_at) SELECT id, 't_default', reference, token_hash, date, time, party, name, phone, email, notes, language, status, table_no, source, customer_id, created_at, updated_at FROM reservations;
DROP TABLE reservations;
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
INSERT INTO reservations (id, tenant_id, reference, token_hash, date, time, party, name, phone, email, notes, language, status, table_no, source, customer_id, created_at, updated_at) SELECT id, tenant_id, reference, token_hash, date, time, party, name, phone, email, notes, language, status, table_no, source, customer_id, created_at, updated_at FROM reservations__tenant_new;
DROP TABLE reservations__tenant_new;

-- reservation_reminders: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS reservation_reminders__tenant_new (
      reservation_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      sent_at TEXT NOT NULL
    );
INSERT INTO reservation_reminders__tenant_new (reservation_id, tenant_id, sent_at) SELECT reservation_id, 't_default', sent_at FROM reservation_reminders;
DROP TABLE reservation_reminders;
CREATE TABLE IF NOT EXISTS reservation_reminders (
      reservation_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      sent_at TEXT NOT NULL
    );
INSERT INTO reservation_reminders (reservation_id, tenant_id, sent_at) SELECT reservation_id, tenant_id, sent_at FROM reservation_reminders__tenant_new;
DROP TABLE reservation_reminders__tenant_new;

-- waitlist: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS waitlist__tenant_new (
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
INSERT INTO waitlist__tenant_new (id, tenant_id, name, phone, email, party, notes, language, status, created_at, updated_at, notified_at) SELECT id, 't_default', name, phone, email, party, notes, language, status, created_at, updated_at, notified_at FROM waitlist;
DROP TABLE waitlist;
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
INSERT INTO waitlist (id, tenant_id, name, phone, email, party, notes, language, status, created_at, updated_at, notified_at) SELECT id, tenant_id, name, phone, email, party, notes, language, status, created_at, updated_at, notified_at FROM waitlist__tenant_new;
DROP TABLE waitlist__tenant_new;

-- delivery_orders: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS delivery_orders__tenant_new (
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
INSERT INTO delivery_orders__tenant_new (id, tenant_id, provider, external_id, reference, status, type, placed_at, due_at, customer_name, customer_phone, address, notes, items_json, total_cents, delivery_fee_cents, paid_online, test, prep_minutes, reject_reason, sync_status, sync_error, synced_at, created_at, updated_at) SELECT id, 't_default', provider, external_id, reference, status, type, placed_at, due_at, customer_name, customer_phone, address, notes, items_json, total_cents, delivery_fee_cents, paid_online, test, prep_minutes, reject_reason, sync_status, sync_error, synced_at, created_at, updated_at FROM delivery_orders;
DROP TABLE delivery_orders;
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
INSERT INTO delivery_orders (id, tenant_id, provider, external_id, reference, status, type, placed_at, due_at, customer_name, customer_phone, address, notes, items_json, total_cents, delivery_fee_cents, paid_online, test, prep_minutes, reject_reason, sync_status, sync_error, synced_at, created_at, updated_at) SELECT id, tenant_id, provider, external_id, reference, status, type, placed_at, due_at, customer_name, customer_phone, address, notes, items_json, total_cents, delivery_fee_cents, paid_online, test, prep_minutes, reject_reason, sync_status, sync_error, synced_at, created_at, updated_at FROM delivery_orders__tenant_new;
DROP TABLE delivery_orders__tenant_new;

-- product_stock: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS product_stock__tenant_new (
      product_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      daily_limit INTEGER,
      stock_day TEXT,
      stock_left INTEGER,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, product_id)
    );
INSERT INTO product_stock__tenant_new (product_id, tenant_id, daily_limit, stock_day, stock_left, updated_at) SELECT product_id, 't_default', daily_limit, stock_day, stock_left, updated_at FROM product_stock;
DROP TABLE product_stock;
CREATE TABLE IF NOT EXISTS product_stock (
      product_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      daily_limit INTEGER,
      stock_day TEXT,
      stock_left INTEGER,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, product_id)
    );
INSERT INTO product_stock (product_id, tenant_id, daily_limit, stock_day, stock_left, updated_at) SELECT product_id, tenant_id, daily_limit, stock_day, stock_left, updated_at FROM product_stock__tenant_new;
DROP TABLE product_stock__tenant_new;

-- vouchers: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS vouchers__tenant_new (
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
INSERT INTO vouchers__tenant_new (code, tenant_id, value_cents, balance_cents, sold_receipt_id, voided_at, created_at, updated_at) SELECT code, 't_default', value_cents, balance_cents, sold_receipt_id, voided_at, created_at, updated_at FROM vouchers;
DROP TABLE vouchers;
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
INSERT INTO vouchers (code, tenant_id, value_cents, balance_cents, sold_receipt_id, voided_at, created_at, updated_at) SELECT code, tenant_id, value_cents, balance_cents, sold_receipt_id, voided_at, created_at, updated_at FROM vouchers__tenant_new;
DROP TABLE vouchers__tenant_new;

-- email_codes: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS email_codes__tenant_new (
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
INSERT INTO email_codes__tenant_new (id, tenant_id, customer_id, email, code_hash, attempts, expires_at, used_at, created_at) SELECT id, 't_default', customer_id, email, code_hash, attempts, expires_at, used_at, created_at FROM email_codes;
DROP TABLE email_codes;
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
INSERT INTO email_codes (id, tenant_id, customer_id, email, code_hash, attempts, expires_at, used_at, created_at) SELECT id, tenant_id, customer_id, email, code_hash, attempts, expires_at, used_at, created_at FROM email_codes__tenant_new;
DROP TABLE email_codes__tenant_new;

-- customer_verified_emails: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS customer_verified_emails__tenant_new (
      customer_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      email TEXT NOT NULL,
      verified_at TEXT NOT NULL
    );
INSERT INTO customer_verified_emails__tenant_new (customer_id, tenant_id, email, verified_at) SELECT customer_id, 't_default', email, verified_at FROM customer_verified_emails;
DROP TABLE customer_verified_emails;
CREATE TABLE IF NOT EXISTS customer_verified_emails (
      customer_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      email TEXT NOT NULL,
      verified_at TEXT NOT NULL
    );
INSERT INTO customer_verified_emails (customer_id, tenant_id, email, verified_at) SELECT customer_id, tenant_id, email, verified_at FROM customer_verified_emails__tenant_new;
DROP TABLE customer_verified_emails__tenant_new;

-- mail_outbox: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS mail_outbox__tenant_new (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
INSERT INTO mail_outbox__tenant_new (id, tenant_id, to_email, subject, text, created_at) SELECT id, 't_default', to_email, subject, text, created_at FROM mail_outbox;
DROP TABLE mail_outbox;
CREATE TABLE IF NOT EXISTS mail_outbox (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
INSERT INTO mail_outbox (id, tenant_id, to_email, subject, text, created_at) SELECT id, tenant_id, to_email, subject, text, created_at FROM mail_outbox__tenant_new;
DROP TABLE mail_outbox__tenant_new;

-- drawer_sessions: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS drawer_sessions__tenant_new (
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
INSERT INTO drawer_sessions__tenant_new (id, tenant_id, open_flag, after_receipt_no, float_cents, opened_by, opened_at, closed_at, closed_by, last_receipt_no, counted_cents, counts_json, totals_json, note) SELECT id, 't_default', open_flag, after_receipt_no, float_cents, opened_by, opened_at, closed_at, closed_by, last_receipt_no, counted_cents, counts_json, totals_json, note FROM drawer_sessions;
DROP TABLE drawer_sessions;
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
INSERT INTO drawer_sessions (id, tenant_id, open_flag, after_receipt_no, float_cents, opened_by, opened_at, closed_at, closed_by, last_receipt_no, counted_cents, counts_json, totals_json, note) SELECT id, tenant_id, open_flag, after_receipt_no, float_cents, opened_by, opened_at, closed_at, closed_by, last_receipt_no, counted_cents, counts_json, totals_json, note FROM drawer_sessions__tenant_new;
DROP TABLE drawer_sessions__tenant_new;

-- drawer_movements: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS drawer_movements__tenant_new (
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
INSERT INTO drawer_movements__tenant_new (id, tenant_id, session_id, kind, amount_cents, reason, staff_id, staff_name, created_at) SELECT id, 't_default', session_id, kind, amount_cents, reason, staff_id, staff_name, created_at FROM drawer_movements;
DROP TABLE drawer_movements;
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
INSERT INTO drawer_movements (id, tenant_id, session_id, kind, amount_cents, reason, staff_id, staff_name, created_at) SELECT id, tenant_id, session_id, kind, amount_cents, reason, staff_id, staff_name, created_at FROM drawer_movements__tenant_new;
DROP TABLE drawer_movements__tenant_new;

-- customers: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS customers__tenant_new (
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
INSERT INTO customers__tenant_new (id, tenant_id, email, name, password_hash, password_salt, password_iterations, points, created_at, updated_at) SELECT id, 't_default', email, name, password_hash, password_salt, password_iterations, points, created_at, updated_at FROM customers;
DROP TABLE customers;
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
INSERT INTO customers (id, tenant_id, email, name, password_hash, password_salt, password_iterations, points, created_at, updated_at) SELECT id, tenant_id, email, name, password_hash, password_salt, password_iterations, points, created_at, updated_at FROM customers__tenant_new;
DROP TABLE customers__tenant_new;

-- customer_sessions: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS customer_sessions__tenant_new (
      token_hash TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
INSERT INTO customer_sessions__tenant_new (token_hash, tenant_id, customer_id, expires_at, created_at) SELECT token_hash, 't_default', customer_id, expires_at, created_at FROM customer_sessions;
DROP TABLE customer_sessions;
CREATE TABLE IF NOT EXISTS customer_sessions (
      token_hash TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
INSERT INTO customer_sessions (token_hash, tenant_id, customer_id, expires_at, created_at) SELECT token_hash, tenant_id, customer_id, expires_at, created_at FROM customer_sessions__tenant_new;
DROP TABLE customer_sessions__tenant_new;

-- customer_favorites: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS customer_favorites__tenant_new (
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      product_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (customer_id, product_id)
    );
INSERT INTO customer_favorites__tenant_new (customer_id, tenant_id, product_id, created_at) SELECT customer_id, 't_default', product_id, created_at FROM customer_favorites;
DROP TABLE customer_favorites;
CREATE TABLE IF NOT EXISTS customer_favorites (
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      product_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (customer_id, product_id)
    );
INSERT INTO customer_favorites (customer_id, tenant_id, product_id, created_at) SELECT customer_id, tenant_id, product_id, created_at FROM customer_favorites__tenant_new;
DROP TABLE customer_favorites__tenant_new;

-- points_ledger: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS points_ledger__tenant_new (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL CHECK (reason IN ('earn','reverse','redeem','refund','adjust')),
      ref TEXT,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
INSERT INTO points_ledger__tenant_new (id, tenant_id, customer_id, delta, reason, ref, note, created_at) SELECT id, 't_default', customer_id, delta, reason, ref, note, created_at FROM points_ledger;
DROP TABLE points_ledger;
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
INSERT INTO points_ledger (id, tenant_id, customer_id, delta, reason, ref, note, created_at) SELECT id, tenant_id, customer_id, delta, reason, ref, note, created_at FROM points_ledger__tenant_new;
DROP TABLE points_ledger__tenant_new;

-- guest_orders: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS guest_orders__tenant_new (
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
INSERT INTO guest_orders__tenant_new (order_id, tenant_id, customer_id, channel, table_no, pickup_no, payment, points_spent, created_at) SELECT order_id, 't_default', customer_id, channel, table_no, pickup_no, payment, points_spent, created_at FROM guest_orders;
DROP TABLE guest_orders;
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
INSERT INTO guest_orders (order_id, tenant_id, customer_id, channel, table_no, pickup_no, payment, points_spent, created_at) SELECT order_id, tenant_id, customer_id, channel, table_no, pickup_no, payment, points_spent, created_at FROM guest_orders__tenant_new;
DROP TABLE guest_orders__tenant_new;

-- table_sessions: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS table_sessions__tenant_new (
      table_no TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      opened_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      staff_name TEXT,
      PRIMARY KEY (tenant_id, table_no)
    );
INSERT INTO table_sessions__tenant_new (table_no, tenant_id, opened_at, expires_at, staff_name) SELECT table_no, 't_default', opened_at, expires_at, staff_name FROM table_sessions;
DROP TABLE table_sessions;
CREATE TABLE IF NOT EXISTS table_sessions (
      table_no TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      opened_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      staff_name TEXT,
      PRIMARY KEY (tenant_id, table_no)
    );
INSERT INTO table_sessions (table_no, tenant_id, opened_at, expires_at, staff_name) SELECT table_no, tenant_id, opened_at, expires_at, staff_name FROM table_sessions__tenant_new;
DROP TABLE table_sessions__tenant_new;

-- member_balances: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS member_balances__tenant_new (
      customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
      updated_at TEXT NOT NULL
    );
INSERT INTO member_balances__tenant_new (customer_id, tenant_id, balance_cents, updated_at) SELECT customer_id, 't_default', balance_cents, updated_at FROM member_balances;
DROP TABLE member_balances;
CREATE TABLE IF NOT EXISTS member_balances (
      customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
      updated_at TEXT NOT NULL
    );
INSERT INTO member_balances (customer_id, tenant_id, balance_cents, updated_at) SELECT customer_id, tenant_id, balance_cents, updated_at FROM member_balances__tenant_new;
DROP TABLE member_balances__tenant_new;

-- balance_ledger: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS balance_ledger__tenant_new (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      delta_cents INTEGER NOT NULL,
      reason TEXT NOT NULL CHECK (reason IN ('topup','bonus','spend','refund','adjust','reverse')),
      ref TEXT,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
INSERT INTO balance_ledger__tenant_new (id, tenant_id, customer_id, delta_cents, reason, ref, note, created_at) SELECT id, 't_default', customer_id, delta_cents, reason, ref, note, created_at FROM balance_ledger;
DROP TABLE balance_ledger;
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
INSERT INTO balance_ledger (id, tenant_id, customer_id, delta_cents, reason, ref, note, created_at) SELECT id, tenant_id, customer_id, delta_cents, reason, ref, note, created_at FROM balance_ledger__tenant_new;
DROP TABLE balance_ledger__tenant_new;

-- balance_operators: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS balance_operators__tenant_new (
      ledger_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      operator TEXT NOT NULL DEFAULT ''
    );
INSERT INTO balance_operators__tenant_new (ledger_id, tenant_id, operator) SELECT ledger_id, 't_default', operator FROM balance_operators;
DROP TABLE balance_operators;
CREATE TABLE IF NOT EXISTS balance_operators (
      ledger_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      operator TEXT NOT NULL DEFAULT ''
    );
INSERT INTO balance_operators (ledger_id, tenant_id, operator) SELECT ledger_id, tenant_id, operator FROM balance_operators__tenant_new;
DROP TABLE balance_operators__tenant_new;

-- member_birthdays: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS member_birthdays__tenant_new (
      customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
      day INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
      updated_at TEXT NOT NULL
    );
INSERT INTO member_birthdays__tenant_new (customer_id, tenant_id, month, day, updated_at) SELECT customer_id, 't_default', month, day, updated_at FROM member_birthdays;
DROP TABLE member_birthdays;
CREATE TABLE IF NOT EXISTS member_birthdays (
      customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
      day INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
      updated_at TEXT NOT NULL
    );
INSERT INTO member_birthdays (customer_id, tenant_id, month, day, updated_at) SELECT customer_id, tenant_id, month, day, updated_at FROM member_birthdays__tenant_new;
DROP TABLE member_birthdays__tenant_new;

-- birthday_greetings: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS birthday_greetings__tenant_new (
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      year INTEGER NOT NULL,
      sent_at TEXT NOT NULL,
      PRIMARY KEY (customer_id, year)
    );
INSERT INTO birthday_greetings__tenant_new (customer_id, tenant_id, year, sent_at) SELECT customer_id, 't_default', year, sent_at FROM birthday_greetings;
DROP TABLE birthday_greetings;
CREATE TABLE IF NOT EXISTS birthday_greetings (
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      year INTEGER NOT NULL,
      sent_at TEXT NOT NULL,
      PRIMARY KEY (customer_id, year)
    );
INSERT INTO birthday_greetings (customer_id, tenant_id, year, sent_at) SELECT customer_id, tenant_id, year, sent_at FROM birthday_greetings__tenant_new;
DROP TABLE birthday_greetings__tenant_new;

-- media_files: its keys change with the tenant, so it is rebuilt under
-- the new definition with its rows carried across.
CREATE TABLE IF NOT EXISTS media_files__tenant_new (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      content_type TEXT NOT NULL,
      bytes BLOB NOT NULL,
      credit TEXT,
      source_url TEXT,
      created_at TEXT NOT NULL
    );
INSERT INTO media_files__tenant_new (id, tenant_id, content_type, bytes, credit, source_url, created_at) SELECT id, 't_default', content_type, bytes, credit, source_url, created_at FROM media_files;
DROP TABLE media_files;
CREATE TABLE IF NOT EXISTS media_files (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 't_default' REFERENCES tenants(id),
      content_type TEXT NOT NULL,
      bytes BLOB NOT NULL,
      credit TEXT,
      source_url TEXT,
      created_at TEXT NOT NULL
    );
INSERT INTO media_files (id, tenant_id, content_type, bytes, credit, source_url, created_at) SELECT id, tenant_id, content_type, bytes, credit, source_url, created_at FROM media_files__tenant_new;
DROP TABLE media_files__tenant_new;

-- restaurant_settings: one row per tenant rather than one row in all.
CREATE TABLE IF NOT EXISTS restaurant_settings__tenant_new (
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      menu_theme TEXT NOT NULL DEFAULT 'jade',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id)
    );
INSERT INTO restaurant_settings__tenant_new (tenant_id, menu_theme, updated_at) SELECT 't_default', menu_theme, updated_at FROM restaurant_settings;
DROP TABLE restaurant_settings;
CREATE TABLE IF NOT EXISTS restaurant_settings (
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      menu_theme TEXT NOT NULL DEFAULT 'jade',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id)
    );
INSERT INTO restaurant_settings (tenant_id, menu_theme, updated_at) SELECT tenant_id, menu_theme, updated_at FROM restaurant_settings__tenant_new;
DROP TABLE restaurant_settings__tenant_new;

-- app_settings: one row per tenant rather than one row in all.
CREATE TABLE IF NOT EXISTS app_settings__tenant_new (
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, key)
    );
INSERT INTO app_settings__tenant_new (tenant_id, key, value, updated_at) SELECT 't_default', key, value, updated_at FROM app_settings;
DROP TABLE app_settings;
CREATE TABLE IF NOT EXISTS app_settings (
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, key)
    );
INSERT INTO app_settings (tenant_id, key, value, updated_at) SELECT tenant_id, key, value, updated_at FROM app_settings__tenant_new;
DROP TABLE app_settings__tenant_new;

-- The first account registered is the platform's owner; any other
-- account there already keeps administering the default tenant.
UPDATE accounts SET role = 'owner' WHERE id = (SELECT id FROM accounts ORDER BY created_at, id LIMIT 1);

-- The indexes, under their new definitions.

CREATE UNIQUE INDEX IF NOT EXISTS idx_receipts_one_storno ON receipts(refers_to) WHERE refers_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_receipt_items_item ON receipt_items(order_item_id);

CREATE INDEX IF NOT EXISTS idx_account_tokens_expiry ON account_tokens(expires_at);

CREATE INDEX IF NOT EXISTS idx_email_codes_customer ON email_codes(customer_id, created_at);

CREATE INDEX IF NOT EXISTS idx_drawer_sessions_closed ON drawer_sessions(closed_at);

CREATE INDEX IF NOT EXISTS idx_drawer_movements_session ON drawer_movements(session_id);

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


PRAGMA foreign_keys = ON;

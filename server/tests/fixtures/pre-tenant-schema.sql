-- A database deployed before tenants: the shape 0112 rebuilds from.
-- Generated from origin/main's 0001_init.sql; used by the
-- incremental-migrations test's `drop` for 0112, never by wrangler.

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS tenants;

DROP TABLE IF EXISTS tenant_tokens;

DROP TABLE IF EXISTS account_tokens;

DROP TABLE IF EXISTS accounts;
CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      login TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_iterations INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS account_sessions;
CREATE TABLE account_sessions (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS products;
CREATE TABLE products (
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
      updated_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS product_media;
CREATE TABLE product_media (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('image','video')),
      url TEXT NOT NULL,
      poster_url TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS orders;
CREATE TABLE orders (
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
    );;

DROP TABLE IF EXISTS order_items;
CREATE TABLE order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price_cents INTEGER NOT NULL,
      print_station TEXT NOT NULL,
      modifiers_json TEXT NOT NULL DEFAULT '[]',
      vat_percent INTEGER NOT NULL DEFAULT 10
    );;

DROP TABLE IF EXISTS order_item_vat_splits;
CREATE TABLE order_item_vat_splits (
      order_item_id TEXT PRIMARY KEY REFERENCES order_items(id) ON DELETE CASCADE,
      split_json TEXT NOT NULL
    );;

DROP TABLE IF EXISTS order_item_notes;
CREATE TABLE order_item_notes (
      order_item_id TEXT PRIMARY KEY REFERENCES order_items(id) ON DELETE CASCADE,
      note TEXT NOT NULL
    );;

DROP TABLE IF EXISTS order_item_holds;
CREATE TABLE order_item_holds (
      order_item_id TEXT PRIMARY KEY REFERENCES order_items(id) ON DELETE CASCADE,
      held_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS receipts;
CREATE TABLE receipts (
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
    );;

DROP TABLE IF EXISTS receipt_items;
CREATE TABLE receipt_items (
      receipt_id TEXT NOT NULL REFERENCES receipts(id),
      order_item_id TEXT NOT NULL REFERENCES order_items(id),
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      PRIMARY KEY (receipt_id, order_item_id)
    );;

DROP TABLE IF EXISTS day_closings;
CREATE TABLE day_closings (
      id TEXT PRIMARY KEY,
      closing_no INTEGER NOT NULL UNIQUE,
      first_receipt_no INTEGER NOT NULL,
      last_receipt_no INTEGER NOT NULL UNIQUE,
      totals_json TEXT NOT NULL,
      staff_role TEXT NOT NULL,
      created_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS pos_devices;
CREATE TABLE pos_devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      last_seen_at TEXT
    );;

DROP TABLE IF EXISTS staff;
CREATE TABLE staff (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK (role IN ('staff','manager')),
      pin_hash TEXT NOT NULL,
      pin_salt TEXT NOT NULL,
      pin_iterations INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS pos_sessions;
CREATE TABLE pos_sessions (
      token_hash TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      device_id TEXT NOT NULL REFERENCES pos_devices(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS table_claims;
CREATE TABLE table_claims (
      table_no TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      staff_id TEXT,
      staff_name TEXT,
      expires_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS table_claim_meta;
CREATE TABLE table_claim_meta (
      table_no TEXT PRIMARY KEY,
      shared INTEGER NOT NULL DEFAULT 0,
      epoch INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT ''
    );;

DROP TABLE IF EXISTS order_staff;
CREATE TABLE order_staff (
      order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
      staff_id TEXT,
      staff_name TEXT,
      pickup_no INTEGER,
      created_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS order_item_voids;
CREATE TABLE order_item_voids (
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
    );;

DROP TABLE IF EXISTS staff_settlements;
CREATE TABLE staff_settlements (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL,
      staff_name TEXT NOT NULL,
      last_receipt_no INTEGER NOT NULL,
      totals_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS journal;
CREATE TABLE journal (
      seq INTEGER PRIMARY KEY,
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      ref TEXT,
      payload_json TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL
    );;

DROP TABLE IF EXISTS service_requests;
CREATE TABLE service_requests (
      id TEXT PRIMARY KEY,
      table_no TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS audit_log;
CREATE TABLE audit_log (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      role TEXT NOT NULL,
      ip TEXT NOT NULL DEFAULT '',
      method TEXT NOT NULL,
      route TEXT NOT NULL,
      status INTEGER NOT NULL,
      detail_json TEXT NOT NULL DEFAULT '{}'
    );;

DROP TABLE IF EXISTS restaurant_tables;
CREATE TABLE restaurant_tables (
      table_no TEXT PRIMARY KEY,
      label TEXT NOT NULL DEFAULT '',
      token TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      locked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS printer_profiles;
CREATE TABLE printer_profiles (
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
    );;

DROP TABLE IF EXISTS print_jobs;
CREATE TABLE print_jobs (
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
    );;

DROP TABLE IF EXISTS print_bridges;
CREATE TABLE print_bridges (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '',
      last_seen_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS printer_status;
CREATE TABLE printer_status (
      printer_id TEXT PRIMARY KEY REFERENCES printer_profiles(id) ON DELETE CASCADE,
      bridge_id TEXT NOT NULL,
      ok INTEGER NOT NULL,
      error TEXT,
      checked_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS discovered_printers;
CREATE TABLE discovered_printers (
      address TEXT NOT NULL,
      port INTEGER NOT NULL,
      escpos INTEGER NOT NULL DEFAULT 0,
      bridge_id TEXT NOT NULL,
      seen_at TEXT NOT NULL,
      PRIMARY KEY (address, port)
    );;

DROP TABLE IF EXISTS reservations;
CREATE TABLE reservations (
      id TEXT PRIMARY KEY,
      reference TEXT NOT NULL UNIQUE,
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
      updated_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS reservation_reminders;
CREATE TABLE reservation_reminders (
      reservation_id TEXT PRIMARY KEY,
      sent_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS waitlist;
CREATE TABLE waitlist (
      id TEXT PRIMARY KEY,
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
    );;

DROP TABLE IF EXISTS delivery_orders;
CREATE TABLE delivery_orders (
      id TEXT PRIMARY KEY,
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
      UNIQUE (provider, external_id)
    );;

DROP TABLE IF EXISTS product_stock;
CREATE TABLE product_stock (
      product_id TEXT PRIMARY KEY,
      daily_limit INTEGER,
      stock_day TEXT,
      stock_left INTEGER,
      updated_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS vouchers;
CREATE TABLE vouchers (
      code TEXT PRIMARY KEY,
      value_cents INTEGER NOT NULL,
      balance_cents INTEGER NOT NULL CHECK (balance_cents >= 0),
      sold_receipt_id TEXT NOT NULL REFERENCES receipts(id),
      voided_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS email_codes;
CREATE TABLE email_codes (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS customer_verified_emails;
CREATE TABLE customer_verified_emails (
      customer_id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      verified_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS mail_outbox;
CREATE TABLE mail_outbox (
      id TEXT PRIMARY KEY,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS drawer_sessions;
CREATE TABLE drawer_sessions (
      id TEXT PRIMARY KEY,
      open_flag INTEGER UNIQUE,
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
      note TEXT
    );;

DROP TABLE IF EXISTS drawer_movements;
CREATE TABLE drawer_movements (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES drawer_sessions(id),
      kind TEXT NOT NULL CHECK (kind IN ('in','out')),
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      reason TEXT NOT NULL,
      staff_id TEXT,
      staff_name TEXT,
      created_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS customers;
CREATE TABLE customers (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_iterations INTEGER NOT NULL,
      points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS customer_sessions;
CREATE TABLE customer_sessions (
      token_hash TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS customer_favorites;
CREATE TABLE customer_favorites (
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (customer_id, product_id)
    );;

DROP TABLE IF EXISTS points_ledger;
CREATE TABLE points_ledger (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL CHECK (reason IN ('earn','reverse','redeem','refund','adjust')),
      ref TEXT,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS guest_orders;
CREATE TABLE guest_orders (
      order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
      customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
      channel TEXT NOT NULL CHECK (channel IN ('dine-in','pickup')),
      table_no TEXT NOT NULL,
      pickup_no INTEGER,
      payment TEXT NOT NULL DEFAULT 'in-store',
      points_spent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS table_sessions;
CREATE TABLE table_sessions (
      table_no TEXT PRIMARY KEY,
      opened_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      staff_name TEXT
    );;

DROP TABLE IF EXISTS member_balances;
CREATE TABLE member_balances (
      customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
      balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
      updated_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS balance_ledger;
CREATE TABLE balance_ledger (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      delta_cents INTEGER NOT NULL,
      reason TEXT NOT NULL CHECK (reason IN ('topup','bonus','spend','refund','adjust','reverse')),
      ref TEXT,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS balance_operators;
CREATE TABLE balance_operators (
      ledger_id TEXT PRIMARY KEY,
      operator TEXT NOT NULL DEFAULT ''
    );;

DROP TABLE IF EXISTS member_birthdays;
CREATE TABLE member_birthdays (
      customer_id TEXT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
      month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
      day INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
      updated_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS birthday_greetings;
CREATE TABLE birthday_greetings (
      customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      sent_at TEXT NOT NULL,
      PRIMARY KEY (customer_id, year)
    );;

DROP TABLE IF EXISTS media_files;
CREATE TABLE media_files (
      id TEXT PRIMARY KEY,
      content_type TEXT NOT NULL,
      bytes BLOB NOT NULL,
      credit TEXT,
      source_url TEXT,
      created_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS restaurant_settings;
CREATE TABLE restaurant_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      menu_theme TEXT NOT NULL DEFAULT 'jade',
      updated_at TEXT NOT NULL
    );;

DROP TABLE IF EXISTS app_settings;
CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );;


PRAGMA foreign_keys = ON;

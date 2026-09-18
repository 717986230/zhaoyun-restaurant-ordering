import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { normalizeAllergens } from "../src/allergens.js";
import { photoMenuDishes } from "./photo-menu.mjs";

const ORDER_STATUSES = new Set(["new", "preparing", "ready", "completed", "cancelled"]);
const REQUEST_STATUSES = new Set(["open", "acknowledged", "completed", "cancelled"]);
const PRODUCT_KINDS = new Set(["food", "drink", "sushi"]);
const PRINT_STATIONS = new Set(["kitchen", "bar", "sushi", "front"]);
const SCHEMA_VERSION = 5;
const BUSY_TIMEOUT_MS = Number(process.env.SQLITE_BUSY_TIMEOUT_MS || 5000);
const VAT_PERCENTS = new Set([10, 13, 20]);
// Austrian gastronomy defaults: food is reduced rate, drinks are standard rate.
// The operator can override per product; confirm the rates with a tax advisor.
const DEFAULT_VAT_PERCENT = { food: 10, sushi: 10, drink: 20 };
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

function priceToCents(value) {
  const cents = Math.round(Number(value) * 100);
  if (!Number.isFinite(cents) || cents < 0) throw new Error("Price must be a positive number");
  return cents;
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function mapProduct(row, media = []) {
  return {
    id: row.id,
    sku: row.sku,
    kind: row.kind,
    category: row.category,
    names: { zh: row.name_zh, de: row.name_de, en: row.name_en },
    description: row.description,
    price: row.price_cents / 100,
    vatPercent: row.vat_percent,
    allergens: parseJson(row.allergens_json, []),
    details: {
      time: row.prep_time,
      people: row.portion,
      level: row.level,
      ingredients: row.ingredients
    },
    appearance: {
      art: row.art,
      pattern: row.pattern
    },
    modifiers: parseJson(row.modifiers_json, []),
    available: Boolean(row.available),
    published: Boolean(row.published),
    sortOrder: row.sort_order,
    printStation: row.print_station,
    media: media.map((item) => ({
      id: item.id,
      type: item.type,
      url: item.url,
      posterUrl: item.poster_url,
      sortOrder: item.sort_order
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeProduct(input, current = {}) {
  const names = input.names || {};
  const details = input.details || {};
  const appearance = input.appearance || {};
  const kind = input.kind || current.kind || "food";
  const printStation = input.printStation || current.print_station || (kind === "drink" ? "bar" : kind === "sushi" ? "sushi" : "kitchen");
  if (!PRODUCT_KINDS.has(kind)) throw new Error("Unsupported product kind");
  if (!PRINT_STATIONS.has(printStation)) throw new Error("Unsupported print station");
  const vatPercent = Number(input.vatPercent ?? current.vat_percent ?? DEFAULT_VAT_PERCENT[kind]);
  if (!VAT_PERCENTS.has(vatPercent)) throw new Error("Unsupported VAT percentage");

  return {
    id: String(input.id || current.id || randomUUID()),
    sku: String(input.sku || current.sku || "").trim(),
    kind,
    category: String(input.category || current.category || "OTHER").trim().replace(/\s+/g, " ").toUpperCase(),
    nameZh: String(names.zh ?? input.nameZh ?? current.name_zh ?? "").trim(),
    nameDe: String(names.de ?? input.nameDe ?? current.name_de ?? "").trim(),
    nameEn: String(names.en ?? input.nameEn ?? current.name_en ?? "").trim(),
    description: String(input.description ?? current.description ?? "").trim(),
    priceCents: input.price === undefined ? current.price_cents ?? 0 : priceToCents(input.price),
    vatPercent,
    allergensJson: JSON.stringify(normalizeAllergens(Array.isArray(input.allergens) ? input.allergens : parseJson(current.allergens_json, []))),
    prepTime: String(details.time ?? current.prep_time ?? "").trim(),
    portion: String(details.people ?? current.portion ?? "").trim(),
    level: String(details.level ?? current.level ?? "").trim(),
    ingredients: String(details.ingredients ?? current.ingredients ?? "").trim(),
    art: String(appearance.art ?? current.art ?? "linear-gradient(135deg,#384c3f,#151817 75%)"),
    pattern: String(appearance.pattern ?? current.pattern ?? "lines"),
    modifiersJson: JSON.stringify(Array.isArray(input.modifiers) ? input.modifiers : parseJson(current.modifiers_json, [])),
    available: bool(input.available, current.available === undefined ? true : Boolean(current.available)),
    published: bool(input.published, current.published === undefined ? true : Boolean(current.published)),
    sortOrder: Number(input.sortOrder ?? current.sort_order ?? 0),
    printStation
  };
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

    CREATE INDEX IF NOT EXISTS idx_products_catalog ON products(published, available, sort_order);
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
    "ALTER TABLE orders ADD COLUMN billed_at TEXT"
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
    mediaForProduct: db.prepare("SELECT * FROM product_media WHERE product_id = ? ORDER BY sort_order, created_at"),
    insertProduct: db.prepare(`
      INSERT INTO products (
        id, sku, kind, category, name_zh, name_de, name_en, description, price_cents,
        allergens_json, prep_time, portion, level, ingredients, art, pattern, available,
        published, sort_order, print_station, modifiers_json, vat_percent, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateProduct: db.prepare(`
      UPDATE products SET sku = ?, kind = ?, category = ?, name_zh = ?, name_de = ?,
        name_en = ?, description = ?, price_cents = ?, allergens_json = ?, prep_time = ?,
        portion = ?, level = ?, ingredients = ?, art = ?, pattern = ?, available = ?,
        published = ?, sort_order = ?, print_station = ?, modifiers_json = ?, vat_percent = ?, updated_at = ? WHERE id = ?
    `),
    deleteProduct: db.prepare("DELETE FROM products WHERE id = ?"),
    insertMedia: db.prepare("INSERT INTO product_media (id, product_id, type, url, poster_url, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"),
    deleteMedia: db.prepare("DELETE FROM product_media WHERE id = ?"),
    orderByClientId: db.prepare("SELECT * FROM orders WHERE client_request_id = ?"),
    orderById: db.prepare("SELECT * FROM orders WHERE id = ?"),
    orderItems: db.prepare("SELECT * FROM order_items WHERE order_id = ?"),
    listOrders: db.prepare("SELECT * FROM orders ORDER BY created_at DESC, rowid DESC LIMIT ?"),
    openBillOrders: db.prepare("SELECT * FROM orders WHERE table_no = ? AND billed_at IS NULL AND status <> 'cancelled' ORDER BY created_at"),
    openBillTables: db.prepare("SELECT DISTINCT table_no FROM orders WHERE billed_at IS NULL AND status <> 'cancelled' ORDER BY table_no"),
    markOrdersBilled: db.prepare("UPDATE orders SET billed_at = ?, updated_at = ? WHERE table_no = ? AND billed_at IS NULL AND status <> 'cancelled'"),
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
        product.printStation, product.modifiersJson, product.vatPercent, timestamp, product.id
      );
    } else {
      statements.insertProduct.run(
        product.id, product.sku, product.kind, product.category, product.nameZh,
        product.nameDe, product.nameEn, product.description, product.priceCents,
        product.allergensJson, product.prepTime, product.portion, product.level,
        product.ingredients, product.art, product.pattern, product.available,
        product.published, product.sortOrder, product.printStation, product.modifiersJson,
        product.vatPercent, timestamp, timestamp
      );
    }
    return getProduct(product.id);
  }

  function listProducts(publishedOnly = false) {
    const rows = publishedOnly ? statements.catalogProducts.all() : statements.allProducts.all();
    const media = mediaMap(rows);
    return rows.map((row) => mapProduct(row, media.get(row.id)));
  }

  function addMedia(productId, media) {
    if (!statements.productById.get(String(productId))) return null;
    const id = randomUUID();
    statements.insertMedia.run(id, String(productId), media.type, media.url, media.posterUrl || null, Number(media.sortOrder || 0), now());
    return getProduct(productId);
  }

  function orderView(row) {
    if (!row) return null;
    return {
      id: row.id,
      no: row.order_no,
      clientRequestId: row.client_request_id,
      table: row.table_no,
      status: row.status,
      note: row.note,
      total: row.total_cents / 100,
      items: statements.orderItems.all(row.id).map((item) => ({
        id: item.product_id,
        name: item.product_name,
        qty: item.quantity,
        unitPrice: item.unit_price_cents / 100,
        printStation: item.print_station,
        vatPercent: item.vat_percent,
        modifiers: parseJson(item.modifiers_json, []).map((modifier) => ({ ...modifier, price: modifier.priceCents / 100 }))
      })),
      billedAt: row.billed_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
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

  function resolveModifiers(product, requested = []) {
    const groups = parseJson(product.modifiers_json, []);
    const options = new Map(groups.flatMap((group) => group.options.map((option) => [option.id, { ...option, groupId: group.id, selection: group.selection }] )));
    const selected = [];
    const selectedGroups = new Map();
    for (const request of Array.isArray(requested) ? requested : []) {
      const option = options.get(String(request.id));
      if (!option) throw new Error(`Modifier ${request.id} is not available for ${product.sku}`);
      const count = (selectedGroups.get(option.groupId) || 0) + 1;
      if (option.selection === "single" && count > 1) throw new Error(`Only one modifier is allowed for ${option.groupId}`);
      if (selected.some((item) => item.id === option.id)) throw new Error(`Duplicate modifier ${option.id}`);
      selectedGroups.set(option.groupId, count);
      selected.push({ id: option.id, name: option.names.zh, names: option.names, priceCents: Number(option.priceCents) || 0 });
    }
    return selected;
  }

  function createOrder(input) {
    const requestId = String(input.clientRequestId || randomUUID());
    const existing = statements.orderByClientId.get(requestId);
    if (existing) return orderView(existing);
    if (!Array.isArray(input.items) || !input.items.length) throw new Error("Order requires at least one item");

    const resolvedItems = input.items.map((item) => {
      const product = statements.productById.get(String(item.id));
      const quantity = Number(item.qty);
      if (!product || !product.published || !product.available) throw new Error(`Product ${item.id} is unavailable`);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error("Invalid item quantity");
      const modifiers = resolveModifiers(product, item.modifiers);
      const modifierTotalCents = modifiers.reduce((sum, modifier) => sum + modifier.priceCents, 0);
      return { product, quantity, modifiers, unitPriceCents: product.price_cents + modifierTotalCents };
    });
    const totalCents = resolvedItems.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
    const id = randomUUID();
    const timestamp = now();
    const orderNo = `${timestamp.slice(2, 10).replaceAll("-", "")}-${id.slice(0, 5).toUpperCase()}`;

    const tableNo = String(input.table ?? "").trim();
    if (!tableNo) throw new Error("Order requires a table number");
    db.exec("BEGIN IMMEDIATE");
    try {
      const committed = statements.orderByClientId.get(requestId);
      if (committed) {
        db.exec("COMMIT");
        return orderView(committed);
      }
      statements.insertOrder.run(id, orderNo, requestId, tableNo, String(input.note || "").trim(), totalCents, timestamp, timestamp);
      const jobs = new Map();
      for (const { product, quantity, modifiers, unitPriceCents } of resolvedItems) {
        const productName = product.name_zh || product.name_de || product.name_en;
        statements.insertOrderItem.run(randomUUID(), id, product.id, productName, quantity, unitPriceCents, product.print_station, JSON.stringify(modifiers), product.vat_percent);
        const stationItems = jobs.get(product.print_station) || [];
        stationItems.push({ sku: product.sku, name: productName, names: { zh: product.name_zh, de: product.name_de, en: product.name_en }, quantity, modifiers: modifiers.map((modifier) => ({ name: modifier.name, names: modifier.names, price: modifier.priceCents / 100 })) });
        jobs.set(product.print_station, stationItems);
      }
      for (const [station, items] of jobs) {
        statements.insertPrintJob.run(randomUUID(), id, station, JSON.stringify({ orderNo, table: tableNo, note: String(input.note || ""), items }), timestamp, timestamp);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return orderView(statements.orderById.get(id));
  }

  /**
   * Menu prices are gross, so VAT is extracted per rate group.
   * This is an internal bill, not a fiscal receipt (RKSV/Belegerteilungspflicht).
   */
  function billForTable(tableNo) {
    const orders = statements.openBillOrders.all(String(tableNo));
    const items = [];
    const groups = new Map();
    let totalCents = 0;
    for (const order of orders) {
      for (const row of statements.orderItems.all(order.id)) {
        const lineCents = row.unit_price_cents * row.quantity;
        const vatPercent = row.vat_percent;
        // Guests read the bill: keep the localized names next to the snapshot name.
        const product = statements.productById.get(row.product_id);
        items.push({
          orderNo: order.order_no,
          name: row.product_name,
          names: product ? { zh: product.name_zh, de: product.name_de, en: product.name_en } : undefined,
          qty: row.quantity,
          unitPrice: row.unit_price_cents / 100,
          lineTotal: lineCents / 100,
          vatPercent,
          modifiers: parseJson(row.modifiers_json, []).map((modifier) => ({ name: modifier.name, names: modifier.names }))
        });
        groups.set(vatPercent, (groups.get(vatPercent) || 0) + lineCents);
        totalCents += lineCents;
      }
    }
    const vatBreakdown = [...groups.entries()].sort(([left], [right]) => left - right).map(([percent, grossCents]) => {
      const netCents = Math.round(grossCents / (1 + percent / 100));
      return { percent, gross: grossCents / 100, net: netCents / 100, vat: (grossCents - netCents) / 100 };
    });
    return {
      table: String(tableNo),
      orderNos: orders.map((order) => order.order_no),
      orderIds: orders.map((order) => order.id),
      items,
      vatBreakdown,
      total: totalCents / 100,
      issuedAt: now(),
      fiscalReceipt: false
    };
  }

  function settleTableBill(tableNo) {
    const table = String(tableNo);
    db.exec("BEGIN IMMEDIATE");
    try {
      const bill = billForTable(table);
      if (!bill.orderIds.length) {
        db.exec("COMMIT");
        return null;
      }
      const timestamp = now();
      statements.markOrdersBilled.run(timestamp, timestamp, table);
      const jobId = randomUUID();
      statements.insertPrintJob.run(jobId, bill.orderIds[0], "front", JSON.stringify({ kind: "bill", ...bill, issuedAt: timestamp }), timestamp, timestamp);
      db.exec("COMMIT");
      return { ...bill, issuedAt: timestamp, printJobId: jobId };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function updateOrder(id, status) {
    if (!ORDER_STATUSES.has(status)) throw new Error("Unsupported order status");
    const current = statements.orderById.get(String(id));
    if (!current) return null;
    if (current.status !== status && !ORDER_TRANSITIONS.get(current.status)?.has(status)) {
      throw new Error(`Invalid order transition: ${current.status} -> ${status}`);
    }
    statements.updateOrderStatus.run(status, now(), String(id));
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

  function tableView(row) {
    return row ? { table: row.table_no, label: row.label, token: row.token, enabled: Boolean(row.enabled), createdAt: row.created_at, updatedAt: row.updated_at } : null;
  }

  function normalizeTableNo(value) {
    const table = String(value ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{0,7}$/.test(table)) throw new Error("Table number must be 1-8 letters or digits");
    return table;
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

  seed();

  return {
    close: () => db.close(),
    listProducts,
    getProduct,
    saveProduct,
    deleteProduct: (id) => statements.deleteProduct.run(String(id)).changes > 0,
    addMedia,
    deleteMedia: (id) => statements.deleteMedia.run(String(id)).changes > 0,
    listOrders: (limit = 100) => statements.listOrders.all(Math.min(Number(limit) || 100, 500)).map(orderView),
    createOrder,
    updateOrder,
    billForTable,
    settleTableBill,
    openBillTables: () => statements.openBillTables.all().map((row) => row.table_no),
    listServiceRequests: (limit = 100) => statements.listRequests.all(Math.min(Number(limit) || 100, 500)).map(serviceRequestView),
    createServiceRequest,
    updateServiceRequest,
    recordAudit: (entry) => {
      statements.insertAudit.run(randomUUID(), now(), String(entry.role), String(entry.ip ?? ""), String(entry.method), String(entry.route), Number(entry.status), JSON.stringify(entry.detail ?? {}));
    },
    listAudit: (limit = 100) => statements.listAudit.all(Math.min(Number(limit) || 100, 500)).map((row) => ({
      id: row.id, at: row.at, role: row.role, ip: row.ip, method: row.method,
      route: row.route, status: row.status, detail: parseJson(row.detail_json, {})
    })),
    hasTables: () => statements.tableCount.get().count > 0,
    listTables: () => statements.listTables.all().map(tableView),
    getTable: (table) => tableView(statements.tableByNo.get(String(table ?? "").trim().toUpperCase())),
    saveTable,
    deleteTable: (table) => statements.deleteTable.run(String(table ?? "").trim().toUpperCase()).changes > 0,
    listPrinters: () => statements.listPrinters.all().map(printerView),
    savePrinter,
    deletePrinter: (id) => statements.deletePrinter.run(String(id)).changes > 0,
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

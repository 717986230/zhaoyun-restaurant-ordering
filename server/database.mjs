import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { dishes } from "../src/data.js";

const ORDER_STATUSES = new Set(["new", "preparing", "ready", "completed", "cancelled"]);
const REQUEST_STATUSES = new Set(["open", "acknowledged", "completed", "cancelled"]);
const PRODUCT_KINDS = new Set(["food", "drink", "sushi"]);
const PRINT_STATIONS = new Set(["kitchen", "bar", "sushi", "front"]);
const SCHEMA_VERSION = 1;
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

  return {
    id: String(input.id || current.id || randomUUID()),
    sku: String(input.sku || current.sku || "").trim(),
    kind,
    category: String(input.category || current.category || "OTHER").trim().toUpperCase(),
    nameZh: String(names.zh ?? input.nameZh ?? current.name_zh ?? "").trim(),
    nameDe: String(names.de ?? input.nameDe ?? current.name_de ?? "").trim(),
    nameEn: String(names.en ?? input.nameEn ?? current.name_en ?? "").trim(),
    description: String(input.description ?? current.description ?? "").trim(),
    priceCents: input.price === undefined ? current.price_cents ?? 0 : priceToCents(input.price),
    allergensJson: JSON.stringify(Array.isArray(input.allergens) ? input.allergens : parseJson(current.allergens_json, [])),
    prepTime: String(details.time ?? current.prep_time ?? "").trim(),
    portion: String(details.people ?? current.portion ?? "").trim(),
    level: String(details.level ?? current.level ?? "").trim(),
    ingredients: String(details.ingredients ?? current.ingredients ?? "").trim(),
    art: String(appearance.art ?? current.art ?? "linear-gradient(135deg,#384c3f,#151817 75%)"),
    pattern: String(appearance.pattern ?? current.pattern ?? "lines"),
    available: bool(input.available, current.available === undefined ? true : Boolean(current.available)),
    published: bool(input.published, current.published === undefined ? true : Boolean(current.published)),
    sortOrder: Number(input.sortOrder ?? current.sort_order ?? 0),
    printStation
  };
}

export function createDatabase(databasePath) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

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
      print_station TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS service_requests (
      id TEXT PRIMARY KEY,
      table_no TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
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
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_products_catalog ON products(published, available, sort_order);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status, created_at);
  `);
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
        published, sort_order, print_station, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateProduct: db.prepare(`
      UPDATE products SET sku = ?, kind = ?, category = ?, name_zh = ?, name_de = ?,
        name_en = ?, description = ?, price_cents = ?, allergens_json = ?, prep_time = ?,
        portion = ?, level = ?, ingredients = ?, art = ?, pattern = ?, available = ?,
        published = ?, sort_order = ?, print_station = ?, updated_at = ? WHERE id = ?
    `),
    deleteProduct: db.prepare("DELETE FROM products WHERE id = ?"),
    insertMedia: db.prepare("INSERT INTO product_media (id, product_id, type, url, poster_url, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"),
    deleteMedia: db.prepare("DELETE FROM product_media WHERE id = ?"),
    orderByClientId: db.prepare("SELECT * FROM orders WHERE client_request_id = ?"),
    orderById: db.prepare("SELECT * FROM orders WHERE id = ?"),
    orderItems: db.prepare("SELECT * FROM order_items WHERE order_id = ?"),
    listOrders: db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT ?"),
    insertOrder: db.prepare("INSERT INTO orders (id, order_no, client_request_id, table_no, status, note, total_cents, created_at, updated_at) VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?)"),
    insertOrderItem: db.prepare("INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price_cents, print_station) VALUES (?, ?, ?, ?, ?, ?, ?)"),
    updateOrderStatus: db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?"),
    insertPrintJob: db.prepare("INSERT INTO print_jobs (id, order_id, printer_role, payload_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)"),
    listPrintJobs: db.prepare("SELECT * FROM print_jobs WHERE status = ? ORDER BY created_at LIMIT ?"),
    listRequests: db.prepare("SELECT * FROM service_requests ORDER BY created_at DESC LIMIT ?"),
    requestById: db.prepare("SELECT * FROM service_requests WHERE id = ?"),
    insertRequest: db.prepare("INSERT INTO service_requests (id, table_no, type, status, created_at, updated_at) VALUES (?, ?, ?, 'open', ?, ?)"),
    updateRequest: db.prepare("UPDATE service_requests SET status = ?, updated_at = ? WHERE id = ?"),
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
        product.printStation, timestamp, product.id
      );
    } else {
      statements.insertProduct.run(
        product.id, product.sku, product.kind, product.category, product.nameZh,
        product.nameDe, product.nameEn, product.description, product.priceCents,
        product.allergensJson, product.prepTime, product.portion, product.level,
        product.ingredients, product.art, product.pattern, product.available,
        product.published, product.sortOrder, product.printStation, timestamp, timestamp
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
        printStation: item.print_station
      })),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
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
      return { product, quantity };
    });
    const totalCents = resolvedItems.reduce((sum, item) => sum + item.product.price_cents * item.quantity, 0);
    const id = randomUUID();
    const timestamp = now();
    const orderNo = `${timestamp.slice(2, 10).replaceAll("-", "")}-${id.slice(0, 5).toUpperCase()}`;

    db.exec("BEGIN IMMEDIATE");
    try {
      statements.insertOrder.run(id, orderNo, requestId, String(input.table || "08"), String(input.note || "").trim(), totalCents, timestamp, timestamp);
      const jobs = new Map();
      for (const { product, quantity } of resolvedItems) {
        const productName = product.name_zh || product.name_de || product.name_en;
        statements.insertOrderItem.run(randomUUID(), id, product.id, productName, quantity, product.price_cents, product.print_station);
        const stationItems = jobs.get(product.print_station) || [];
        stationItems.push({ sku: product.sku, name: productName, quantity });
        jobs.set(product.print_station, stationItems);
      }
      for (const [station, items] of jobs) {
        statements.insertPrintJob.run(randomUUID(), id, station, JSON.stringify({ orderNo, table: String(input.table || "08"), note: String(input.note || ""), items }), timestamp, timestamp);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return orderView(statements.orderById.get(id));
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
    statements.insertRequest.run(id, String(input.table || "08"), String(input.type || "").trim(), timestamp, timestamp);
    return statements.requestById.get(id);
  }

  function updateServiceRequest(id, status) {
    if (!REQUEST_STATUSES.has(status)) throw new Error("Unsupported service request status");
    const current = statements.requestById.get(String(id));
    if (!current) return null;
    if (current.status !== status && !REQUEST_TRANSITIONS.get(current.status)?.has(status)) {
      throw new Error(`Invalid service request transition: ${current.status} -> ${status}`);
    }
    statements.updateRequest.run(status, now(), String(id));
    return statements.requestById.get(String(id));
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
    return statements.printerById.get(printer.id);
  }

  function seed() {
    if (statements.productCount.get().count) return;
    db.exec("BEGIN");
    try {
      dishes.forEach((dish, index) => saveProduct({
        id: String(dish.id),
        sku: `FOOD-${dish.id}`,
        kind: "food",
        category: dish.cat,
        names: { zh: dish.zh, de: dish.de, en: dish.en },
        description: dish.intro,
        price: dish.price,
        allergens: dish.allergens.split(",").map((item) => item.trim()).filter(Boolean),
        details: { time: dish.time, people: dish.people, level: dish.level, ingredients: dish.ingredients },
        appearance: { art: dish.art, pattern: dish.pattern },
        sortOrder: index,
        printStation: "kitchen"
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
    listServiceRequests: (limit = 100) => statements.listRequests.all(Math.min(Number(limit) || 100, 500)),
    createServiceRequest,
    updateServiceRequest,
    listPrinters: () => statements.listPrinters.all().map((row) => ({ ...row, enabled: Boolean(row.enabled), capabilities: parseJson(row.capabilities_json, {}) })),
    savePrinter,
    deletePrinter: (id) => statements.deletePrinter.run(String(id)).changes > 0,
    listPrintJobs: (status = "queued", limit = 100) => statements.listPrintJobs.all(String(status), Math.min(Number(limit) || 100, 500)).map((row) => ({ ...row, payload: parseJson(row.payload_json, {}) }))
  };
}

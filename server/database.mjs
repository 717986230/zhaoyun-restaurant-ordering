import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { photoMenuDishes } from "./photo-menu.mjs";
import {
  assertOrderTransition, assertRequestTransition, boundedLimit, mapProduct, normalizePrinter,
  normalizeProduct, now, orderProductIds, orderView, parseJson, planOrder, planPrintFailure,
  printerView, serviceRequestView
} from "../shared/rules.mjs";

const SCHEMA_VERSION = 3;

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
      modifiers_json TEXT NOT NULL DEFAULT '[]',
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
      print_station TEXT NOT NULL,
      modifiers_json TEXT NOT NULL DEFAULT '[]'
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
      claimed_by TEXT,
      lease_until TEXT,
      next_attempt_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_products_catalog ON products(published, available, sort_order);
    CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status, created_at);
  `);
  for (const statement of [
    "ALTER TABLE products ADD COLUMN modifiers_json TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE order_items ADD COLUMN modifiers_json TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE print_jobs ADD COLUMN claimed_by TEXT",
    "ALTER TABLE print_jobs ADD COLUMN lease_until TEXT",
    "ALTER TABLE print_jobs ADD COLUMN next_attempt_at TEXT"
  ]) {
    try { db.exec(statement); } catch (error) { if (!String(error.message).includes("duplicate column name")) throw error; }
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
        published, sort_order, print_station, modifiers_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateProduct: db.prepare(`
      UPDATE products SET sku = ?, kind = ?, category = ?, name_zh = ?, name_de = ?,
        name_en = ?, description = ?, price_cents = ?, allergens_json = ?, prep_time = ?,
        portion = ?, level = ?, ingredients = ?, art = ?, pattern = ?, available = ?,
        published = ?, sort_order = ?, print_station = ?, modifiers_json = ?, updated_at = ? WHERE id = ?
    `),
    deleteProduct: db.prepare("DELETE FROM products WHERE id = ?"),
    insertMedia: db.prepare("INSERT INTO product_media (id, product_id, type, url, poster_url, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"),
    deleteMedia: db.prepare("DELETE FROM product_media WHERE id = ?"),
    orderByClientId: db.prepare("SELECT * FROM orders WHERE client_request_id = ?"),
    orderById: db.prepare("SELECT * FROM orders WHERE id = ?"),
    orderItems: db.prepare("SELECT * FROM order_items WHERE order_id = ?"),
    listOrders: db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT ?"),
    insertOrder: db.prepare("INSERT INTO orders (id, order_no, client_request_id, table_no, status, note, total_cents, created_at, updated_at) VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?)"),
    insertOrderItem: db.prepare("INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price_cents, print_station, modifiers_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
    updateOrderStatus: db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?"),
    insertPrintJob: db.prepare("INSERT INTO print_jobs (id, order_id, printer_role, payload_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)"),
    listPrintJobs: db.prepare("SELECT * FROM print_jobs WHERE status = ? ORDER BY created_at LIMIT ?"),
    claimablePrintJob: db.prepare("SELECT * FROM print_jobs WHERE printer_role = ? AND ((status = 'queued') OR (status = 'retry-wait' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)) OR (status = 'claimed' AND lease_until <= ?)) ORDER BY created_at LIMIT 1"),
    claimPrintJob: db.prepare("UPDATE print_jobs SET status = 'claimed', claimed_by = ?, lease_until = ?, updated_at = ? WHERE id = ? AND (status = 'queued' OR status = 'retry-wait' OR (status = 'claimed' AND lease_until <= ?))"),
    completePrintJob: db.prepare("UPDATE print_jobs SET status = 'printed', claimed_by = NULL, lease_until = NULL, next_attempt_at = NULL, error = NULL, updated_at = ? WHERE id = ? AND status = 'claimed' AND claimed_by = ?"),
    printJobById: db.prepare("SELECT * FROM print_jobs WHERE id = ?"),
    failPrintJob: db.prepare("UPDATE print_jobs SET status = ?, attempts = attempts + 1, error = ?, claimed_by = NULL, lease_until = NULL, next_attempt_at = ?, updated_at = ? WHERE id = ? AND status = 'claimed' AND claimed_by = ?"),
    retryPrintJob: db.prepare("UPDATE print_jobs SET status = 'queued', attempts = 0, error = NULL, claimed_by = NULL, lease_until = NULL, next_attempt_at = NULL, updated_at = ? WHERE id = ? AND status = 'failed'"),
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
    const timestamp = now();
    if (current) {
      statements.updateProduct.run(
        product.sku, product.kind, product.category, product.nameZh, product.nameDe,
        product.nameEn, product.description, product.priceCents, product.allergensJson,
        product.prepTime, product.portion, product.level, product.ingredients, product.art,
        product.pattern, product.available, product.published, product.sortOrder,
        product.printStation, product.modifiersJson, timestamp, product.id
      );
    } else {
      statements.insertProduct.run(
        product.id, product.sku, product.kind, product.category, product.nameZh,
        product.nameDe, product.nameEn, product.description, product.priceCents,
        product.allergensJson, product.prepTime, product.portion, product.level,
        product.ingredients, product.art, product.pattern, product.available,
        product.published, product.sortOrder, product.printStation, product.modifiersJson, timestamp, timestamp
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

  function viewOrder(row) {
    return row ? orderView(row, statements.orderItems.all(row.id)) : null;
  }

  function createOrder(input) {
    const requestId = String(input.clientRequestId || "");
    if (requestId) {
      const existing = statements.orderByClientId.get(requestId);
      if (existing) return viewOrder(existing);
    }

    const products = new Map();
    for (const productId of orderProductIds(input)) {
      const row = statements.productById.get(productId);
      if (row) products.set(productId, row);
    }
    const plan = planOrder(input, products);

    db.exec("BEGIN IMMEDIATE");
    try {
      // Re-read inside the transaction: two tablets retrying the same queued
      // order is exactly the case this id exists for.
      const committed = statements.orderByClientId.get(plan.clientRequestId);
      if (committed) {
        db.exec("COMMIT");
        return viewOrder(committed);
      }
      const { id, orderNo, clientRequestId, table, note, totalCents, timestamp } = plan.order;
      statements.insertOrder.run(id, orderNo, clientRequestId, table, note, totalCents, timestamp, timestamp);
      for (const item of plan.items) {
        statements.insertOrderItem.run(item.id, item.orderId, item.productId, item.productName, item.quantity, item.unitPriceCents, item.printStation, item.modifiersJson);
      }
      for (const job of plan.printJobs) {
        statements.insertPrintJob.run(job.id, job.orderId, job.printerRole, job.payloadJson, timestamp, timestamp);
      }
      db.exec("COMMIT");
      return viewOrder(statements.orderById.get(id));
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function updateOrder(id, status) {
    const current = statements.orderById.get(String(id));
    if (!current) return null;
    assertOrderTransition(current.status, status);
    statements.updateOrderStatus.run(status, now(), String(id));
    return viewOrder(statements.orderById.get(String(id)));
  }

  function createServiceRequest(input) {
    const id = randomUUID();
    const timestamp = now();
    const table = String(input.table || "").trim();
    if (!table) throw new Error("Service request requires a table number");
    statements.insertRequest.run(id, table, String(input.type || "").trim(), timestamp, timestamp);
    return serviceRequestView(statements.requestById.get(id));
  }

  function updateServiceRequest(id, status) {
    const current = statements.requestById.get(String(id));
    if (!current) return null;
    assertRequestTransition(current.status, status);
    statements.updateRequest.run(status, now(), String(id));
    return serviceRequestView(statements.requestById.get(String(id)));
  }

  function savePrinter(input, id) {
    const current = id ? statements.printerById.get(String(id)) : null;
    if (id && !current) return null;
    const printer = normalizePrinter({ ...input, id: id || input.id }, current);
    const timestamp = now();
    if (current) {
      statements.updatePrinter.run(printer.name, printer.transport, printer.address, printer.port, printer.role, printer.enabled, printer.capabilities, timestamp, printer.id);
    } else {
      statements.insertPrinter.run(printer.id, printer.name, printer.transport, printer.address, printer.port, printer.role, printer.enabled, printer.capabilities, timestamp, timestamp);
    }
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
    listOrders: (limit = 100) => statements.listOrders.all(boundedLimit(limit)).map(viewOrder),
    createOrder,
    updateOrder,
    listServiceRequests: (limit = 100) => statements.listRequests.all(boundedLimit(limit)).map(serviceRequestView),
    createServiceRequest,
    updateServiceRequest,
    listPrinters: () => statements.listPrinters.all().map(printerView),
    savePrinter,
    deletePrinter: (id) => statements.deletePrinter.run(String(id)).changes > 0,
    listPrintJobs: (status = "queued", limit = 100) => statements.listPrintJobs.all(String(status), boundedLimit(limit)).map((row) => ({ ...row, payload: parseJson(row.payload_json, {}) })),
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
      const { status, nextAttemptAt } = planPrintFailure(current.attempts, maxAttempts);
      return statements.failPrintJob.run(status, String(error).slice(0, 1000), nextAttemptAt, now(), String(id), String(workerId)).changes > 0;
    },
    retryPrintJob: (id) => statements.retryPrintJob.run(now(), String(id)).changes > 0,
    printerForRole: (role) => {
      const row = statements.listPrinters.all().find((printer) => printer.role === String(role) && printer.enabled);
      return printerView(row);
    }
  };
}

/**
 * The D1 half of the backend.
 *
 * Every decision this makes — what a product row means, what an order costs,
 * which status may follow which — comes from shared/rules.mjs, the same module
 * the Node server uses. What lives here is only the part that cannot be shared:
 * `node:sqlite` is synchronous and D1 is not, and D1 has no interactive
 * transaction, so the order write that is a BEGIN/COMMIT over there is one
 * atomic `batch()` here.
 */
import {
  assertOrderTransition, assertRequestTransition, boundedLimit, mapProduct, normalizePrinter,
  normalizeProduct, now, orderProductIds, orderView, parseJson, planOrder, planPrintFailure,
  printerView, serviceRequestView, uuid
} from "../shared/rules.mjs";

const PRODUCT_COLUMNS = [
  "id", "sku", "kind", "category", "name_zh", "name_de", "name_en", "description", "price_cents",
  "allergens_json", "prep_time", "portion", "level", "ingredients", "art", "pattern", "available",
  "published", "sort_order", "print_station", "modifiers_json", "created_at", "updated_at"
];

export function createStore(db) {
  const first = (sql, ...params) => db.prepare(sql).bind(...params).first();
  const all = async (sql, ...params) => (await db.prepare(sql).bind(...params).all()).results ?? [];
  const run = async (sql, ...params) => (await db.prepare(sql).bind(...params).run()).meta?.changes ?? 0;

  // SQLite binds at most 100 variables per statement, and the menu is 111
  // dishes, so an `IN (?, ?, ...)` over a whole catalogue fails outright.
  const BIND_LIMIT = 90;

  async function selectByIds(sql, ids) {
    const rows = [];
    for (let index = 0; index < ids.length; index += BIND_LIMIT) {
      const slice = ids.slice(index, index + BIND_LIMIT);
      rows.push(...await all(sql.replace("(?)", `(${slice.map(() => "?").join(", ")})`), ...slice));
    }
    return rows;
  }

  async function mediaFor(productIds) {
    if (!productIds.length) return new Map();
    const rows = await selectByIds(
      "SELECT * FROM product_media WHERE product_id IN (?) ORDER BY sort_order, created_at",
      productIds
    );
    const map = new Map(productIds.map((id) => [id, []]));
    for (const row of rows) map.get(row.product_id)?.push(row);
    return map;
  }

  async function getProduct(id) {
    const row = await first("SELECT * FROM products WHERE id = ?", String(id));
    if (!row) return null;
    const media = await mediaFor([row.id]);
    return mapProduct(row, media.get(row.id));
  }

  async function listProducts(publishedOnly = false) {
    const rows = publishedOnly
      ? await all("SELECT * FROM products WHERE published = 1 AND available = 1 ORDER BY sort_order, created_at")
      : await all("SELECT * FROM products ORDER BY sort_order, created_at");
    const media = await mediaFor(rows.map((row) => row.id));
    return rows.map((row) => mapProduct(row, media.get(row.id)));
  }

  async function saveProduct(input, id) {
    const current = id ? await first("SELECT * FROM products WHERE id = ?", String(id)) : null;
    if (id && !current) return null;
    const product = normalizeProduct({ ...input, id: id || input.id }, current || {});
    const timestamp = now();
    if (current) {
      await run(
        `UPDATE products SET sku = ?, kind = ?, category = ?, name_zh = ?, name_de = ?,
           name_en = ?, description = ?, price_cents = ?, allergens_json = ?, prep_time = ?,
           portion = ?, level = ?, ingredients = ?, art = ?, pattern = ?, available = ?,
           published = ?, sort_order = ?, print_station = ?, modifiers_json = ?, updated_at = ? WHERE id = ?`,
        product.sku, product.kind, product.category, product.nameZh, product.nameDe,
        product.nameEn, product.description, product.priceCents, product.allergensJson,
        product.prepTime, product.portion, product.level, product.ingredients, product.art,
        product.pattern, product.available, product.published, product.sortOrder,
        product.printStation, product.modifiersJson, timestamp, product.id
      );
    } else {
      await run(
        `INSERT INTO products (${PRODUCT_COLUMNS.join(", ")}) VALUES (${PRODUCT_COLUMNS.map(() => "?").join(", ")})`,
        product.id, product.sku, product.kind, product.category, product.nameZh,
        product.nameDe, product.nameEn, product.description, product.priceCents,
        product.allergensJson, product.prepTime, product.portion, product.level,
        product.ingredients, product.art, product.pattern, product.available,
        product.published, product.sortOrder, product.printStation, product.modifiersJson, timestamp, timestamp
      );
    }
    return getProduct(product.id);
  }

  async function addMedia(productId, media) {
    if (!(await first("SELECT id FROM products WHERE id = ?", String(productId)))) return null;
    await run(
      "INSERT INTO product_media (id, product_id, type, url, poster_url, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      uuid(), String(productId), media.type, media.url, media.posterUrl || null, Number(media.sortOrder || 0), now()
    );
    return getProduct(productId);
  }

  async function viewOrder(row) {
    if (!row) return null;
    return orderView(row, await all("SELECT * FROM order_items WHERE order_id = ?", row.id));
  }

  async function createOrder(input) {
    const requestId = String(input.clientRequestId || "");
    if (requestId) {
      const existing = await first("SELECT * FROM orders WHERE client_request_id = ?", requestId);
      if (existing) return viewOrder(existing);
    }

    const ids = [...new Set(orderProductIds(input))];
    const products = new Map();
    for (const row of await selectByIds("SELECT * FROM products WHERE id IN (?)", ids)) {
      products.set(String(row.id), row);
    }
    const plan = planOrder(input, products);
    const { id, orderNo, clientRequestId, table, note, totalCents, timestamp } = plan.order;

    // D1 has no interactive transaction, so the re-read that guards a retried
    // order cannot sit inside one. The UNIQUE index on client_request_id is what
    // actually decides it: the loser of a race fails the batch, and the order
    // the winner wrote is the one both tablets are then handed.
    const statements = [
      db.prepare("INSERT INTO orders (id, order_no, client_request_id, table_no, status, note, total_cents, created_at, updated_at) VALUES (?, ?, ?, ?, 'new', ?, ?, ?, ?)")
        .bind(id, orderNo, clientRequestId, table, note, totalCents, timestamp, timestamp),
      ...plan.items.map((item) => db.prepare("INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price_cents, print_station, modifiers_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(item.id, item.orderId, item.productId, item.productName, item.quantity, item.unitPriceCents, item.printStation, item.modifiersJson)),
      ...plan.printJobs.map((job) => db.prepare("INSERT INTO print_jobs (id, order_id, printer_role, payload_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)")
        .bind(job.id, job.orderId, job.printerRole, job.payloadJson, timestamp, timestamp))
    ];

    try {
      await db.batch(statements);
    } catch (error) {
      const committed = await first("SELECT * FROM orders WHERE client_request_id = ?", clientRequestId);
      if (committed) return viewOrder(committed);
      throw error;
    }
    return viewOrder(await first("SELECT * FROM orders WHERE id = ?", id));
  }

  async function updateOrder(id, status) {
    const current = await first("SELECT * FROM orders WHERE id = ?", String(id));
    if (!current) return null;
    assertOrderTransition(current.status, status);
    await run("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?", status, now(), String(id));
    return viewOrder(await first("SELECT * FROM orders WHERE id = ?", String(id)));
  }

  async function createServiceRequest(input) {
    const table = String(input.table || "").trim();
    if (!table) throw new Error("Service request requires a table number");
    const id = uuid();
    const timestamp = now();
    await run(
      "INSERT INTO service_requests (id, table_no, type, status, created_at, updated_at) VALUES (?, ?, ?, 'open', ?, ?)",
      id, table, String(input.type || "").trim(), timestamp, timestamp
    );
    return serviceRequestView(await first("SELECT * FROM service_requests WHERE id = ?", id));
  }

  async function updateServiceRequest(id, status) {
    const current = await first("SELECT * FROM service_requests WHERE id = ?", String(id));
    if (!current) return null;
    assertRequestTransition(current.status, status);
    await run("UPDATE service_requests SET status = ?, updated_at = ? WHERE id = ?", status, now(), String(id));
    return serviceRequestView(await first("SELECT * FROM service_requests WHERE id = ?", String(id)));
  }

  async function savePrinter(input, id) {
    const current = id ? await first("SELECT * FROM printer_profiles WHERE id = ?", String(id)) : null;
    if (id && !current) return null;
    const printer = normalizePrinter({ ...input, id: id || input.id }, current);
    const timestamp = now();
    if (current) {
      await run(
        "UPDATE printer_profiles SET name = ?, transport = ?, address = ?, port = ?, role = ?, enabled = ?, capabilities_json = ?, updated_at = ? WHERE id = ?",
        printer.name, printer.transport, printer.address, printer.port, printer.role, printer.enabled, printer.capabilities, timestamp, printer.id
      );
    } else {
      await run(
        "INSERT INTO printer_profiles (id, name, transport, address, port, role, enabled, capabilities_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        printer.id, printer.name, printer.transport, printer.address, printer.port, printer.role, printer.enabled, printer.capabilities, timestamp, timestamp
      );
    }
    return printerView(await first("SELECT * FROM printer_profiles WHERE id = ?", printer.id));
  }

  return {
    listProducts,
    getProduct,
    saveProduct,
    deleteProduct: async (id) => (await run("DELETE FROM products WHERE id = ?", String(id))) > 0,
    addMedia,
    listOrders: async (limit = 100) => {
      const rows = await all("SELECT * FROM orders ORDER BY created_at DESC LIMIT ?", boundedLimit(limit));
      return Promise.all(rows.map(viewOrder));
    },
    createOrder,
    updateOrder,
    listServiceRequests: async (limit = 100) =>
      (await all("SELECT * FROM service_requests ORDER BY created_at DESC LIMIT ?", boundedLimit(limit))).map(serviceRequestView),
    createServiceRequest,
    updateServiceRequest,
    listPrinters: async () => (await all("SELECT * FROM printer_profiles ORDER BY role, name")).map(printerView),
    savePrinter,
    deletePrinter: async (id) => (await run("DELETE FROM printer_profiles WHERE id = ?", String(id))) > 0,
    listPrintJobs: async (status = "queued", limit = 100) =>
      (await all("SELECT * FROM print_jobs WHERE status = ? ORDER BY created_at LIMIT ?", String(status), boundedLimit(limit)))
        .map((row) => ({ ...row, payload: parseJson(row.payload_json, {}) })),
    retryPrintJob: async (id) =>
      (await run(
        "UPDATE print_jobs SET status = 'queued', attempts = 0, error = NULL, claimed_by = NULL, lease_until = NULL, next_attempt_at = NULL, updated_at = ? WHERE id = ? AND status = 'failed'",
        now(), String(id)
      )) > 0,

    /**
     * The print agent runs in the restaurant, next to the printers, and claims
     * work over HTTP now instead of opening the database file. The lease is what
     * stops two agents printing the same ticket: the UPDATE only lands if the
     * job is still claimable, so a loser gets 0 changes and asks again.
     */
    claimPrintJob: async (role, workerId, leaseMs = 30_000) => {
      const timestamp = now();
      const leaseUntil = new Date(Date.now() + leaseMs).toISOString();
      const job = await first(
        `SELECT * FROM print_jobs WHERE printer_role = ?
           AND ((status = 'queued')
             OR (status = 'retry-wait' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
             OR (status = 'claimed' AND lease_until <= ?))
         ORDER BY created_at LIMIT 1`,
        String(role), timestamp, timestamp
      );
      if (!job) return null;
      const changed = await run(
        `UPDATE print_jobs SET status = 'claimed', claimed_by = ?, lease_until = ?, updated_at = ?
         WHERE id = ? AND (status = 'queued' OR status = 'retry-wait' OR (status = 'claimed' AND lease_until <= ?))`,
        String(workerId), leaseUntil, timestamp, job.id, timestamp
      );
      if (!changed) return null;
      return { ...job, status: "claimed", claimed_by: String(workerId), lease_until: leaseUntil, payload: parseJson(job.payload_json, {}) };
    },
    completePrintJob: async (id, workerId) =>
      (await run(
        "UPDATE print_jobs SET status = 'printed', claimed_by = NULL, lease_until = NULL, next_attempt_at = NULL, error = NULL, updated_at = ? WHERE id = ? AND status = 'claimed' AND claimed_by = ?",
        now(), String(id), String(workerId)
      )) > 0,
    failPrintJob: async (id, workerId, error, maxAttempts = 5) => {
      const current = await first("SELECT * FROM print_jobs WHERE id = ?", String(id));
      if (!current || current.claimed_by !== String(workerId)) return false;
      const { status, nextAttemptAt } = planPrintFailure(current.attempts, maxAttempts);
      return (await run(
        "UPDATE print_jobs SET status = ?, attempts = attempts + 1, error = ?, claimed_by = NULL, lease_until = NULL, next_attempt_at = ?, updated_at = ? WHERE id = ? AND status = 'claimed' AND claimed_by = ?",
        status, String(error).slice(0, 1000), nextAttemptAt, now(), String(id), String(workerId)
      )) > 0;
    },
    printerForRole: async (role) => {
      const row = await first("SELECT * FROM printer_profiles WHERE role = ? AND enabled = 1 ORDER BY name LIMIT 1", String(role));
      return printerView(row);
    }
  };
}

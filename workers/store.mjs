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
  adminGateView, assertOrderTransition, assertPassword, assertRequestTransition, auditView,
  billView, bool, boundedLimit, hashPassword, hashSessionToken, mapProduct, newSessionToken,
  normalizeMenuTheme, normalizePrinter, normalizeProduct, normalizeTableNo, now,
  orderProductIds, orderView, parseJson, PASSWORD_ITERATIONS, planOrder, planPrintFailure, printerView,
  printJobView, serviceRequestView, SESSION_TTL_MS, settingsView, tableOverviewView, tableView, uuid,
  verifyPassword
} from "../shared/rules.mjs";

// Matches server/database.mjs: a salt for nobody, so signing in against a
// console with no password costs the same 210k iterations as one with.
const ABSENT_PASSWORD_SALT = "AAAAAAAAAAAAAAAAAAAAAA==";

const PRODUCT_COLUMNS = [
  "id", "sku", "kind", "category", "name_zh", "name_de", "name_en", "description", "price_cents",
  "allergens_json", "prep_time", "portion", "level", "ingredients", "art", "pattern", "available",
  "published", "sort_order", "print_station", "modifiers_json", "bundle_items_json", "created_at", "updated_at"
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

  /** 12 random bytes, base64url, the same shape the Node server prints on a card. */
  function entryToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
           published = ?, sort_order = ?, print_station = ?, modifiers_json = ?,
           bundle_items_json = ?, updated_at = ? WHERE id = ?`,
        product.sku, product.kind, product.category, product.nameZh, product.nameDe,
        product.nameEn, product.description, product.priceCents, product.allergensJson,
        product.prepTime, product.portion, product.level, product.ingredients, product.art,
        product.pattern, product.available, product.published, product.sortOrder,
        product.printStation, product.modifiersJson, product.bundleItemsJson, timestamp, product.id
      );
    } else {
      await run(
        `INSERT INTO products (${PRODUCT_COLUMNS.join(", ")}) VALUES (${PRODUCT_COLUMNS.map(() => "?").join(", ")})`,
        product.id, product.sku, product.kind, product.category, product.nameZh,
        product.nameDe, product.nameEn, product.description, product.priceCents,
        product.allergensJson, product.prepTime, product.portion, product.level,
        product.ingredients, product.art, product.pattern, product.available,
        product.published, product.sortOrder, product.printStation, product.modifiersJson, product.bundleItemsJson, timestamp, timestamp
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

  /**
   * The VAT split itself lives in `shared/rules.mjs`, so this computes a bill
   * the same way the Node server does rather than a second, guessed way. All
   * that is left here is reading the rows.
   */
  async function billForTable(tableNo) {
    const orders = await all(
      "SELECT * FROM orders WHERE table_no = ? AND billed_at IS NULL AND status <> 'cancelled' ORDER BY created_at",
      String(tableNo)
    );
    const itemsByOrderId = new Map();
    const productIds = new Set();
    for (const order of orders) {
      const rows = await all("SELECT * FROM order_items WHERE order_id = ?", order.id);
      itemsByOrderId.set(order.id, rows);
      for (const row of rows) productIds.add(String(row.product_id));
    }
    const productsById = new Map(
      (await selectByIds("SELECT * FROM products WHERE id IN (?)", [...productIds])).map((row) => [String(row.id), row])
    );
    return billView(tableNo, orders, itemsByOrderId, productsById);
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

    // A locked table is one whose bill is being settled. Refusing here is the
    // whole point of the lock: an order that lands mid-settle is either missing
    // from the bill the guest just paid or reopens a table that was released.
    const tableRow = await first("SELECT locked_at FROM restaurant_tables WHERE table_no = ?", String(table).toUpperCase());
    if (tableRow?.locked_at) {
      const error = new Error("This table is locked; please ask a waiter");
      error.code = "TABLE_LOCKED";
      throw error;
    }

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

  /**
   * The password gate and its sessions, the same decisions
   * server/database.mjs makes — the hashing, the token shape and the session
   * lifetime all come from shared/rules.mjs, so only the reads and writes
   * differ here.
   */
  async function adminGate() {
    return adminGateView(await first("SELECT * FROM admin_gate WHERE id = 1"));
  }

  async function resetAdminGatePassword(password) {
    const stored = await hashPassword(assertPassword(password));
    await run(
      `INSERT INTO admin_gate (id, password_hash, password_salt, password_iterations, updated_at)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         password_hash = excluded.password_hash,
         password_salt = excluded.password_salt,
         password_iterations = excluded.password_iterations,
         updated_at = excluded.updated_at`,
      stored.hash, stored.salt, stored.iterations, now()
    );
    await run("DELETE FROM admin_sessions");
    return adminGate();
  }

  async function setAdminGatePassword(password, currentPassword) {
    const row = await first("SELECT * FROM admin_gate WHERE id = 1");
    if (row) {
      const correct = await verifyPassword(String(currentPassword ?? ""), {
        hash: row.password_hash, salt: row.password_salt, iterations: row.password_iterations
      });
      if (!correct) return null;
    }
    return resetAdminGatePassword(password);
  }

  async function signIn(password) {
    const row = await first("SELECT * FROM admin_gate WHERE id = 1");
    const stored = row
      ? { hash: row.password_hash, salt: row.password_salt, iterations: row.password_iterations }
      : { hash: "", salt: ABSENT_PASSWORD_SALT, iterations: PASSWORD_ITERATIONS };
    const correct = await verifyPassword(String(password ?? ""), stored);
    if (!row || !correct) return null;

    const token = newSessionToken();
    const timestamp = now();
    await run("DELETE FROM admin_sessions WHERE expires_at <= ?", timestamp);
    await run(
      "INSERT INTO admin_sessions (token_hash, expires_at, created_at) VALUES (?, ?, ?)",
      await hashSessionToken(token), new Date(Date.now() + SESSION_TTL_MS).toISOString(), timestamp
    );
    return { token, expiresInMs: SESSION_TTL_MS };
  }

  async function roleForSession(token) {
    if (!token) return null;
    const row = await first("SELECT * FROM admin_sessions WHERE token_hash = ?", await hashSessionToken(token));
    if (!row) return null;
    if (row.expires_at <= now()) {
      await run("DELETE FROM admin_sessions WHERE token_hash = ?", row.token_hash);
      return null;
    }
    return { role: "manager" };
  }

  async function signOut(token) {
    if (!token) return false;
    return (await run("DELETE FROM admin_sessions WHERE token_hash = ?", await hashSessionToken(token))) > 0;
  }

  async function getSettings() {
    return settingsView(await first("SELECT * FROM restaurant_settings WHERE id = 1"));
  }

  async function saveSettings(input) {
    const menuTheme = normalizeMenuTheme(input.menuTheme);
    await run(
      `INSERT INTO restaurant_settings (id, menu_theme, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET menu_theme = excluded.menu_theme, updated_at = excluded.updated_at`,
      menuTheme, now()
    );
    return getSettings();
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
    getSettings,
    saveSettings,
    adminGate,
    setAdminGatePassword,
    resetAdminGatePassword,
    signIn,
    signOut,
    roleForSession,
    listPrintJobs: async (status = "queued", limit = 100) =>
      (await all("SELECT * FROM print_jobs WHERE status = ? ORDER BY created_at LIMIT ?", String(status), boundedLimit(limit)))
        .map(printJobView),
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
    /**
     * Tables, and the entry token printed on their card.
     *
     * The token is rotated by asking, never on every save: reprinting every
     * card in the restaurant because someone fixed a typo in a label is not a
     * thing anyone wants. `crypto.getRandomValues` is what a Worker has in
     * place of `node:crypto`.
     */
    hasTables: async () => Boolean(await first("SELECT table_no FROM restaurant_tables LIMIT 1")),
    listTables: async () => (await all("SELECT * FROM restaurant_tables ORDER BY table_no")).map(tableView),
    getTable: async (table) => tableView(await first("SELECT * FROM restaurant_tables WHERE table_no = ?", normalizeTableNo(table))),
    saveTable: async (input) => {
      const table = normalizeTableNo(input.table);
      const current = await first("SELECT * FROM restaurant_tables WHERE table_no = ?", table);
      const timestamp = now();
      const token = input.rotateToken || !current ? entryToken() : current.token;
      await run(
        `INSERT INTO restaurant_tables (table_no, label, token, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(table_no) DO UPDATE SET label = excluded.label, token = excluded.token,
           enabled = excluded.enabled, updated_at = excluded.updated_at`,
        table,
        String(input.label ?? current?.label ?? "").trim(),
        token,
        bool(input.enabled, current ? Boolean(current.enabled) : true) ? 1 : 0,
        current?.created_at ?? timestamp,
        timestamp
      );
      return tableView(await first("SELECT * FROM restaurant_tables WHERE table_no = ?", table));
    },
    deleteTable: async (table) => (await run("DELETE FROM restaurant_tables WHERE table_no = ?", normalizeTableNo(table))) > 0,
    setTableLock: async (table, locked) => {
      const tableNo = normalizeTableNo(table);
      if (!await first("SELECT table_no FROM restaurant_tables WHERE table_no = ?", tableNo)) return null;
      const timestamp = now();
      await run("UPDATE restaurant_tables SET locked_at = ?, updated_at = ? WHERE table_no = ?", locked ? timestamp : null, timestamp, tableNo);
      return tableView(await first("SELECT * FROM restaurant_tables WHERE table_no = ?", tableNo));
    },

    /**
     * Every table the floor has to look at, whether or not it is registered.
     *
     * An unregistered table with orders on it is real — someone scanned a card
     * that was deleted, or typed a number — so it appears as seated rather
     * than not appearing at all.
     */
    tablesOverview: async () => {
      const orderRows = await all("SELECT * FROM orders WHERE billed_at IS NULL AND status <> 'cancelled' ORDER BY table_no, created_at");
      const byTable = new Map();
      for (const row of orderRows) {
        const list = byTable.get(row.table_no) ?? [];
        list.push(await viewOrder(row));
        byTable.set(row.table_no, list);
      }
      const rows = await all("SELECT * FROM restaurant_tables ORDER BY table_no");
      const known = new Set(rows.map((row) => row.table_no));
      const overview = rows.map((row) => tableOverviewView(row, byTable.get(row.table_no) ?? []));
      for (const [tableNo, orders] of byTable) {
        if (!known.has(tableNo)) overview.push(tableOverviewView(null, orders, tableNo));
      }
      return overview.sort((left, right) => left.table.localeCompare(right.table, "en", { numeric: true }));
    },
    openBillTables: async () =>
      (await all("SELECT DISTINCT table_no FROM orders WHERE billed_at IS NULL AND status <> 'cancelled' ORDER BY table_no"))
        .map((row) => row.table_no),

    billForTable,

    /**
     * Settling: mark the table's orders billed, release the lock, and queue the
     * bill for the front printer.
     *
     * D1 has no interactive transaction, so the bill is read first and the
     * three writes go in one `batch()`, which is atomic. Two waiters settling
     * the same table at once would otherwise both read the same bill and both
     * queue a ticket, so the INSERT is conditional in SQL and sits before the
     * UPDATE: inside the batch it still sees the orders as unbilled, and the
     * loser's INSERT matches nothing. That is the same race the order write
     * hands to the UNIQUE index, solved the same way — in the database.
     */
    settleTableBill: async (tableNo) => {
      const table = String(tableNo);
      const bill = await billForTable(table);
      if (!bill.orderIds.length) return null;
      const timestamp = now();
      const jobId = uuid();
      const payload = JSON.stringify({ kind: "bill", ...bill, issuedAt: timestamp });
      await db.batch([
        db.prepare(
          `INSERT INTO print_jobs (id, order_id, printer_role, payload_json, status, created_at, updated_at)
           SELECT ?, ?, 'front', ?, 'queued', ?, ?
           WHERE EXISTS (SELECT 1 FROM orders WHERE table_no = ? AND billed_at IS NULL AND status <> 'cancelled')`
        ).bind(jobId, bill.orderIds[0], payload, timestamp, timestamp, table),
        db.prepare("UPDATE orders SET billed_at = ?, updated_at = ? WHERE table_no = ? AND billed_at IS NULL AND status <> 'cancelled'")
          .bind(timestamp, timestamp, table),
        // Paying is what frees the table, so the lock a waiter set before
        // printing the bill does not have to be cleared by hand afterwards.
        db.prepare("UPDATE restaurant_tables SET locked_at = NULL, updated_at = ? WHERE table_no = ?")
          .bind(timestamp, table.toUpperCase())
      ]);
      return { ...bill, issuedAt: timestamp, printJobId: jobId };
    },

    // A valid token used beyond its role is worth recording, not just refusing.
    recordAudit: async (entry) => {
      await run(
        "INSERT INTO audit_log (id, at, role, ip, method, route, status, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        uuid(), now(), String(entry.role), String(entry.ip ?? ""), String(entry.method),
        String(entry.route), Number(entry.status), JSON.stringify(entry.detail ?? {})
      );
    },
    listAudit: async (limit = 100) =>
      (await all("SELECT * FROM audit_log ORDER BY at DESC, rowid DESC LIMIT ?", boundedLimit(limit))).map(auditView),

    printerForRole: async (role) => {
      const row = await first("SELECT * FROM printer_profiles WHERE role = ? AND enabled = 1 ORDER BY name LIMIT 1", String(role));
      return printerView(row);
    }
  };
}

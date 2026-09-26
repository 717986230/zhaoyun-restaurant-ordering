/**
 * The D1 half of the backend.
 *
 * Every decision this makes — what a product row means, what an order costs,
 * which status may follow which — comes from shared/rules.mjs, the same module
 * the Node server uses. What lives here is only the part that cannot be shared:
 * `node:sqlite` is synchronous and D1 is not, and D1 has no interactive
 * transaction, so the order write that is a BEGIN/COMMIT over there is one
 * atomic `batch()` here.
 *
 * What that transaction also gives the Node server — nothing changes between
 * a read and the write that depends on it — the journal gives here. Every
 * order, receipt and closing writes the next journal entry, whose number is
 * the primary key, and reads the last one before anything else. Two writes
 * that read the same state both claim the same number; the second batch
 * fails whole, and `retrying` works it out again from what is there now.
 */
import {
  assertOrderTransition, assertPassword, assertRequestTransition, auditView,
  billView, bool, boundedLimit, duplicateInput, hashPassword, hashSessionToken, mapProduct, newSessionToken,
  normalizeMenuTheme, normalizePrinter, normalizeSettingsInput, normalizeProduct, normalizeTableNo, now,
  orderProductIds, orderView, parseJson, PASSWORD_ITERATIONS, planOrder, planPrintFailure, printerView,
  printJobView, serviceRequestView, settingsView, tablesOverviewView, tableView, uuid, RECENT_ORDERS_SQL, OPEN_TABLE_ORDERS_SQL,
  verifyPassword, normalizeCategoryName, renamedCategorySettings, bundleComponentIds, normalizeVatPercent
} from "../shared/rules.mjs";
import {
  CHECKOUT_ITEMS_SQL, closingPrintPayload, closingTotals, closingView, companyOf, CREDIT_VOUCHER_SQL, DEBIT_VOUCHER_SQL, INSERT_JOURNAL_SQL,
  INSERT_RECEIPT_SQL, INSERT_VOUCHER_SQL, journalEntry, journalText, journalView, normalizeVoucherCode, OPEN_RECEIPTS_SQL,
  ORDER_ITEMS_SQL, ORDER_PAID_SQL, orderJournalPayload, planCheckout, plannedReceiptView, planStorno, receiptPrintPayload,
  receiptRow, receiptView, REOPEN_ORDERS_SQL, SETTLE_PAID_TABLE_SQL, sha256Hex, UNLOCK_PAID_TABLE_SQL, verifyJournal, VOID_VOUCHER_SQL, VOID_ITEM_SQL, INSERT_VOID_SQL, planVoid
} from "../shared/register.mjs";
import {
  assertClaim, claimView, CLAIM_TTL_MS, holdsClaim, CLAIM_UPSERT_SQL, deviceView, isTakeaway, NEXT_PICKUP_SQL, normalizeDeviceName,
  normalizeStaffInput, OPEN_STAFF_RECEIPTS_SQL, POS_SESSION_TTL_MS, LIVE_POS_SESSIONS_SQL, OPEN_STAFF_VOIDS_SQL, SET_AVAILABLE_SQL, staffActivityView, settlementTotals, settlementView, staffView, TAKEAWAY_PREFIX
} from "../shared/pos.mjs";
import {
  ACCOUNT_BY_ID_SQL, ACCOUNT_BY_LOGIN_SQL, ACCOUNT_COUNT_SQL, ACCOUNT_SESSION_SQL, ACCOUNT_SESSION_TTL_MS, accountView, DELETE_ACCOUNT_SESSION_SQL,
  DELETE_ACCOUNT_SESSIONS_SQL, DELETE_EXPIRED_ACCOUNT_SESSIONS_SQL, INSERT_ACCOUNT_SESSION_SQL, MIGRATED_LOGIN, normalizeAccountName, normalizeLogin,
  normalizeRegistration, OWNER_ACCOUNT_SQL, REGISTER_ACCOUNT_SQL, storedPassword, UPDATE_ACCOUNT_SQL
} from "../shared/account.mjs";

// Matches server/database.mjs: a salt for nobody, so signing in against a
// console with no password costs the same PBKDF2 work as one with.
const ABSENT_PASSWORD_SALT = "AAAAAAAAAAAAAAAAAAAAAA==";

const PRODUCT_COLUMNS = [
  "id", "sku", "kind", "category", "name_zh", "name_de", "name_en", "description", "price_cents",
  "allergens_json", "prep_time", "portion", "level", "ingredients", "art", "pattern", "available",
  "published", "sort_order", "print_station", "modifiers_json", "vat_percent", "bundle_items_json", "created_at", "updated_at"
];

export function createStore(db) {
  const first = (sql, ...params) => db.prepare(sql).bind(...params).first();
  const all = async (sql, ...params) => (await db.prepare(sql).bind(...params).all()).results ?? [];
  const run = async (sql, ...params) => (await db.prepare(sql).bind(...params).run()).meta?.changes ?? 0;

  // SQLite binds at most 100 variables per statement, and the menu is 111
  // dishes, so an `IN (?, ?, ...)` over a whole catalogue fails outright.
  const BIND_LIMIT = 90;

  /** The last journal entry: read first, so a write that follows it cannot miss what came between. */
  const lastJournal = () => first("SELECT seq, hash FROM journal ORDER BY seq DESC LIMIT 1");

  async function journalStatement(last, kind, ref, payload, at) {
    const entry = journalEntry(last ?? null, kind, ref, payload, at);
    return db.prepare(INSERT_JOURNAL_SQL).bind(entry.seq, entry.at, entry.kind, entry.ref, entry.payloadJson, entry.prevHash, await sha256Hex(journalText(entry)));
  }

  const TAKEN = /UNIQUE constraint failed: (journal\.seq|receipts\.receipt_no|day_closings\.(closing_no|last_receipt_no))/;

  /** Runs `attempt` again while a concurrent write took its journal entry or number first. */
  async function retrying(attempt, tries = 6) {
    for (let round = 1; ; round += 1) {
      try {
        return await attempt();
      } catch (error) {
        if (round >= tries || !TAKEN.test(String(error?.message ?? error))) throw error;
      }
    }
  }

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
      // Same join as the Node server: pictures kept in media_files carry a credit.
      "SELECT product_media.*, media_files.credit AS credit FROM product_media LEFT JOIN media_files ON product_media.url = '/media/' || media_files.id WHERE product_media.product_id IN (?) ORDER BY product_media.sort_order, product_media.created_at",
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
           vat_percent = ?, bundle_items_json = ?, updated_at = ? WHERE id = ?`,
        product.sku, product.kind, product.category, product.nameZh, product.nameDe,
        product.nameEn, product.description, product.priceCents, product.allergensJson,
        product.prepTime, product.portion, product.level, product.ingredients, product.art,
        product.pattern, product.available, product.published, product.sortOrder,
        product.printStation, product.modifiersJson, product.vatPercent, product.bundleItemsJson, timestamp, product.id
      );
    } else {
      await run(
        `INSERT INTO products (${PRODUCT_COLUMNS.join(", ")}) VALUES (${PRODUCT_COLUMNS.map(() => "?").join(", ")})`,
        product.id, product.sku, product.kind, product.category, product.nameZh,
        product.nameDe, product.nameEn, product.description, product.priceCents,
        product.allergensJson, product.prepTime, product.portion, product.level,
        product.ingredients, product.art, product.pattern, product.available,
        product.published, product.sortOrder, product.printStation, product.modifiersJson, product.vatPercent, product.bundleItemsJson, timestamp, timestamp
      );
    }
    return getProduct(product.id);
  }

  /**
   * Every dish in one category moved to another name, and the settings that
   * name the category with it (its place among the first tabs, its names).
   * Onto an existing category, the two become one. Null when no dish is in
   * the category.
   */
  async function renameCategory(fromInput, toInput) {
    const from = normalizeCategoryName(fromInput);
    const to = normalizeCategoryName(toInput);
    if (from === to) throw new Error("The new name is the same as the old one");
    if (!await first("SELECT 1 FROM products WHERE category = ? LIMIT 1", from)) return null;
    // The dishes and the settings that name the category move in one atomic
    // batch: never dishes under a new name with pins and names left behind.
    const { rows } = normalizeSettingsInput(renamedCategorySettings(await getSettings(), from, to));
    const timestamp = now();
    const [moved] = await db.batch([
      db.prepare("UPDATE products SET category = ?, updated_at = ? WHERE category = ?").bind(to, timestamp, from),
      ...rows.map(([key, value]) => db.prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).bind(key, value, timestamp))
    ]);
    return { renamed: Number(moved.meta?.changes ?? 0), category: to, settings: await getSettings() };
  }

  /**
   * Every dish of one category at one VAT rate. Set menus are left alone:
   * their rate is their dishes' (vatSplit). Null when the category has no
   * dish this applies to.
   */
  async function setCategoryVat(categoryInput, percentInput) {
    const category = normalizeCategoryName(categoryInput);
    const vatPercent = normalizeVatPercent(percentInput);
    const updated = await run(
      "UPDATE products SET vat_percent = ?, updated_at = ? WHERE category = ? AND bundle_items_json IN ('', '[]')",
      vatPercent, now(), category
    );
    return updated ? { updated, category, vatPercent } : null;
  }

  /** A new, unpublished dish with everything the original had, photos included. */
  async function duplicateProduct(id) {
    const original = await getProduct(id);
    if (!original) return null;
    const copy = await saveProduct(duplicateInput(original));
    for (const media of original.media) {
      await run(
        "INSERT INTO product_media (id, product_id, type, url, poster_url, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        uuid(), copy.id, media.type, media.url, media.posterUrl || null, Number(media.sortOrder || 0), now()
      );
    }
    return getProduct(copy.id);
  }

  async function addMedia(productId, media) {
    if (!(await first("SELECT id FROM products WHERE id = ?", String(productId)))) return null;
    await run(
      "INSERT INTO product_media (id, product_id, type, url, poster_url, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      uuid(), String(productId), media.type, media.url, media.posterUrl || null, Number(media.sortOrder || 0), now()
    );
    return getProduct(productId);
  }

  /** D1 hands a BLOB back as an array of numbers or an ArrayBuffer, depending on the runtime. */
  async function getMediaFile(id) {
    const row = await first("SELECT content_type, bytes FROM media_files WHERE id = ?", String(id));
    return row ? { contentType: row.content_type, bytes: new Uint8Array(row.bytes) } : null;
  }

  /** A picture uploaded from the admin console, kept in D1: this deployment has no disk. */
  async function storeMedia(productId, { contentType, extension, bytes }) {
    if (!(await first("SELECT id FROM products WHERE id = ?", String(productId)))) return null;
    const fileId = `${uuid()}${extension}`;
    await run(
      "INSERT INTO media_files (id, content_type, bytes, credit, source_url, created_at) VALUES (?, ?, ?, NULL, NULL, ?)",
      fileId, contentType, bytes, now()
    );
    return addMedia(productId, { type: "image", url: `/media/${fileId}` });
  }

  async function viewOrder(row) {
    if (!row) return null;
    return orderView(row, await all(ORDER_ITEMS_SQL, row.id));
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
      const rows = await all(ORDER_ITEMS_SQL, order.id);
      itemsByOrderId.set(order.id, rows);
      for (const row of rows) productIds.add(String(row.product_id));
    }
    const productsById = new Map(
      (await selectByIds("SELECT * FROM products WHERE id IN (?)", [...productIds])).map((row) => [String(row.id), row])
    );
    return billView(tableNo, orders, itemsByOrderId, productsById);
  }

  async function createOrder(input, pos = null) {
    const requestId = String(input.clientRequestId || "");
    if (requestId) {
      const existing = await first("SELECT * FROM orders WHERE client_request_id = ?", requestId);
      if (existing) return viewOrder(existing);
    }

    return retrying(() => writeOrder(input, pos));
  }

  async function writeOrder(input, pos) {
    const last = await lastJournal();
    const ids = [...new Set(orderProductIds(input))];
    const products = new Map();
    for (const row of await selectByIds("SELECT * FROM products WHERE id IN (?)", ids)) {
      products.set(String(row.id), row);
    }
    // The dishes inside a set, for its VAT split.
    const parts = bundleComponentIds(products.values()).filter((partId) => !products.has(partId));
    if (parts.length) for (const row of await selectByIds("SELECT * FROM products WHERE id IN (?)", parts)) products.set(String(row.id), row);
    const { timeZone, setsSchedule } = await getSettings();
    const pickupNo = pos && isTakeaway(input.table) ? Number(String(input.table).slice(TAKEAWAY_PREFIX.length)) || null : null;
    const plan = planOrder(input, products, { timeZone, setsSchedule }, { staffName: pos?.staff?.name, pickupNo });
    const { id, orderNo, clientRequestId, table, note, totalCents, timestamp } = plan.order;

    // A locked table is one whose bill is being settled. Refusing here is the
    // whole point of the lock: an order that lands mid-settle is either missing
    // from the bill the guest just paid or reopens a table that was released.
    const tableRow = await first("SELECT locked_at FROM restaurant_tables WHERE table_no = ?", String(table).toUpperCase());
    // The lock is against guests adding to a bill being paid; the floor staff
    // who set it may still add to it. Another device's open table is theirs.
    if (pos) assertClaim(await first("SELECT * FROM table_claims WHERE table_no = ?", String(table).toUpperCase()), pos.deviceId);
    if (tableRow?.locked_at && !pos) {
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
      ...plan.items.map((item) => db.prepare("INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price_cents, print_station, modifiers_json, vat_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(item.id, item.orderId, item.productId, item.productName, item.quantity, item.unitPriceCents, item.printStation, item.modifiersJson, item.vatPercent)),
      ...plan.items.filter((item) => item.vatSplitJson).map((item) => db.prepare("INSERT INTO order_item_vat_splits (order_item_id, split_json) VALUES (?, ?)")
        .bind(item.id, item.vatSplitJson)),
      ...plan.printJobs.map((job) => db.prepare("INSERT INTO print_jobs (id, order_id, printer_role, payload_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)")
        .bind(job.id, job.orderId, job.printerRole, job.payloadJson, timestamp, timestamp)),
      ...(pos ? [db.prepare("INSERT INTO order_staff (order_id, staff_id, staff_name, pickup_no, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(id, pos.staff?.id ?? null, pos.staff?.name ?? null, pickupNo, timestamp)] : []),
      await journalStatement(last, "order.created", id, { ...orderJournalPayload(plan), ...(pos ? { staffName: pos.staff?.name ?? null, pickupNo } : {}) }, timestamp)
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
    return retrying(async () => {
      const last = await lastJournal();
      const current = await first("SELECT * FROM orders WHERE id = ?", String(id));
      if (!current) return null;
      assertOrderTransition(current.status, status);
      if (current.status === status) return viewOrder(current);
      // A paid line stays paid: cancelling it is a storno of its receipt.
      if (status === "cancelled" && await first(ORDER_PAID_SQL, current.id)) throw new Error("This order is on a receipt; cancel the receipt first");
      const at = now();
      await db.batch([
        db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?").bind(status, at, current.id),
        await journalStatement(last, "order.status", current.id, { orderId: current.id, orderNo: current.order_no, table: current.table_no, from: current.status, to: status }, at)
      ]);
      return viewOrder(await first("SELECT * FROM orders WHERE id = ?", current.id));
    });
  }

  async function receiptDetail(row) {
    if (!row) return null;
    const storno = await first("SELECT id FROM receipts WHERE refers_to = ?", row.id);
    const referred = row.refers_to ? await first("SELECT receipt_no FROM receipts WHERE id = ?", row.refers_to) : null;
    return receiptView(row, { cancelledBy: storno?.id ?? null, referredNo: referred?.receipt_no ?? null });
  }

  const printStatement = (payload, at) => db.prepare("INSERT INTO print_jobs (id, order_id, printer_role, payload_json, status, created_at, updated_at) VALUES (?, NULL, 'front', ?, 'queued', ?, ?)")
    .bind(uuid(), JSON.stringify(payload), at, at);

  /** A sale at the register (planCheckout): the receipt, and the table freed once it is all paid. */
  async function checkout(input, role, pos = null) {
    const requestId = String(input.clientRequestId || uuid());
    const existing = await first("SELECT * FROM receipts WHERE client_request_id = ?", requestId);
    if (existing) return receiptDetail(existing);
    return retrying(async () => {
      const last = await lastJournal();
      const ids = [...new Set((Array.isArray(input.items) ? input.items : []).map((item) => String(item.orderItemId)))];
      const itemRows = ids.length ? await selectByIds(CHECKOUT_ITEMS_SQL, ids) : [];
      const codes = [...new Set((Array.isArray(input.payments) ? input.payments : []).filter((payment) => payment.type === "voucher").map((payment) => normalizeVoucherCode(payment.voucherCode)))];
      const voucherRows = codes.length ? await selectByIds("SELECT * FROM vouchers WHERE code IN (?)", codes) : [];
      // Another device's open table is theirs to pay, before anything else is looked at.
      const openTable = input.table || itemRows[0]?.table_no;
      if (pos && openTable) assertClaim(await first("SELECT * FROM table_claims WHERE table_no = ?", String(openTable).toUpperCase()), pos.deviceId);
      const settings = await getSettings();
      const plan = planCheckout({ ...input, clientRequestId: requestId }, {
        itemRows, voucherRows, receiptNo: ((await first("SELECT MAX(receipt_no) AS no FROM receipts"))?.no ?? 0) + 1, settings, role, staff: pos?.staff ?? null
      });
      const at = plan.receipt.createdAt;
      const view = plannedReceiptView(plan.receipt);
      const table = plan.receipt.table;
      const statements = [
        db.prepare(INSERT_RECEIPT_SQL).bind(...receiptRow(plan.receipt)),
        ...plan.receiptItems.map((item) => db.prepare("INSERT INTO receipt_items (receipt_id, order_item_id, quantity) VALUES (?, ?, ?)").bind(plan.receipt.id, item.orderItemId, item.quantity)),
        ...plan.vouchers.map((voucher) => db.prepare(INSERT_VOUCHER_SQL).bind(voucher.code, voucher.valueCents, voucher.valueCents, plan.receipt.id, at, at)),
        ...plan.voucherDebits.map((debit) => db.prepare(DEBIT_VOUCHER_SQL).bind(debit.amountCents, at, debit.code)),
        ...(table ? [
          db.prepare(SETTLE_PAID_TABLE_SQL).bind(at, at, table, table),
          db.prepare(UNLOCK_PAID_TABLE_SQL).bind(at, table.toUpperCase(), table)
        ] : []),
        printStatement(receiptPrintPayload(view, settings), at),
        await journalStatement(last, "receipt.issued", plan.receipt.id, view, at)
      ];
      try {
        await db.batch(statements);
      } catch (error) {
        const committed = await first("SELECT * FROM receipts WHERE client_request_id = ?", requestId);
        if (committed) return receiptDetail(committed);
        throw error;
      }
      return receiptDetail(await first("SELECT * FROM receipts WHERE id = ?", plan.receipt.id));
    });
  }

  /** Cancels a receipt with a storno receipt (planStorno). Null when there is no such receipt. */
  async function stornoReceipt(id, reason, role, pos = null) {
    return retrying(async () => {
      const last = await lastJournal();
      const original = await first("SELECT * FROM receipts WHERE id = ?", String(id));
      if (!original) return null;
      if (await first("SELECT id FROM receipts WHERE refers_to = ?", original.id)) throw new Error("This receipt has already been cancelled");
      const settings = await getSettings();
      const plan = planStorno(original, {
        receiptNo: ((await first("SELECT MAX(receipt_no) AS no FROM receipts"))?.no ?? 0) + 1,
        reason,
        soldVoucherRows: await all("SELECT * FROM vouchers WHERE sold_receipt_id = ?", original.id),
        role,
        staff: pos?.staff ?? null
      });
      const at = plan.receipt.createdAt;
      const view = plannedReceiptView(plan.receipt, original.receipt_no);
      await db.batch([
        db.prepare(INSERT_RECEIPT_SQL).bind(...receiptRow(plan.receipt)),
        ...plan.refunds.map((refund) => db.prepare(CREDIT_VOUCHER_SQL).bind(refund.amountCents, at, refund.code)),
        ...plan.voided.map((code) => db.prepare(VOID_VOUCHER_SQL).bind(at, at, code)),
        db.prepare(REOPEN_ORDERS_SQL).bind(at, original.id),
        printStatement(receiptPrintPayload(view, settings), at),
        await journalStatement(last, "receipt.storno", plan.receipt.id, view, at)
      ]);
      return receiptDetail(await first("SELECT * FROM receipts WHERE id = ?", plan.receipt.id));
    });
  }

  /** The day's closing (Z report) over the receipts since the last one. Null when there are none. */
  async function closeDay(role) {
    return retrying(async () => {
      const last = await lastJournal();
      const rows = await all(OPEN_RECEIPTS_SQL);
      if (!rows.length) return null;
      const totals = closingTotals(rows);
      const id = uuid();
      const at = now();
      const closingNo = ((await first("SELECT MAX(closing_no) AS no FROM day_closings"))?.no ?? 0) + 1;
      const view = closingView({ id, closing_no: closingNo, totals_json: JSON.stringify(totals), created_at: at });
      await db.batch([
        db.prepare("INSERT INTO day_closings (id, closing_no, first_receipt_no, last_receipt_no, totals_json, staff_role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(id, closingNo, totals.firstReceiptNo, totals.lastReceiptNo, JSON.stringify(totals), role, at),
        printStatement(closingPrintPayload(view, await getSettings()), at),
        await journalStatement(last, "day.closed", id, view, at)
      ]);
      return closingView(await first("SELECT * FROM day_closings WHERE id = ?", id));
    });
  }

  /** The journal between two days (from inclusive, to exclusive), checked link by link. */
  async function exportJournal(from, to) {
    const rows = await all("SELECT * FROM journal WHERE at >= ? AND at < ? ORDER BY seq", from, to);
    const before = rows.length && rows[0].seq > 1 ? await first("SELECT * FROM journal WHERE seq = ?", rows[0].seq - 1) : null;
    return { entries: rows.map(journalView), verification: await verifyJournal(rows, before) };
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

  // ——— The account (shared/account.mjs): the same decisions server/database.mjs
  // makes; only the reads and writes differ.

  async function accountStatus() {
    return { registered: (await first(ACCOUNT_COUNT_SQL)).count > 0 };
  }

  async function openAccountSession(row) {
    const token = newSessionToken();
    const timestamp = now();
    await run(DELETE_EXPIRED_ACCOUNT_SESSIONS_SQL, timestamp);
    await run(INSERT_ACCOUNT_SESSION_SQL, await hashSessionToken(token), row.id, new Date(Date.now() + ACCOUNT_SESSION_TTL_MS).toISOString(), timestamp);
    return { token, expiresInMs: ACCOUNT_SESSION_TTL_MS, account: accountView(row) };
  }

  async function registerAccount(input) {
    const { login, name, password } = normalizeRegistration(input);
    const stored = await hashPassword(password);
    const timestamp = now();
    const id = uuid();
    if (!(await run(REGISTER_ACCOUNT_SQL, id, login, name, stored.hash, stored.salt, stored.iterations, timestamp, timestamp))) return null;
    return openAccountSession(await first(ACCOUNT_BY_ID_SQL, id));
  }

  async function signInAccount(loginInput, password) {
    const row = await first(ACCOUNT_BY_LOGIN_SQL, String(loginInput ?? "").trim().toLowerCase());
    const stored = row ? storedPassword(row) : { hash: "", salt: ABSENT_PASSWORD_SALT, iterations: PASSWORD_ITERATIONS };
    const correct = await verifyPassword(String(password ?? ""), stored);
    return row && correct ? openAccountSession(row) : null;
  }

  async function updateAccount(accountId, input) {
    const row = await first(ACCOUNT_BY_ID_SQL, String(accountId));
    if (!row || !(await verifyPassword(String(input?.currentPassword ?? ""), storedPassword(row)))) return null;
    const login = input.login === undefined ? row.login : normalizeLogin(input.login);
    const name = input.name === undefined ? row.name : normalizeAccountName(input.name, login);
    const stored = input.password === undefined ? storedPassword(row) : await hashPassword(assertPassword(input.password));
    if (login !== row.login && (await first(ACCOUNT_BY_LOGIN_SQL, login))) throw new Error("That account name is taken");
    await run(UPDATE_ACCOUNT_SQL, login, name, stored.hash, stored.salt, stored.iterations, now(), row.id);
    if (input.password !== undefined) await run(DELETE_ACCOUNT_SESSIONS_SQL, row.id);
    const updated = await first(ACCOUNT_BY_ID_SQL, row.id);
    return input.password !== undefined ? openAccountSession(updated) : { account: accountView(updated) };
  }

  async function recoverAccount(input) {
    const owner = await first(OWNER_ACCOUNT_SQL);
    if (!owner) {
      await registerAccount({ login: input?.login ?? MIGRATED_LOGIN, name: input?.name, password: input?.password });
      return { account: accountView(await first(OWNER_ACCOUNT_SQL)) };
    }
    const login = input?.login === undefined ? owner.login : normalizeLogin(input.login);
    const stored = await hashPassword(assertPassword(input?.password));
    await run(UPDATE_ACCOUNT_SQL, login, normalizeAccountName(input?.name ?? owner.name, login), stored.hash, stored.salt, stored.iterations, now(), owner.id);
    await run(DELETE_ACCOUNT_SESSIONS_SQL, owner.id);
    return { account: accountView(await first(ACCOUNT_BY_ID_SQL, owner.id)) };
  }

  async function roleForSession(token) {
    if (!token) return null;
    const tokenHash = await hashSessionToken(token);
    const row = await first(ACCOUNT_SESSION_SQL, tokenHash);
    // Not the account's: a waiter signed in on a POS device, perhaps.
    if (!row) return posSession(token);
    if (row.expires_at <= now()) {
      await run(DELETE_ACCOUNT_SESSION_SQL, tokenHash);
      return null;
    }
    return { role: "manager", account: accountView(row) };
  }

  // ——— The POS (shared/pos.mjs): devices, waiters, open tables, takeaway, settlement.

  async function pairDevice(nameInput) {
    const name = normalizeDeviceName(nameInput);
    const token = newSessionToken();
    const id = uuid();
    await run("INSERT INTO pos_devices (id, name, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, NULL)", id, name, await hashSessionToken(token), now());
    return { device: deviceView(await first("SELECT * FROM pos_devices WHERE id = ?", id)), token };
  }

  async function deviceForToken(token) {
    if (!token) return null;
    const row = await first("SELECT * FROM pos_devices WHERE token_hash = ?", await hashSessionToken(token));
    if (row) await run("UPDATE pos_devices SET last_seen_at = ? WHERE id = ?", now(), row.id);
    return row ?? null;
  }

  async function saveStaff(input, id = null) {
    const current = id ? await first("SELECT * FROM staff WHERE id = ?", String(id)) : null;
    if (id && !current) return null;
    const staff = normalizeStaffInput(input, current);
    const at = now();
    try {
      if (current) {
        const pin = staff.pin ? await hashPassword(staff.pin) : null;
        await db.batch([
          db.prepare("UPDATE staff SET name = ?, role = ?, active = ?, updated_at = ? WHERE id = ?").bind(staff.name, staff.role, staff.active ? 1 : 0, at, current.id),
          ...(pin ? [db.prepare("UPDATE staff SET pin_hash = ?, pin_salt = ?, pin_iterations = ?, updated_at = ? WHERE id = ?").bind(pin.hash, pin.salt, pin.iterations, at, current.id)] : []),
          // A waiter switched off, or given a new PIN, is signed out everywhere.
          ...(!staff.active || pin ? [db.prepare("DELETE FROM pos_sessions WHERE staff_id = ?").bind(current.id)] : [])
        ]);
        return staffView(await first("SELECT * FROM staff WHERE id = ?", current.id));
      }
      const { hash, salt, iterations } = await hashPassword(staff.pin);
      const newId = uuid();
      await run("INSERT INTO staff (id, name, role, pin_hash, pin_salt, pin_iterations, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        newId, staff.name, staff.role, hash, salt, iterations, staff.active ? 1 : 0, at, at);
      return staffView(await first("SELECT * FROM staff WHERE id = ?", newId));
    } catch (error) {
      if (/UNIQUE constraint failed: staff\.name/.test(String(error?.message))) throw new Error("There is already a waiter of that name");
      throw error;
    }
  }

  async function posSignIn(device, staffId, pin) {
    const row = await first("SELECT * FROM staff WHERE id = ?", String(staffId ?? ""));
    const stored = row ? { hash: row.pin_hash, salt: row.pin_salt, iterations: row.pin_iterations } : { hash: "", salt: ABSENT_PASSWORD_SALT, iterations: PASSWORD_ITERATIONS };
    const correct = await verifyPassword(String(pin ?? ""), stored);
    if (!row || !row.active || !correct) return null;
    const token = newSessionToken();
    await run("INSERT INTO pos_sessions (token_hash, staff_id, device_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
      await hashSessionToken(token), row.id, device.id, new Date(Date.now() + POS_SESSION_TTL_MS).toISOString(), now());
    return { token, staff: staffView(row), expiresInMs: POS_SESSION_TTL_MS };
  }

  async function posSession(token) {
    const row = await first(
      "SELECT pos_sessions.*, staff.name AS staff_name, staff.role AS staff_role, staff.active AS staff_active FROM pos_sessions JOIN staff ON staff.id = pos_sessions.staff_id WHERE token_hash = ?",
      await hashSessionToken(token)
    );
    if (!row) return null;
    if (row.expires_at <= now() || !row.staff_active) {
      await run("DELETE FROM pos_sessions WHERE token_hash = ?", row.token_hash);
      return null;
    }
    return { role: row.staff_role === "manager" ? "manager" : "staff", staff: { id: row.staff_id, name: row.staff_name }, deviceId: row.device_id };
  }

  async function claimTable(tableInput, pos) {
    const table = String(tableInput).trim().toUpperCase();
    const at = now();
    await run(CLAIM_UPSERT_SQL, table, pos.deviceId, pos.staff?.id ?? null, pos.staff?.name ?? null, new Date(Date.now() + CLAIM_TTL_MS).toISOString(), at);
    const row = await first("SELECT * FROM table_claims WHERE table_no = ?", table);
    assertClaim(row, pos.deviceId, at);
    return claimView(row, at);
  }

  async function holdsTable(tableInput, deviceId) {
    return holdsClaim(await first("SELECT * FROM table_claims WHERE table_no = ?", String(tableInput).trim().toUpperCase()), deviceId);
  }

  async function newTakeaway(pos) {
    const since = `${now().slice(0, 10)}T00:00:00.000Z`;
    let next = (await first(NEXT_PICKUP_SQL, since))?.next ?? 1;
    for (;; next += 1) {
      try {
        return { table: `${TAKEAWAY_PREFIX}${next}`, pickupNo: next, claim: await claimTable(`${TAKEAWAY_PREFIX}${next}`, pos) };
      } catch (error) {
        if (error.code !== "TABLE_CLAIMED") throw error;
      }
    }
  }

  async function moveTable(fromInput, toInput, pos) {
    const from = normalizeTableNo(fromInput);
    const to = normalizeTableNo(toInput);
    if (from === to) throw new Error("That is the same table");
    return retrying(async () => {
      const last = await lastJournal();
      assertClaim(await first("SELECT * FROM table_claims WHERE table_no = ?", from), pos.deviceId);
      assertClaim(await first("SELECT * FROM table_claims WHERE table_no = ?", to), pos.deviceId);
      const open = (await first("SELECT COUNT(*) AS n FROM orders WHERE table_no = ? AND billed_at IS NULL AND status <> 'cancelled'", from))?.n ?? 0;
      if (!open) return null;
      const at = now();
      await db.batch([
        db.prepare("UPDATE orders SET table_no = ?, updated_at = ? WHERE table_no = ? AND billed_at IS NULL AND status <> 'cancelled'").bind(to, at, from),
        db.prepare("DELETE FROM table_claims WHERE table_no = ? AND device_id = ?").bind(from, pos.deviceId),
        await journalStatement(last, "table.moved", from, { from, to, orders: open, staffName: pos.staff?.name ?? null }, at)
      ]);
      return { from, to, moved: open };
    });
  }

  async function reprintReceipt(id) {
    const view = await receiptDetail(await first("SELECT * FROM receipts WHERE id = ?", String(id)));
    if (!view) return false;
    const at = now();
    await printStatement(receiptPrintPayload(view, await getSettings(), { copy: true }), at).run();
    return true;
  }

  async function setAvailable(id, available) {
    if (!(await run(SET_AVAILABLE_SQL, available ? 1 : 0, now(), String(id)))) return null;
    return getProduct(String(id));
  }

  /**
   * Takes dishes sent to the kitchen off this table's bill (shared/register.mjs,
   * planVoid). Two voids of the same dish at once read the same journal entry;
   * the second batch fails on its number and is worked out again.
   */
  async function voidItem(tableInput, input, pos, role) {
    const table = normalizeTableNo(tableInput);
    return retrying(async () => {
      const last = await lastJournal();
      assertClaim(await first("SELECT * FROM table_claims WHERE table_no = ?", table), pos.deviceId);
      const at = now();
      const plan = planVoid(input, await first(VOID_ITEM_SQL, String(input?.orderItemId ?? "")), { table, staff: pos.staff, role, at });
      const entry = plan.void;
      await db.batch([
        db.prepare(INSERT_VOID_SQL).bind(entry.id, entry.orderItemId, entry.orderId, entry.table, entry.quantity, entry.amountCents, entry.reason, entry.staffId, entry.staffName, at),
        db.prepare("INSERT INTO print_jobs (id, order_id, printer_role, payload_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)")
          .bind(plan.printJob.id, plan.printJob.orderId, plan.printJob.printerRole, plan.printJob.payloadJson, at, at),
        await journalStatement(last, plan.journal.kind, plan.journal.ref, plan.journal.payload, at),
        // The last open dish voided, and the rest paid: the table is settled.
        db.prepare(SETTLE_PAID_TABLE_SQL).bind(at, at, table, table),
        db.prepare(UNLOCK_PAID_TABLE_SQL).bind(at, table, table)
      ]);
      return { id: entry.id, orderItemId: entry.orderItemId, quantity: entry.quantity, amountCents: entry.amountCents, reason: entry.reason, staffName: entry.staffName, createdAt: at };
    });
  }

  async function settleStaff(staffId, role) {
    return retrying(async () => {
      const last = await lastJournal();
      const staff = await first("SELECT * FROM staff WHERE id = ?", String(staffId));
      const rows = staff ? await all(OPEN_STAFF_RECEIPTS_SQL, staff.id, staff.id) : [];
      if (!rows.length) return null;
      const totals = settlementTotals(rows, await all(OPEN_STAFF_VOIDS_SQL, staff.id, staff.id));
      const id = uuid();
      const at = now();
      const view = settlementView({ id, staff_id: staff.id, staff_name: staff.name, totals_json: JSON.stringify(totals), created_at: at });
      await db.batch([
        db.prepare("INSERT INTO staff_settlements (id, staff_id, staff_name, last_receipt_no, totals_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .bind(id, staff.id, staff.name, totals.lastReceiptNo, JSON.stringify(totals), at),
        printStatement({ kind: "settlement", company: companyOf(await getSettings()), settlement: view }, at),
        await journalStatement(last, "staff.settled", id, { ...view, by: role }, at)
      ]);
      return settlementView(await first("SELECT * FROM staff_settlements WHERE id = ?", id));
    });
  }

  async function signOut(token) {
    if (!token) return false;
    return (await run(DELETE_ACCOUNT_SESSION_SQL, await hashSessionToken(token))) > 0;
  }

  async function getSettings() {
    const values = Object.fromEntries((await all("SELECT key, value FROM app_settings")).map((row) => [row.key, row.value]));
    return settingsView(await first("SELECT * FROM restaurant_settings WHERE id = 1"), values);
  }

  /** Any subset of the settings may come; the ones left out keep their value.
   *  All of it is checked before any of it is written. */
  async function saveSettings(input) {
    const { menuTheme, rows } = normalizeSettingsInput(input);
    const timestamp = now();
    if (menuTheme !== undefined) {
      await run(
        `INSERT INTO restaurant_settings (id, menu_theme, updated_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET menu_theme = excluded.menu_theme, updated_at = excluded.updated_at`,
        menuTheme, timestamp
      );
    }
    for (const [key, value] of rows) {
      await run(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        key, value, timestamp
      );
    }
    return getSettings();
  }

  return {
    listProducts,
    getProduct,
    saveProduct,
    deleteProduct: async (id) => (await run("DELETE FROM products WHERE id = ?", String(id))) > 0,
    addMedia,
    duplicateProduct,
    renameCategory,
    setCategoryVat,
    getMediaFile,
    storeMedia,
    listOrders: async (limit = 100) => {
      const rows = await all(RECENT_ORDERS_SQL, boundedLimit(limit));
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
    accountStatus,
    registerAccount,
    signInAccount,
    updateAccount,
    recoverAccount,
    signOut,
    roleForSession,
    pairDevice,
    deviceForToken,
    listDevices: async () => (await all("SELECT * FROM pos_devices ORDER BY created_at")).map(deviceView),
    deleteDevice: async (id) => (await run("DELETE FROM pos_devices WHERE id = ?", String(id))) > 0,
    listStaff: async (activeOnly = false) => (await all("SELECT * FROM staff ORDER BY active DESC, name")).filter((row) => !activeOnly || row.active).map(staffView),
    saveStaff,
    posSignIn,
    posSignOut: async (token) => (token ? (await run("DELETE FROM pos_sessions WHERE token_hash = ?", await hashSessionToken(token))) > 0 : false),
    claimTable,
    holdsTable,
    voidItem,
    reprintReceipt,
    setAvailable,
    releaseTable: async (table, pos, force = false) =>
      (await run("DELETE FROM table_claims WHERE table_no = ? AND (device_id = ? OR ? = 1)", String(table).trim().toUpperCase(), pos.deviceId, force ? 1 : 0)) > 0,
    liveClaims: async () => (await all("SELECT * FROM table_claims WHERE expires_at > ?", now())).map((row) => claimView(row)),
    newTakeaway,
    moveTable,
    settleStaff,
    staffSettlementPreview: async (staffId) => settlementTotals(await all(OPEN_STAFF_RECEIPTS_SQL, String(staffId), String(staffId)), await all(OPEN_STAFF_VOIDS_SQL, String(staffId), String(staffId))),
    listSettlements: async (limit = 30) => (await all("SELECT * FROM staff_settlements ORDER BY created_at DESC LIMIT ?", Math.min(Number(limit) || 30, 200))).map(settlementView),
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
      const orders = [];
      for (const row of await all(OPEN_TABLE_ORDERS_SQL)) orders.push(await viewOrder(row));
      const claims = (await all("SELECT * FROM table_claims WHERE expires_at > ?", now())).map((row) => claimView(row));
      return tablesOverviewView(await all("SELECT * FROM restaurant_tables ORDER BY table_no"), orders, claims);
    },
    staffActivity: async () => {
      const staffRows = await all("SELECT * FROM staff ORDER BY active DESC, name");
      const shifts = new Map();
      for (const row of staffRows) shifts.set(row.id, settlementTotals(await all(OPEN_STAFF_RECEIPTS_SQL, row.id, row.id), await all(OPEN_STAFF_VOIDS_SQL, row.id, row.id)));
      const claims = (await all("SELECT * FROM table_claims WHERE expires_at > ?", now())).map((row) => claimView(row));
      return staffActivityView(staffRows, await all(LIVE_POS_SESSIONS_SQL, now()), claims, shifts);
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
    /**
     * The table's bill on the front printer: what is still to pay, for the
     * guest to read. An interim bill, not a receipt — it frees nothing and
     * marks nothing paid. Paying is a receipt (checkout).
     */
    printTableBill: async (tableNo) => {
      const bill = await billForTable(String(tableNo));
      if (!bill.items.length) return null;
      const jobId = uuid();
      const timestamp = now();
      await run(
        "INSERT INTO print_jobs (id, order_id, printer_role, payload_json, status, created_at, updated_at) VALUES (?, ?, 'front', ?, 'queued', ?, ?)",
        jobId, bill.orderIds[0], JSON.stringify({ kind: "bill", ...bill, issuedAt: timestamp }), timestamp, timestamp
      );
      return { ...bill, issuedAt: timestamp, printJobId: jobId };
    },
    checkout,
    stornoReceipt,
    closeDay,
    exportJournal,
    closingPreview: async () => closingTotals(await all(OPEN_RECEIPTS_SQL)),
    listClosings: async (limit = 30) => (await all("SELECT * FROM day_closings ORDER BY closing_no DESC LIMIT ?", Math.min(Number(limit) || 30, 366))).map(closingView),
    listReceipts: async (limit = 50) => Promise.all((await all("SELECT * FROM receipts ORDER BY receipt_no DESC LIMIT ?", boundedLimit(limit, 50))).map(receiptDetail)),
    getReceipt: async (id) => receiptDetail(await first("SELECT * FROM receipts WHERE id = ?", String(id))),
    getVoucher: async (code) => {
      const row = await first("SELECT * FROM vouchers WHERE code = ?", normalizeVoucherCode(code));
      return row ? { code: row.code, valueCents: row.value_cents, balanceCents: row.balance_cents, voided: Boolean(row.voided_at), createdAt: row.created_at } : null;
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

/**
 * The store: every read and write the API makes, over any SQLite — the one
 * implementation both backends run (the Node server over node:sqlite, the
 * Worker over D1).
 *
 * Every decision — what a product row means, what an order costs, which
 * status may follow which — comes from the rule modules next to this one.
 * What lives here is reading the rows those rules need and writing the rows
 * they plan, through `driver` (server/sqlite-driver.mjs, workers/d1-driver.mjs):
 *
 *   first(sql, ...params) → row | null
 *   all(sql, ...params)   → rows
 *   run(sql, ...params)   → rows changed
 *   batch([[sql, params], …]) → rows changed by each, all or nothing
 *
 * D1 has no interactive transaction, so nothing here relies on one. What a
 * transaction would give — nothing changes between a read and the write that
 * depends on it — the journal gives: every order, receipt and closing writes
 * the next journal entry, whose number is the primary key, and reads the last
 * one before anything else. Two writes that read the same state both claim
 * the same number; the second batch fails whole, and `retrying` works it out
 * again from what is there now. The same holds on node:sqlite, where batch
 * is a BEGIN IMMEDIATE … COMMIT.
 */
import { bool, boundedLimit, now, parseJson, uuid } from "./core.mjs";
import {
  ACCOUNT_TOKEN_TTL_MS,
  decryptPasswordForOwner,
  DEFAULT_TENANT_ID,
  encryptPasswordForOwner,
  normalizeTenantConfig,
  normalizeTenantName,
  normalizeTenantSlug,
  tenantView,
} from "./tenant.mjs";
import { assertPassword, auditView, hashPassword, hashSessionToken, newSessionToken, PASSWORD_ITERATIONS, verifyPassword } from "./auth.mjs";
import { bundleComponentIds, duplicateInput, mapProduct, normalizeProduct, normalizeVatPercent } from "./products.mjs";
import { normalizeCategoryName, normalizeSettingsInput, renamedCategorySettings, settingsView } from "./settings.mjs";
import {
  assertOrderTransition, assertRequestTransition, billView, normalizeTableNo, OPEN_TABLE_ORDERS_SQL, ORDER_BY_ID_SQL, ORDER_BY_REQUEST_SQL, orderProductIds, orderView, planOrder, RECENT_ORDERS_SQL, serviceRequestView, tablesOverviewView, tableView
} from "./orders.mjs";
import { discoveredPrinterView, normalizeBridgeReport, normalizePrinter, PRINT_STATIONS, planPrintFailure, planTestPrint, printBridgeView, printerView, printJobView } from "./printing.mjs";
import {
  CHECKOUT_ITEMS_SQL, closingPrintPayload, closingTotals, closingView, companyOf, INSERT_JOURNAL_SQL,
  journalEntry, journalText, journalView, normalizeVoucherCode,
  ORDER_ITEMS_SQL, ORDER_PAID_SQL, orderJournalPayload, planCheckout, plannedReceiptView, planStorno, planTopUp, receiptPrintPayload,
  receiptRow, receiptView, REOPEN_ORDERS_SQL, sha256Hex, verifyJournal, VOID_ITEM_SQL, planVoid, planUrge, planFire
} from "./register.mjs";
import {
  assertClaim, claimView, CLAIM_TTL_MS, holdsClaim, CLAIM_UPSERT_SQL, CLAIM_WITH_META_SQL, CLAIM_META_UPSERT_SQL, LIVE_CLAIMS_SQL, deviceView, isTakeaway, NEXT_PICKUP_SQL, normalizeDeviceName,
  normalizeStaffInput, OPEN_STAFF_RECEIPTS_SQL, POS_SESSION_TTL_MS, LIVE_POS_SESSIONS_SQL, OPEN_STAFF_VOIDS_SQL, SET_AVAILABLE_SQL, staffActivityView, settlementTotals, settlementView, staffView, TAKEAWAY_PREFIX
} from "./pos.mjs";
import {
  ACCOUNT_BY_ID_SQL, ACCOUNT_BY_LOGIN_SQL, ACCOUNT_COUNT_SQL, ACCOUNT_SESSION_SQL, ACCOUNT_TOKEN_SQL, ACCOUNT_SESSION_TTL_MS, accountView,
  ADMIN_ROLE, DELETE_ACCOUNT_SESSION_SQL,
  DELETE_ACCOUNT_SESSIONS_SQL, INSERT_ACCOUNT_SQL,
  INSERT_ACCOUNT_TOKEN_SQL, INSERT_TENANT_SQL, INSERT_TENANT_TOKEN_SQL, LIST_TENANTS_SQL, MIGRATED_LOGIN,
  normalizeAccountEmail, normalizeAccountName, normalizeLogin,
  normalizeRegistration, OWNER_ACCOUNT_SQL, OWNER_ROLE, REGISTER_ACCOUNT_SQL, storedPassword, TENANT_BY_ID_SQL,
  TENANT_BY_SLUG_SQL, TENANT_TOKEN_SQL, UPDATE_ACCOUNT_SQL, USE_ACCOUNT_TOKEN_SQL
} from "./account.mjs";
import {
  customerView, earnPointsStatements, isOverdrawn, refundBalanceStatements, refundPointsStatements, reverseBalanceStatements,
  reversePointsStatements, spendBalanceStatements, topUpBalanceStatements, topUpPointsStatements, welcomePointsStatements
} from "./customer.mjs";
import { createCustomerStore } from "./customer-store.mjs";
import { createDeliveryStore } from "./delivery-store.mjs";
import {
  CLOSE_DRAWER_SQL, countedOf, DRAWER_MOVEMENTS_SQL, DRAWER_RECEIPTS_SQL, drawerPrintPayload, drawerTotals, drawerView, floatOf, INSERT_DRAWER_SQL,
  INSERT_MOVEMENT_SQL, movementView, OPEN_DRAWER_SQL, planMovement
} from "./drawer.mjs";
import { assertStock, normalizeStockInput, restaurantDay, RETURN_STOCK_SQL, setStockStatement, stockDemand, stockView, takeStockStatements } from "./stock.mjs";
import { createReservationStore } from "./reservation-store.mjs";
import { createWaitlistStore } from "./waitlist-store.mjs";
import { appIconsView } from "./app-icons.mjs";
import {
  MEMBER_BALANCE_LEDGER_SQL, MEMBER_NEW_SQL, MEMBER_POINTS_LEDGER_SQL, MEMBER_TOP_BALANCE_SQL, MEMBER_TOP_POINTS_SQL,
  memberReport, REPORT_RECEIPTS_SQL, reportRange, salesReport
} from "./reports.mjs";
import {
  CLOSE_TABLE_SESSION_SQL, closePaidTableStatements, guestOrderError, LAST_CUSTOMER_PICKUP_SQL, LAST_TABLE_GUEST_ORDER_SQL, LIVE_TABLE_SESSIONS_SQL,
  moveTableSessionStatements, NEXT_GUEST_PICKUP_SQL, OPEN_PICKUPS_SQL, openTableStatements, pickupDayStart, planGuestOrder, TABLE_SESSION_SQL, tableSessionView
} from "./ordering.mjs";

// A salt for nobody: signing in against an account that does not exist costs
// the same PBKDF2 work as a wrong password, so timing says nothing.
const ABSENT_PASSWORD_SALT = "AAAAAAAAAAAAAAAAAAAAAA==";

const PRODUCT_COLUMNS = [
  "id", "tenant_id", "sku", "kind", "category", "name_zh", "name_de", "name_en", "description", "price_cents",
  "allergens_json", "prep_time", "portion", "level", "ingredients", "art", "pattern", "tag_color", "available",
  "published", "sort_order", "print_station", "print_printer_id", "modifiers_json", "vat_percent", "bundle_items_json", "created_at", "updated_at"
];

export const PRODUCT_INSERT_SQL = `INSERT INTO products (${PRODUCT_COLUMNS.join(", ")}) VALUES (${PRODUCT_COLUMNS.map(() => "?").join(", ")})`;

/** A normalized product (normalizeProduct) as PRODUCT_INSERT_SQL's parameters. */
export function productInsertParams(product, timestamp, tenantId = DEFAULT_TENANT_ID) {
  return [
    product.id, tenantId, product.sku, product.kind, product.category, product.nameZh,
    product.nameDe, product.nameEn, product.description, product.priceCents,
    product.allergensJson, product.prepTime, product.portion, product.level,
    product.ingredients, product.art, product.pattern, product.tagColor, product.available,
    product.published, product.sortOrder, product.printStation, product.printPrinterId, product.modifiersJson, product.vatPercent, product.bundleItemsJson, timestamp, timestamp
  ];
}

/** One statement for a batch. */
const sql = (text, ...params) => [text, params];

/** The printers, with what the print bridge last found at each. */
const PRINTERS_WITH_STATUS_SQL = `SELECT printer_profiles.*, printer_status.ok AS status_ok, printer_status.error AS status_error,
    printer_status.checked_at AS status_checked_at, printer_status.bridge_id AS status_bridge_id
  FROM printer_profiles LEFT JOIN printer_status ON printer_status.printer_id = printer_profiles.id
  WHERE printer_profiles.tenant_id = ?
  ORDER BY printer_profiles.role, printer_profiles.name`;

export function createStore(driver, options = {}) {
  const { first, all, run } = driver;
  const batch = (list) => driver.batch(list);

  /**
   * The tenant this store reads and writes: `options.tenantId`, or the
   * default tenant when none is named — the one all data predating tenants
   * lives under, so a store built without a tenant keeps working exactly as
   * before (fail-closed, the same rule the sub-stores' factories use). Every
   * statement below takes that tenant as its first bound parameter (after any
   * SET values in an UPDATE, the way the sub-stores do it).
   */
  const tenantId = options.tenantId ?? DEFAULT_TENANT_ID;
  /** The key the owner's password view uses, when one is configured (base64 of 32 bytes, or a CryptoKey). */
  const passwordViewKey = options.passwordViewKey ?? null;
  /** The same store for another tenant: a cheap closure allocation, per request. */
  const withTenant = (nextTenantId) => createStore(driver, { ...options, tenantId: nextTenantId });

  /**
   * What a receipt is stored as, with its tenant: INSERT_RECEIPT_SQL
   * (shared/register.mjs) carries no tenant column — the column default would
   * put every receipt under t_default — so the store writes its own. Values
   * are receiptRow's, with the tenant first.
   */
  const INSERT_RECEIPT_TENANT_SQL = `INSERT INTO receipts (tenant_id, id, receipt_no, client_request_id, cash_register_id, type, table_no,
    lines_json, vat_json, total_cents, payments_json, refers_to, reason, staff_role, created_at, staff_id, staff_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  /** The voucher statements, with their tenant: the register.mjs constants are keyed by code alone. */
  const INSERT_VOUCHER_TENANT_SQL = "INSERT INTO vouchers (tenant_id, code, value_cents, balance_cents, sold_receipt_id, voided_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)";
  const DEBIT_VOUCHER_TENANT_SQL = "UPDATE vouchers SET balance_cents = balance_cents - ?, updated_at = ? WHERE tenant_id = ? AND code = ? AND voided_at IS NULL";
  const CREDIT_VOUCHER_TENANT_SQL = "UPDATE vouchers SET balance_cents = balance_cents + ?, updated_at = ? WHERE tenant_id = ? AND code = ?";
  const VOID_VOUCHER_TENANT_SQL = "UPDATE vouchers SET balance_cents = 0, voided_at = ?, updated_at = ? WHERE tenant_id = ? AND code = ?";
  /** The receipts not yet in a day's closing, for this tenant: OPEN_RECEIPTS_SQL (register.mjs) reads across tenants. */
  const OPEN_RECEIPTS_TENANT_SQL = "SELECT * FROM receipts WHERE tenant_id = ? AND receipt_no > COALESCE((SELECT MAX(last_receipt_no) FROM day_closings WHERE tenant_id = ?), 0) ORDER BY receipt_no";
  /**
   * A table is paid when none of its open orders has a line with anything
   * left to pay — the tenant's own orders, on the tenant's own table. The
   * paid/voided subqueries are the ones in shared/register.mjs (not exported);
   * the ids they join on are globally unique, so they need no tenant of their own.
   */
  const TABLE_PAID_TENANT_SQL = `NOT EXISTS (
    SELECT 1 FROM order_items JOIN orders AS open_orders ON open_orders.id = order_items.order_id
    WHERE open_orders.tenant_id = ? AND open_orders.table_no = ? AND open_orders.billed_at IS NULL AND open_orders.status <> 'cancelled'
      AND order_items.quantity > (SELECT COALESCE(SUM(receipt_items.quantity), 0) FROM receipt_items
          WHERE receipt_items.order_item_id = order_items.id
            AND NOT EXISTS (SELECT 1 FROM receipts AS storno WHERE storno.refers_to = receipt_items.receipt_id))
        + (SELECT COALESCE(SUM(order_item_voids.quantity), 0) FROM order_item_voids
          WHERE order_item_voids.order_item_id = order_items.id))`;
  const SETTLE_PAID_TABLE_TENANT_SQL = `UPDATE orders SET billed_at = ?, updated_at = ?
    WHERE tenant_id = ? AND table_no = ? AND billed_at IS NULL AND status <> 'cancelled' AND ${TABLE_PAID_TENANT_SQL}`;
  const UNLOCK_PAID_TABLE_TENANT_SQL = `UPDATE restaurant_tables SET locked_at = NULL, updated_at = ?
    WHERE tenant_id = ? AND table_no = ? AND ${TABLE_PAID_TENANT_SQL}`;
  /** An account session, with its tenant: INSERT_ACCOUNT_SESSION_SQL (account.mjs) carries no tenant column. */
  const INSERT_ACCOUNT_SESSION_TENANT_SQL = "INSERT INTO account_sessions (tenant_id, token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)";
  const DELETE_EXPIRED_ACCOUNT_SESSIONS_TENANT_SQL = "DELETE FROM account_sessions WHERE tenant_id = ? AND expires_at <= ?";

  // SQLite binds at most 100 variables per statement, and the menu is 111
  // dishes, so an `IN (?, ?, ...)` over a whole catalogue fails outright.
  const BIND_LIMIT = 90;

  /** The last journal entry: read first, so a write that follows it cannot miss what came between. */
  const lastJournal = () => first("SELECT seq, hash FROM journal WHERE tenant_id = ? ORDER BY seq DESC LIMIT 1", tenantId);

  async function journalStatement(last, kind, ref, payload, at) {
    const entry = journalEntry(last ?? null, kind, ref, payload, at);
    return sql(INSERT_JOURNAL_SQL, tenantId, entry.seq, entry.at, entry.kind, entry.ref, entry.payloadJson, entry.prevHash, await sha256Hex(journalText(entry)));
  }

  // The composite keys: journal (tenant_id, seq), receipts (tenant_id, receipt_no), day_closings (tenant_id, closing_no / last_receipt_no).
  const TAKEN = /UNIQUE constraint failed: (journal\.(tenant_id, journal\.)?seq|receipts\.(tenant_id, receipts\.)?receipt_no|day_closings\.(tenant_id, day_closings\.)?(closing_no|last_receipt_no))/;

  /**
   * Runs `attempt` again while a concurrent write took its journal entry or
   * number first. Each try waits a little longer, by a random amount: at
   * rush hour eight tablets that all lost to the same write would otherwise
   * collide again, every one of them, on every try.
   */
  async function retrying(attempt, tries = 12) {
    for (let round = 1; ; round += 1) {
      try {
        return await attempt();
      } catch (error) {
        if (round >= tries || !TAKEN.test(String(error?.message ?? error))) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 15 * round));
      }
    }
  }

  /** `ids` fill the `(?)` in `sql`; `leading` params come before them (the tenant, first). */
  async function selectByIds(sql, ids, ...leading) {
    const rows = [];
    for (let index = 0; index < ids.length; index += BIND_LIMIT) {
      const slice = ids.slice(index, index + BIND_LIMIT);
      rows.push(...await all(sql.replace("(?)", `(${slice.map(() => "?").join(", ")})`), ...leading, ...slice));
    }
    return rows;
  }

  /** 12 random bytes, base64url, the same shape the Node server prints on a card. */
  function entryToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  // Same join as the Node server: pictures kept in media_files carry a credit.
  const MEDIA_SQL = "SELECT product_media.*, media_files.credit AS credit FROM product_media LEFT JOIN media_files ON product_media.url = '/media/' || media_files.id";
  const MEDIA_ORDER = " ORDER BY product_media.sort_order, product_media.created_at";

  /** `productIds` null: every dish's, in one query (the whole menu, not 100 ids at a time). */
  async function mediaFor(productIds) {
    if (productIds && !productIds.length) return new Map();
    const rows = productIds
      ? await selectByIds(`${MEDIA_SQL} WHERE product_media.tenant_id = ? AND product_media.product_id IN (?)${MEDIA_ORDER}`, productIds, tenantId)
      : await all(`${MEDIA_SQL} WHERE product_media.tenant_id = ?${MEDIA_ORDER}`, tenantId);
    if (!productIds) {
      const map = new Map();
      for (const row of rows) {
        if (!map.has(row.product_id)) map.set(row.product_id, []);
        map.get(row.product_id).push(row);
      }
      return map;
    }
    const map = new Map(productIds.map((id) => [id, []]));
    for (const row of rows) map.get(row.product_id)?.push(row);
    return map;
  }

  /** The dishes' limits and today's portions (shared/stock.mjs), by product id, and the restaurant's day. */
  async function stockFor(ids = null, timeZone = null) {
    const [rows, zone] = await Promise.all([
      ids ? selectByIds("SELECT * FROM product_stock WHERE tenant_id = ? AND product_id IN (?)", ids, tenantId) : all("SELECT * FROM product_stock WHERE tenant_id = ?", tenantId),
      timeZone ?? getSettings().then((settings) => settings.timeZone)
    ]);
    return { stock: new Map(rows.map((row) => [String(row.product_id), row])), today: restaurantDay(zone) };
  }

  async function getProduct(id) {
    const row = await first("SELECT * FROM products WHERE tenant_id = ? AND id = ?", tenantId, String(id));
    if (!row) return null;
    const media = await mediaFor([row.id]);
    const { stock, today } = await stockFor([String(row.id)]);
    return mapProduct(row, media.get(row.id), stockView(stock.get(String(row.id)), today));
  }

  /**
   * The dishes, each with its daily limit and what is left today. The guests'
   * catalogue (`publishedOnly`) leaves out what is sold out, by hand or by
   * count; the staff see it all, a dish counted out with `leftToday` 0.
   */
  /**
   * The menu, every guest's first request: the dishes, their pictures and
   * today's stock asked for at once (each is a round trip on D1), the
   * restaurant's time zone passed in when the caller has the settings already.
   */
  async function listProducts(publishedOnly = false, timeZone = null) {
    const [rows, media, { stock, today }] = await Promise.all([
      publishedOnly
        ? all("SELECT * FROM products WHERE tenant_id = ? AND published = 1 AND available = 1 ORDER BY sort_order, created_at", tenantId)
        : all("SELECT * FROM products WHERE tenant_id = ? ORDER BY sort_order, created_at", tenantId),
      mediaFor(null),
      stockFor(null, timeZone)
    ]);
    const products = rows.map((row) => mapProduct(row, media.get(row.id) ?? [], stockView(stock.get(String(row.id)), today)));
    return publishedOnly ? products.filter((product) => product.leftToday !== 0) : products;
  }

  /** A dish's daily limit, or today's portions, set by the floor or the owner (shared/stock.mjs). */
  async function setStock(id, input) {
    const change = normalizeStockInput(input);
    if (!(await first("SELECT id FROM products WHERE tenant_id = ? AND id = ?", tenantId, String(id)))) return null;
    const { stock, today } = await stockFor([String(id)]);
    await batch([setStockStatement(tenantId, sql, id, stock.get(String(id)), change, today, now())]);
    return getProduct(id);
  }

  async function saveProduct(input, id) {
    const current = id ? await first("SELECT * FROM products WHERE tenant_id = ? AND id = ?", tenantId, String(id)) : null;
    if (id && !current) return null;
    const product = normalizeProduct({ ...input, id: id || input.id }, current || {});
    const timestamp = now();
    if (current) {
      await run(
        `UPDATE products SET sku = ?, kind = ?, category = ?, name_zh = ?, name_de = ?,
           name_en = ?, description = ?, price_cents = ?, allergens_json = ?, prep_time = ?,
           portion = ?, level = ?, ingredients = ?, art = ?, pattern = ?, tag_color = ?, available = ?,
           published = ?, sort_order = ?, print_station = ?, print_printer_id = ?, modifiers_json = ?,
           vat_percent = ?, bundle_items_json = ?, updated_at = ? WHERE tenant_id = ? AND id = ?`,
        product.sku, product.kind, product.category, product.nameZh, product.nameDe,
        product.nameEn, product.description, product.priceCents, product.allergensJson,
        product.prepTime, product.portion, product.level, product.ingredients, product.art,
        product.pattern, product.tagColor, product.available, product.published, product.sortOrder,
        product.printStation, product.printPrinterId, product.modifiersJson, product.vatPercent, product.bundleItemsJson, timestamp, tenantId, product.id
      );
    } else {
      await run(PRODUCT_INSERT_SQL, ...productInsertParams(product, timestamp, tenantId));
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
    if (!await first("SELECT 1 FROM products WHERE tenant_id = ? AND category = ? LIMIT 1", tenantId, from)) return null;
    // The dishes and the settings that name the category move in one atomic
    // batch: never dishes under a new name with pins and names left behind.
    const { rows } = normalizeSettingsInput(renamedCategorySettings(await getSettings(), from, to));
    const timestamp = now();
    const [moved] = await batch([
      sql("UPDATE products SET category = ?, updated_at = ? WHERE tenant_id = ? AND category = ?", to, timestamp, tenantId, from),
      ...rows.map(([key, value]) => sql(
        `INSERT INTO app_settings (tenant_id, key, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      , tenantId, key, value, timestamp))
    ]);
    return { renamed: Number(moved ?? 0), category: to, settings: await getSettings() };
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
      "UPDATE products SET vat_percent = ?, updated_at = ? WHERE tenant_id = ? AND category = ? AND bundle_items_json IN ('', '[]')",
      vatPercent, now(), tenantId, category
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
        "INSERT INTO product_media (id, tenant_id, product_id, type, url, poster_url, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        uuid(), tenantId, copy.id, media.type, media.url, media.posterUrl || null, Number(media.sortOrder || 0), now()
      );
    }
    return getProduct(copy.id);
  }

  async function addMedia(productId, media) {
    if (!(await first("SELECT id FROM products WHERE tenant_id = ? AND id = ?", tenantId, String(productId)))) return null;
    await run(
      "INSERT INTO product_media (id, tenant_id, product_id, type, url, poster_url, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      uuid(), tenantId, String(productId), media.type, media.url, media.posterUrl || null, Number(media.sortOrder || 0), now()
    );
    return getProduct(productId);
  }

  /** A BLOB comes back as a Uint8Array, an ArrayBuffer or an array of numbers, depending on the runtime. */
  async function getMediaFile(id) {
    const row = await first("SELECT content_type, bytes FROM media_files WHERE tenant_id = ? AND id = ?", tenantId, String(id));
    return row ? { contentType: row.content_type, bytes: new Uint8Array(row.bytes) } : null;
  }

  /** A picture uploaded from the admin console, kept in the database (a Worker has no disk). */
  async function storeMedia(productId, { contentType, extension, bytes }) {
    if (!(await first("SELECT id FROM products WHERE tenant_id = ? AND id = ?", tenantId, String(productId)))) return null;
    const fileId = `${uuid()}${extension}`;
    await run(
      "INSERT INTO media_files (id, tenant_id, content_type, bytes, credit, source_url, created_at) VALUES (?, ?, ?, ?, NULL, NULL, ?)",
      fileId, tenantId, contentType, bytes, now()
    );
    return addMedia(productId, { type: "image", url: `/media/${fileId}` });
  }

  /**
   * The owner's own icons for the installed apps (shared/app-icons.mjs), kept
   * with the other pictures; app_settings says which files are whose.
   */
  async function storedAppIcons() {
    const row = await first("SELECT value FROM app_settings WHERE tenant_id = ? AND key = 'app_icons'", tenantId);
    const stored = parseJson(row?.value, {});
    return stored && typeof stored === "object" ? stored : {};
  }

  /** One of an app's icon files, or null while it wears the built one. */
  async function appIconFile(app, file) {
    const id = (await storedAppIcons())[app]?.files?.[file];
    return id ? getMediaFile(id) : null;
  }

  /** `files` maps each size's file name ("192", "maskable-512", …) to its PNG bytes; the old ones go. */
  async function saveAppIcon(app, files) {
    const icons = await storedAppIcons();
    const replaced = Object.values(icons[app]?.files ?? {});
    const timestamp = now();
    const ids = {};
    const statements = [];
    for (const [file, bytes] of Object.entries(files)) {
      ids[file] = `icon-${app}-${uuid()}.png`;
      statements.push(sql("INSERT INTO media_files (id, tenant_id, content_type, bytes, credit, source_url, created_at) VALUES (?, ?, 'image/png', ?, NULL, NULL, ?)", ids[file], tenantId, bytes, timestamp));
    }
    icons[app] = { version: uuid().slice(0, 8), updatedAt: timestamp, files: ids };
    statements.push(appIconsStatement(icons, timestamp));
    for (const id of replaced) statements.push(sql("DELETE FROM media_files WHERE tenant_id = ? AND id = ?", tenantId, id));
    await batch(statements);
    return appIconsView(icons);
  }

  /** Back to the built icon. */
  async function resetAppIcon(app) {
    const icons = await storedAppIcons();
    const replaced = Object.values(icons[app]?.files ?? {});
    delete icons[app];
    const timestamp = now();
    await batch([appIconsStatement(icons, timestamp), ...replaced.map((id) => sql("DELETE FROM media_files WHERE tenant_id = ? AND id = ?", tenantId, id))]);
    return appIconsView(icons);
  }

  function appIconsStatement(icons, timestamp) {
    return sql(
      `INSERT INTO app_settings (tenant_id, key, value, updated_at) VALUES (?, 'app_icons', ?, ?)
       ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      tenantId, JSON.stringify(icons), timestamp
    );
  }

  async function viewOrder(row) {
    if (!row) return null;
    return orderView(row, await all(ORDER_ITEMS_SQL, row.id));
  }

  /**
   * The same, for a list of orders at once: one query for every order's lines
   * instead of one per order (listOrders, tablesOverview). The order ids are
   * globally unique, so ORDER_ITEMS_SQL needs no tenant of its own.
   */
  async function viewOrders(rows) {
    if (!rows.length) return [];
    const items = await selectByIds(
      ORDER_ITEMS_SQL.replace("WHERE order_items.order_id = ?", "WHERE order_items.order_id IN (?)"),
      rows.map((row) => row.id),
    );
    const byOrder = new Map(rows.map((row) => [row.id, []]));
    for (const item of items) byOrder.get(item.order_id)?.push(item);
    return rows.map((row) => orderView(row, byOrder.get(row.id) ?? []));
  }

  /**
   * The VAT split itself lives in `shared/products.mjs`, so this computes a bill
   * the same way the Node server does rather than a second, guessed way. All
   * that is left here is reading the rows.
   */
  async function billForTable(tableNo) {
    const orders = await all(
      "SELECT * FROM orders WHERE tenant_id = ? AND table_no = ? AND billed_at IS NULL AND status <> 'cancelled' ORDER BY created_at",
      tenantId, String(tableNo)
    );
    // One query for every order's lines, not one per order.
    const itemRows = await selectByIds(
      ORDER_ITEMS_SQL.replace("WHERE order_items.order_id = ?", "WHERE order_items.order_id IN (?)"),
      orders.map((order) => order.id),
    );
    const itemsByOrderId = new Map(orders.map((order) => [order.id, []]));
    const productIds = new Set();
    for (const row of itemRows) {
      itemsByOrderId.get(row.order_id)?.push(row);
      productIds.add(String(row.product_id));
    }
    const productsById = new Map(
      (await selectByIds("SELECT * FROM products WHERE tenant_id = ? AND id IN (?)", [...productIds], tenantId)).map((row) => [String(row.id), row])
    );
    return billView(tableNo, orders, itemsByOrderId, productsById);
  }

  async function createOrder(input, pos = null, guest = null) {
    const requestId = String(input.clientRequestId || "");
    if (requestId) {
      const existing = await first(ORDER_BY_REQUEST_SQL, tenantId, requestId);
      if (existing) return viewOrder(existing);
    }

    return retrying(() => writeOrder(input, pos, guest));
  }

  /** What a guest's order is checked against (shared/ordering.mjs, assertGuestOrder). */
  async function guestReads(input, guest) {
    const at = new Date();
    const table = String(input.table ?? "").toUpperCase();
    const dineIn = guest.channel === "dine-in";
    const last = dineIn ? await first(LAST_TABLE_GUEST_ORDER_SQL, tenantId, table) : guest.customer ? await first(LAST_CUSTOMER_PICKUP_SQL, tenantId, guest.customer.id) : null;
    return {
      tableSession: dineIn ? await first(TABLE_SESSION_SQL, tenantId, table) : null,
      lastOrderAt: last?.at ?? null,
      openPickups: guest.customer ? Number((await first(OPEN_PICKUPS_SQL, tenantId, guest.customer.id))?.n ?? 0) : 0,
      nextPickupNo: dineIn ? null : Number((await first(NEXT_GUEST_PICKUP_SQL, tenantId, pickupDayStart(at), tenantId, at.toISOString()))?.next ?? 1)
    };
  }

  async function writeOrder(input, pos, guest) {
    const last = await lastJournal();
    const ids = [...new Set(orderProductIds(input))];
    const products = new Map();
    for (const row of await selectByIds("SELECT * FROM products WHERE tenant_id = ? AND id IN (?)", ids, tenantId)) {
      products.set(String(row.id), row);
    }
    // The dishes inside a set, for its VAT split.
    const parts = bundleComponentIds(products.values()).filter((partId) => !products.has(partId));
    if (parts.length) for (const row of await selectByIds("SELECT * FROM products WHERE tenant_id = ? AND id IN (?)", parts, tenantId)) products.set(String(row.id), row);
    const settings = await getSettings();
    const { timeZone, setsSchedule } = settings;
    // A guest's own order is planned with its limits and rewards (shared/ordering.mjs).
    // Read after the journal: two pickups that read the same next number both
    // claim the same journal entry, and the loser works it out again.
    const guestPlan = guest ? planGuestOrder(tenantId, input, products, settings, guest, await guestReads(input, guest)) : null;
    const pickupNo = guestPlan ? guestPlan.pickupNo : pos && isTakeaway(input.table) ? Number(String(input.table).slice(TAKEAWAY_PREFIX.length)) || null : null;
    const plan = guestPlan?.plan ?? planOrder(input, products, { timeZone, setsSchedule }, { staffName: pos?.staff?.name, pickupNo });
    const { id, orderNo, clientRequestId, table, note, totalCents, timestamp } = plan.order;
    // Portions left today (每日限量): an order for more than there is says which dish and how many.
    const demand = stockDemand(plan.items);
    const { stock, today } = await stockFor([...demand.keys()]);
    assertStock(demand, products, stock, today);

    // A locked table is one whose bill is being settled. Refusing here is the
    // whole point of the lock: an order that lands mid-settle is either missing
    // from the bill the guest just paid or reopens a table that was released.
    const tableRow = await first("SELECT locked_at FROM restaurant_tables WHERE tenant_id = ? AND table_no = ?", tenantId, String(table).toUpperCase());
    // The lock is against guests adding to a bill being paid; the floor staff
    // who set it may still add to it. Another device's open table is theirs.
    if (pos) assertClaim(await first(CLAIM_WITH_META_SQL, tenantId, String(table).toUpperCase()), pos.deviceId);
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
      sql("INSERT INTO orders (tenant_id, id, order_no, client_request_id, table_no, status, note, total_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)", tenantId, id, orderNo, clientRequestId, table, note, totalCents, timestamp, timestamp),
      ...plan.items.map((item) => sql("INSERT INTO order_items (tenant_id, id, order_id, product_id, product_name, quantity, unit_price_cents, print_station, modifiers_json, vat_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", tenantId, item.id, item.orderId, item.productId, item.productName, item.quantity, item.unitPriceCents, item.printStation, item.modifiersJson, item.vatPercent)),
      ...plan.items.filter((item) => item.vatSplitJson).map((item) => sql("INSERT INTO order_item_vat_splits (tenant_id, order_item_id, split_json) VALUES (?, ?, ?)", tenantId, item.id, item.vatSplitJson)),
      ...plan.items.filter((item) => item.note).map((item) => sql("INSERT INTO order_item_notes (tenant_id, order_item_id, note) VALUES (?, ?, ?)", tenantId, item.id, item.note)),
      ...plan.items.filter((item) => item.held).map((item) => sql("INSERT INTO order_item_holds (tenant_id, order_item_id, held_at) VALUES (?, ?, ?)", tenantId, item.id, timestamp)),
      ...plan.printJobs.map((job) => sql("INSERT INTO print_jobs (tenant_id, id, order_id, printer_role, payload_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)", tenantId, job.id, job.orderId, job.printerRole, job.payloadJson, timestamp, timestamp)),
      ...(pos ? [sql("INSERT INTO order_staff (tenant_id, order_id, staff_id, staff_name, pickup_no, created_at) VALUES (?, ?, ?, ?, ?, ?)", tenantId, id, pos.staff?.id ?? null, pos.staff?.name ?? null, pickupNo, timestamp)] : []),
      // The guests are seated: their phones may order too.
      ...(pos ? (openTableStatements(tenantId, table, settings, pos.staff?.name)) : []),
      ...(guestPlan ? (guestPlan.statements) : []),
      ...takeStockStatements(tenantId, sql, demand, stock, today, timestamp),
      await journalStatement(last, "order.created", id, { ...orderJournalPayload(plan), ...(pos ? { staffName: pos.staff?.name ?? null, pickupNo } : {}), ...(guestPlan ? guestPlan.journal : {}) }, timestamp)
    ];

    try {
      await batch(statements);
    } catch (error) {
      const committed = await first(ORDER_BY_REQUEST_SQL, tenantId, clientRequestId);
      if (committed) return viewOrder(committed);
      if (isOverdrawn(error)) throw guestOrderError("NOT_ENOUGH_POINTS", "Not enough points for this reward", 409);
      throw error;
    }
    return viewOrder(await first(ORDER_BY_ID_SQL, tenantId, id));
  }

  /** A table opened for its guests to order from (开台), or kept open longer. */
  async function openTable(tableInput, pos) {
    const table = normalizeTableNo(tableInput);
    await batch((openTableStatements(tenantId, table, await getSettings(), pos?.staff?.name)));
    return tableSessionView(await first(TABLE_SESSION_SQL, tenantId, table));
  }

  async function updateOrder(id, status) {
    return retrying(async () => {
      const last = await lastJournal();
      const current = await first("SELECT * FROM orders WHERE tenant_id = ? AND id = ?", tenantId, String(id));
      if (!current) return null;
      assertOrderTransition(current.status, status);
      if (current.status === status) return viewOrder(current);
      // A paid line stays paid: cancelling it is a storno of its receipt.
      if (status === "cancelled" && await first(ORDER_PAID_SQL, current.id)) throw new Error("This order is on a receipt; cancel the receipt first");
      const at = now();
      await batch([
        sql("UPDATE orders SET status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?", status, at, tenantId, current.id),
        // A reward's points come back with the order it was in.
        ...(status === "cancelled" ? (refundPointsStatements(tenantId, current.id, at)) : []),
        await journalStatement(last, "order.status", current.id, { orderId: current.id, orderNo: current.order_no, table: current.table_no, from: current.status, to: status }, at)
      ]);
      return viewOrder(await first(ORDER_BY_ID_SQL, tenantId, current.id));
    });
  }

  async function receiptDetail(row) {
    if (!row) return null;
    const storno = await first("SELECT id FROM receipts WHERE tenant_id = ? AND refers_to = ?", tenantId, row.id);
    const referred = row.refers_to ? await first("SELECT receipt_no FROM receipts WHERE tenant_id = ? AND id = ?", tenantId, row.refers_to) : null;
    return receiptView(row, { cancelledBy: storno?.id ?? null, referredNo: referred?.receipt_no ?? null });
  }

  /**
   * The same, for a list of receipts at once: one query for the stornos and
   * one for the receipts they refer to, instead of two per receipt
   * (listReceipts).
   */
  async function receiptDetails(rows) {
    if (!rows.length) return [];
    const stornos = await selectByIds(
      "SELECT id, refers_to FROM receipts WHERE tenant_id = ? AND refers_to IN (?)",
      rows.map((row) => row.id), tenantId,
    );
    const cancelledBy = new Map(stornos.map((row) => [row.refers_to, row.id]));
    const referredIds = [...new Set(rows.map((row) => row.refers_to).filter(Boolean))];
    const referred = referredIds.length
      ? await selectByIds("SELECT id, receipt_no FROM receipts WHERE tenant_id = ? AND id IN (?)", referredIds, tenantId)
      : [];
    const referredNo = new Map(referred.map((row) => [row.id, row.receipt_no]));
    return rows.map((row) => receiptView(row, {
      cancelledBy: cancelledBy.get(row.id) ?? null,
      referredNo: row.refers_to ? (referredNo.get(row.refers_to) ?? null) : null,
    }));
  }

  const printStatement = (payload, at) => sql("INSERT INTO print_jobs (tenant_id, id, order_id, printer_role, payload_json, status, created_at, updated_at) VALUES (?, ?, NULL, 'front', ?, 'queued', ?, ?)", tenantId, uuid(), JSON.stringify(payload), at, at);

  /** A sale at the register (planCheckout): the receipt, and the table freed once it is all paid. */
  async function checkout(input, role, pos = null) {
    const requestId = String(input.clientRequestId || uuid());
    const existing = await first("SELECT * FROM receipts WHERE tenant_id = ? AND client_request_id = ?", tenantId, requestId);
    if (existing) return receiptDetail(existing);
    return retrying(async () => {
      const last = await lastJournal();
      const ids = [...new Set((Array.isArray(input.items) ? input.items : []).map((item) => String(item.orderItemId)))];
      const itemRows = ids.length ? await selectByIds(CHECKOUT_ITEMS_SQL, ids) : [];
      const codes = [...new Set((Array.isArray(input.payments) ? input.payments : []).filter((payment) => payment.type === "voucher").map((payment) => normalizeVoucherCode(payment.voucherCode)))];
      const voucherRows = codes.length ? await selectByIds("SELECT * FROM vouchers WHERE tenant_id = ? AND code IN (?)", codes, tenantId) : [];
      const memberIds = [...new Set((Array.isArray(input.payments) ? input.payments : []).filter((payment) => payment.type === "balance").map((payment) => String(payment.memberId ?? "")).filter(Boolean))];
      const memberRows = memberIds.length
        ? await selectByIds("SELECT customers.id, COALESCE((SELECT balance_cents FROM member_balances WHERE member_balances.tenant_id = customers.tenant_id AND member_balances.customer_id = customers.id), 0) AS balance_cents FROM customers WHERE customers.tenant_id = ? AND customers.id IN (?)", memberIds, tenantId)
        : [];
      // Another device's open table is theirs to pay, before anything else is looked at.
      const openTable = input.table || itemRows[0]?.table_no;
      // The console has no table of its own: one open on a POS is that POS's.
      if (openTable) assertClaim(await first(CLAIM_WITH_META_SQL, tenantId, String(openTable).toUpperCase()), pos?.deviceId ?? null);
      const settings = await getSettings();
      const plan = planCheckout({ ...input, clientRequestId: requestId }, {
        itemRows, voucherRows, memberRows, receiptNo: ((await first("SELECT MAX(receipt_no) AS no FROM receipts WHERE tenant_id = ?", tenantId))?.no ?? 0) + 1, settings, role, staff: pos?.staff ?? null
      });
      const at = plan.receipt.createdAt;
      const view = plannedReceiptView(plan.receipt);
      const table = plan.receipt.table;
      const statements = [
        sql(INSERT_RECEIPT_TENANT_SQL, tenantId, ...receiptRow(plan.receipt)),
        ...plan.receiptItems.map((item) => sql("INSERT INTO receipt_items (tenant_id, receipt_id, order_item_id, quantity) VALUES (?, ?, ?, ?)", tenantId, plan.receipt.id, item.orderItemId, item.quantity)),
        ...plan.vouchers.map((voucher) => sql(INSERT_VOUCHER_TENANT_SQL, tenantId, voucher.code, voucher.valueCents, voucher.valueCents, plan.receipt.id, at, at)),
        ...plan.voucherDebits.map((debit) => sql(DEBIT_VOUCHER_TENANT_SQL, debit.amountCents, at, tenantId, debit.code)),
        // Members' stored value spent on this bill (shared/customer.mjs).
        ...(spendBalanceStatements(tenantId, plan.receipt.id, plan.balanceDebits, at)),
        ...(table ? [
          sql(SETTLE_PAID_TABLE_TENANT_SQL, at, at, tenantId, table, tenantId, table),
          sql(UNLOCK_PAID_TABLE_TENANT_SQL, at, tenantId, table.toUpperCase(), tenantId, table),
          ...(closePaidTableStatements(tenantId, table))
        ] : []),
        // Points for the signed-in guests whose orders this paid (shared/customer.mjs).
        ...(earnPointsStatements(tenantId, plan.receipt.id, settings.loyalty, at, { totalCents: plan.receipt.totalCents, balanceCents: plan.balanceDebits.reduce((sum, debit) => sum + debit.amountCents, 0) })),
        // A member's first paid visit: the bonus that lets them book (shared/reservations.mjs).
        ...(welcomePointsStatements(tenantId, plan.receipt.id, settings.reservations?.enabled ? settings.reservations.welcomePoints : 0, at)),
        printStatement(receiptPrintPayload(view, settings), at),
        await journalStatement(last, "receipt.issued", plan.receipt.id, view, at)
      ];
      try {
        await batch(statements);
      } catch (error) {
        const committed = await first("SELECT * FROM receipts WHERE tenant_id = ? AND client_request_id = ?", tenantId, requestId);
        if (committed) return receiptDetail(committed);
        throw error;
      }
      return receiptDetail(await first("SELECT * FROM receipts WHERE tenant_id = ? AND id = ?", tenantId, plan.receipt.id));
    });
  }

  /** Cancels a receipt with a storno receipt (planStorno). Null when there is no such receipt. */
  async function stornoReceipt(id, reason, role, pos = null) {
    return retrying(async () => {
      const last = await lastJournal();
      const original = await first("SELECT * FROM receipts WHERE tenant_id = ? AND id = ?", tenantId, String(id));
      if (!original) return null;
      if (await first("SELECT id FROM receipts WHERE tenant_id = ? AND refers_to = ?", tenantId, original.id)) throw new Error("This receipt has already been cancelled");
      const settings = await getSettings();
      const plan = planStorno(original, {
        receiptNo: ((await first("SELECT MAX(receipt_no) AS no FROM receipts WHERE tenant_id = ?", tenantId))?.no ?? 0) + 1,
        reason,
        soldVoucherRows: await all("SELECT * FROM vouchers WHERE tenant_id = ? AND sold_receipt_id = ?", tenantId, original.id),
        role,
        staff: pos?.staff ?? null
      });
      const at = plan.receipt.createdAt;
      const view = plannedReceiptView(plan.receipt, original.receipt_no);
      try {
        await batch([
          sql(INSERT_RECEIPT_TENANT_SQL, tenantId, ...receiptRow(plan.receipt)),
          ...plan.refunds.map((refund) => sql(CREDIT_VOUCHER_TENANT_SQL, refund.amountCents, at, tenantId, refund.code)),
          ...plan.voided.map((code) => sql(VOID_VOUCHER_TENANT_SQL, at, at, tenantId, code)),
          sql(REOPEN_ORDERS_SQL, at, original.id),
          ...(reversePointsStatements(tenantId, plan.receipt.id, original.id, at)),
          // A bill paid from balances given back; a top-up's money and bonus taken back.
          ...(refundBalanceStatements(tenantId, plan.receipt.id, plan.balanceRefunds, at)),
          ...(reverseBalanceStatements(tenantId, plan.receipt.id, plan.balanceReversals, at)),
          printStatement(receiptPrintPayload(view, settings), at),
          await journalStatement(last, "receipt.storno", plan.receipt.id, view, at)
        ]);
      } catch (error) {
        // The member spent the top-up before it was cancelled: their balance would go below zero.
        if (isOverdrawn(error) && plan.balanceReversals.length) throw new Error("This top-up has been spent and cannot be cancelled", { cause: error });
        throw error;
      }
      return receiptDetail(await first("SELECT * FROM receipts WHERE tenant_id = ? AND id = ?", tenantId, plan.receipt.id));
    });
  }

  /**
   * A member puts money in (会员储值充值): a top-up receipt (0% line, paid cash
   * or card — planTopUp), the money and the house's bonus added to their
   * balance, in one batch and in the journal, exactly as a sale is. Idempotent
   * on clientRequestId, so a tap sent twice tops up once.
   */
  async function topUp(input, role, pos = null) {
    const requestId = String(input.clientRequestId || uuid());
    const existing = await first("SELECT * FROM receipts WHERE tenant_id = ? AND client_request_id = ?", tenantId, requestId);
    if (existing) return topUpResult(existing);
    return retrying(async () => {
      const last = await lastJournal();
      const member = await first("SELECT * FROM customers WHERE tenant_id = ? AND id = ?", tenantId, String(input.memberId ?? ""));
      const settings = await getSettings();
      const plan = planTopUp({ ...input, clientRequestId: requestId }, {
        member, receiptNo: ((await first("SELECT MAX(receipt_no) AS no FROM receipts WHERE tenant_id = ?", tenantId))?.no ?? 0) + 1,
        settings, membership: settings.membership, role, staff: pos?.staff ?? null
      });
      const at = plan.receipt.createdAt;
      const view = plannedReceiptView(plan.receipt);
      const statements = [
        sql(INSERT_RECEIPT_TENANT_SQL, tenantId, ...receiptRow(plan.receipt)),
        ...(topUpBalanceStatements(tenantId, plan.credit.memberId, plan.credit.principalCents, plan.credit.bonusCents, plan.receipt.id, at, plan.credit.reason, plan.credit.operator)),
        // 充值送积分: the money put in earns points at the programme's rate (shared/customer.mjs).
        ...(topUpPointsStatements(tenantId, plan.credit.memberId, plan.credit.principalCents, plan.receipt.id, settings.loyalty, at)),
        printStatement(receiptPrintPayload(view, settings), at),
        await journalStatement(last, "receipt.issued", plan.receipt.id, view, at)
      ];
      try {
        await batch(statements);
      } catch (error) {
        const committed = await first("SELECT * FROM receipts WHERE tenant_id = ? AND client_request_id = ?", tenantId, requestId);
        if (committed) return topUpResult(committed);
        throw error;
      }
      return topUpResult(await first("SELECT * FROM receipts WHERE tenant_id = ? AND id = ?", tenantId, plan.receipt.id), plan.credit.memberId);
    });
  }

  /** A top-up's receipt, and the member's balance as it now stands. */
  async function topUpResult(receiptRow, memberId = null) {
    const id = memberId ?? parseJson(receiptRow.lines_json, [])[0]?.memberId;
    const member = id
      ? await first("SELECT customers.*, COALESCE((SELECT balance_cents FROM member_balances WHERE member_balances.tenant_id = customers.tenant_id AND member_balances.customer_id = customers.id), 0) AS balance_cents FROM customers WHERE tenant_id = ? AND id = ?", tenantId, String(id))
      : null;
    return { receipt: await receiptDetail(receiptRow), member: customerView(member) };
  }

  /** The day's closing (Z report) over the receipts since the last one. Null when there are none. */
  async function closeDay(role) {
    return retrying(async () => {
      const last = await lastJournal();
      const rows = await all(OPEN_RECEIPTS_TENANT_SQL, tenantId, tenantId);
      if (!rows.length) return null;
      const totals = closingTotals(rows);
      const id = uuid();
      const at = now();
      const closingNo = ((await first("SELECT MAX(closing_no) AS no FROM day_closings WHERE tenant_id = ?", tenantId))?.no ?? 0) + 1;
      const view = closingView({ id, closing_no: closingNo, totals_json: JSON.stringify(totals), created_at: at });
      await batch([
        sql("INSERT INTO day_closings (tenant_id, id, closing_no, first_receipt_no, last_receipt_no, totals_json, staff_role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", tenantId, id, closingNo, totals.firstReceiptNo, totals.lastReceiptNo, JSON.stringify(totals), role, at),
        printStatement(closingPrintPayload(view, await getSettings()), at),
        await journalStatement(last, "day.closed", id, view, at)
      ]);
      return closingView(await first("SELECT * FROM day_closings WHERE tenant_id = ? AND id = ?", tenantId, id));
    });
  }

  /** The journal between two days (from inclusive, to exclusive), checked link by link. */
  async function exportJournal(from, to) {
    const rows = await all("SELECT * FROM journal WHERE tenant_id = ? AND at >= ? AND at < ? ORDER BY seq", tenantId, from, to);
    const before = rows.length && rows[0].seq > 1 ? await first("SELECT * FROM journal WHERE tenant_id = ? AND seq = ?", tenantId, rows[0].seq - 1) : null;
    return { entries: rows.map(journalView), verification: await verifyJournal(rows, before) };
  }

  async function createServiceRequest(input) {
    const table = String(input.table || "").trim();
    if (!table) throw new Error("Service request requires a table number");
    // Asked again before anyone came: the same call, not a second one on the waiter's screen.
    const waiting = await first("SELECT * FROM service_requests WHERE tenant_id = ? AND table_no = ? AND type = ? AND status IN ('open', 'acknowledged') ORDER BY created_at LIMIT 1", tenantId, table, String(input.type || "").trim());
    if (waiting) return { ...serviceRequestView(waiting), repeated: true };
    const id = uuid();
    const timestamp = now();
    await run(
      "INSERT INTO service_requests (id, tenant_id, table_no, type, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'open', ?, ?)",
      id, tenantId, table, String(input.type || "").trim(), timestamp, timestamp
    );
    return serviceRequestView(await first("SELECT * FROM service_requests WHERE tenant_id = ? AND id = ?", tenantId, id));
  }

  /** The calls nobody has dealt with yet, oldest first: what the POS floor shows. */
  async function openServiceRequests() {
    return (await all("SELECT * FROM service_requests WHERE tenant_id = ? AND status IN ('open', 'acknowledged') ORDER BY created_at LIMIT 100", tenantId)).map(serviceRequestView);
  }

  async function updateServiceRequest(id, status) {
    const current = await first("SELECT * FROM service_requests WHERE tenant_id = ? AND id = ?", tenantId, String(id));
    if (!current) return null;
    assertRequestTransition(current.status, status);
    await run("UPDATE service_requests SET status = ?, updated_at = ? WHERE tenant_id = ? AND id = ?", status, now(), tenantId, String(id));
    return serviceRequestView(await first("SELECT * FROM service_requests WHERE tenant_id = ? AND id = ?", tenantId, String(id)));
  }

  async function savePrinter(input, id) {
    const current = id ? await first("SELECT * FROM printer_profiles WHERE tenant_id = ? AND id = ?", tenantId, String(id)) : null;
    if (id && !current) return null;
    const printer = normalizePrinter({ ...input, id: id || input.id }, current);
    const backup = JSON.parse(printer.capabilities).backupPrinterId;
    if (backup && !(await first("SELECT id FROM printer_profiles WHERE tenant_id = ? AND id = ?", tenantId, backup))) throw new Error("The backup printer does not exist");
    const timestamp = now();
    if (current) {
      await run(
        "UPDATE printer_profiles SET name = ?, transport = ?, address = ?, port = ?, role = ?, enabled = ?, capabilities_json = ?, updated_at = ? WHERE tenant_id = ? AND id = ?",
        printer.name, printer.transport, printer.address, printer.port, printer.role, printer.enabled, printer.capabilities, timestamp, tenantId, printer.id
      );
    } else {
      await run(
        "INSERT INTO printer_profiles (tenant_id, id, name, transport, address, port, role, enabled, capabilities_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        tenantId, printer.id, printer.name, printer.transport, printer.address, printer.port, printer.role, printer.enabled, printer.capabilities, timestamp, timestamp
      );
    }
    return printerView(await first("SELECT * FROM printer_profiles WHERE tenant_id = ? AND id = ?", tenantId, printer.id));
  }

  // ——— The account (shared/account.mjs): the same decisions server/database.mjs
  // makes; only the reads and writes differ.

  async function accountStatus() {
    return { registered: (await first(ACCOUNT_COUNT_SQL)).count > 0 };
  }

  async function openAccountSession(row) {
    const token = newSessionToken();
    const timestamp = now();
    const sessionTenant = row.tenant_id ?? DEFAULT_TENANT_ID;
    await run(DELETE_EXPIRED_ACCOUNT_SESSIONS_TENANT_SQL, sessionTenant, timestamp);
    await run(INSERT_ACCOUNT_SESSION_TENANT_SQL, sessionTenant, await hashSessionToken(token), row.id, new Date(Date.now() + ACCOUNT_SESSION_TTL_MS).toISOString(), timestamp);
    return { token, expiresInMs: ACCOUNT_SESSION_TTL_MS, account: accountView(row) };
  }

  async function registerAccount(input) {
    const { login, name, password } = normalizeRegistration(input);
    const stored = await hashPassword(password);
    const timestamp = now();
    const id = uuid();
    if (!(await run(REGISTER_ACCOUNT_SQL, id, DEFAULT_TENANT_ID, OWNER_ROLE, "active", login, name, "", stored.hash, stored.salt, stored.iterations, null, timestamp, timestamp))) return null;
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
    // A new password replaces the owner's encrypted copy too (or clears it while no view key is configured);
    // an unchanged password keeps the copy it already has.
    const passwordEnc = input.password === undefined
      ? (row.password_enc ?? null)
      : (passwordViewKey ? await encryptPasswordForOwner(input.password, passwordViewKey) : null);
    if (login !== row.login && (await first(ACCOUNT_BY_LOGIN_SQL, login))) throw new Error("That account name is taken");
    await run(UPDATE_ACCOUNT_SQL, login, name, row.email ?? "", stored.hash, stored.salt, stored.iterations, passwordEnc, now(), row.id);
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
    const passwordEnc = passwordViewKey ? await encryptPasswordForOwner(input.password, passwordViewKey) : null;
    await run(UPDATE_ACCOUNT_SQL, login, normalizeAccountName(input?.name ?? owner.name, login), owner.email ?? "", stored.hash, stored.salt, stored.iterations, passwordEnc, now(), owner.id);
    await run(DELETE_ACCOUNT_SESSIONS_SQL, owner.id);
    return { account: accountView(await first(ACCOUNT_BY_ID_SQL, owner.id)) };
  }

  async function roleForSession(token) {
    if (!token) return null;
    const tokenHash = await hashSessionToken(token);
    const row = await first(ACCOUNT_SESSION_SQL, tokenHash);
    // Not the account's: a waiter's session on a POS device, perhaps.
    if (!row) {
      // Or one of the tenant's own role tokens (a kitchen screen, a tablet).
      const tenantToken = await tenantTokenFor(token);
      if (tenantToken) return { role: tenantToken.role, tenantId: tenantToken.tenantId };
      return posSession(token);
    }
    if (row.expires_at <= now()) {
      await run(DELETE_ACCOUNT_SESSION_SQL, tokenHash);
      return null;
    }
    return { role: "manager", account: accountView(row), tenantId: row.tenant_id ?? DEFAULT_TENANT_ID };
  }

  /**
   * Which tenant a request belongs to, from what it carries — before any
   * tenant is known, so every lookup here is global (no closure tenant).
   * Priority is the order the tokens identify their bearer: an admin session
   * (or a tenant role token, or a waiter's POS session), a paired device, a
   * table's card, a guest account, a booking's link, and last a restaurant
   * slug. Null when nothing identifies one: the caller falls back to the
   * default tenant. An expired session resolves nothing — the scoped store's
   * own auth still refuses it either way.
   */
  async function resolveTenant({ adminToken, deviceToken, tableToken, customerToken, reservationToken, slug } = {}) {
    if (adminToken) {
      const tokenHash = await hashSessionToken(adminToken);
      const accountRow = await first(ACCOUNT_SESSION_SQL, tokenHash);
      if (accountRow) {
        if (accountRow.expires_at <= now()) await run(DELETE_ACCOUNT_SESSION_SQL, tokenHash);
        else return accountRow.tenant_id ?? DEFAULT_TENANT_ID;
      }
      const tenantToken = await tenantTokenFor(adminToken);
      if (tenantToken) return tenantToken.tenantId;
      const posRow = await first(
        "SELECT pos_sessions.tenant_id FROM pos_sessions JOIN staff ON staff.id = pos_sessions.staff_id AND staff.tenant_id = pos_sessions.tenant_id WHERE pos_sessions.token_hash = ? AND pos_sessions.expires_at > ? AND staff.active = 1",
        tokenHash, now()
      );
      if (posRow) return posRow.tenant_id;
    }
    if (deviceToken) {
      const row = await first("SELECT tenant_id FROM pos_devices WHERE token_hash = ?", await hashSessionToken(deviceToken));
      if (row) return row.tenant_id;
    }
    if (tableToken) {
      const row = await first("SELECT tenant_id FROM restaurant_tables WHERE token = ?", String(tableToken));
      if (row) return row.tenant_id;
    }
    if (customerToken) {
      const row = await first("SELECT tenant_id FROM customer_sessions WHERE token_hash = ? AND expires_at > ?", await hashSessionToken(customerToken), now());
      if (row) return row.tenant_id;
    }
    if (reservationToken) {
      const row = await first("SELECT tenant_id FROM reservations WHERE token_hash = ?", await hashSessionToken(reservationToken));
      if (row) return row.tenant_id;
    }
    if (slug) {
      const row = await first(TENANT_BY_SLUG_SQL, normalizeTenantSlug(slug));
      if (row) return row.id;
    }
    return null;
  }

  /**
   * The one tenant a guest email belongs to — for a returning guest signing
   * in without a table or a slug to name the restaurant by. Null when the
   * email is unknown, or when it belongs to members of more than one tenant
   * (then only the table or the slug can tell them apart).
   */
  async function tenantForCustomerEmail(emailInput) {
    const email = String(emailInput ?? "").trim().toLowerCase();
    if (!email) return null;
    const rows = await all("SELECT DISTINCT tenant_id FROM customers WHERE email = ?", email);
    return rows.length === 1 ? rows[0].tenant_id : null;
  }

  // ——— The POS (shared/pos.mjs): devices, waiters, open tables, takeaway, settlement.

  async function pairDevice(nameInput) {
    const name = normalizeDeviceName(nameInput);
    const token = newSessionToken();
    const id = uuid();
    await run("INSERT INTO pos_devices (tenant_id, id, name, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, NULL)", tenantId, id, name, await hashSessionToken(token), now());
    return { device: deviceView(await first("SELECT * FROM pos_devices WHERE tenant_id = ? AND id = ?", tenantId, id)), token };
  }

  async function deviceForToken(token) {
    if (!token) return null;
    const row = await first("SELECT * FROM pos_devices WHERE tenant_id = ? AND token_hash = ?", tenantId, await hashSessionToken(token));
    if (row) await run("UPDATE pos_devices SET last_seen_at = ? WHERE tenant_id = ? AND id = ?", now(), tenantId, row.id);
    return row ?? null;
  }

  async function saveStaff(input, id = null) {
    const current = id ? await first("SELECT * FROM staff WHERE tenant_id = ? AND id = ?", tenantId, String(id)) : null;
    if (id && !current) return null;
    const staff = normalizeStaffInput(input, current);
    const at = now();
    try {
      if (current) {
        const pin = staff.pin ? await hashPassword(staff.pin) : null;
        await batch([
          sql("UPDATE staff SET name = ?, role = ?, active = ?, updated_at = ? WHERE tenant_id = ? AND id = ?", staff.name, staff.role, staff.active ? 1 : 0, at, tenantId, current.id),
          ...(pin ? [sql("UPDATE staff SET pin_hash = ?, pin_salt = ?, pin_iterations = ?, updated_at = ? WHERE tenant_id = ? AND id = ?", pin.hash, pin.salt, pin.iterations, at, tenantId, current.id)] : []),
          // A waiter switched off, or given a new PIN, is signed out everywhere.
          ...(!staff.active || pin ? [sql("DELETE FROM pos_sessions WHERE tenant_id = ? AND staff_id = ?", tenantId, current.id)] : [])
        ]);
        return staffView(await first("SELECT * FROM staff WHERE tenant_id = ? AND id = ?", tenantId, current.id));
      }
      const { hash, salt, iterations } = await hashPassword(staff.pin);
      const newId = uuid();
      await run("INSERT INTO staff (tenant_id, id, name, role, pin_hash, pin_salt, pin_iterations, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        tenantId, newId, staff.name, staff.role, hash, salt, iterations, staff.active ? 1 : 0, at, at);
      return staffView(await first("SELECT * FROM staff WHERE tenant_id = ? AND id = ?", tenantId, newId));
    } catch (error) {
      if (/UNIQUE constraint failed: staff\.(tenant_id, staff\.)?name/.test(String(error?.message))) throw new Error("There is already a waiter of that name", { cause: error });
      throw error;
    }
  }

  async function posSignIn(device, staffId, pin) {
    const row = await first("SELECT * FROM staff WHERE tenant_id = ? AND id = ?", tenantId, String(staffId ?? ""));
    const stored = row ? { hash: row.pin_hash, salt: row.pin_salt, iterations: row.pin_iterations } : { hash: "", salt: ABSENT_PASSWORD_SALT, iterations: PASSWORD_ITERATIONS };
    const correct = await verifyPassword(String(pin ?? ""), stored);
    if (!row || !row.active || !correct) return null;
    const token = newSessionToken();
    await run("INSERT INTO pos_sessions (tenant_id, token_hash, staff_id, device_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      tenantId, await hashSessionToken(token), row.id, device.id, new Date(Date.now() + POS_SESSION_TTL_MS).toISOString(), now());
    return { token, staff: staffView(row), expiresInMs: POS_SESSION_TTL_MS };
  }

  async function posSession(token) {
    const row = await first(
      "SELECT pos_sessions.*, staff.name AS staff_name, staff.role AS staff_role, staff.active AS staff_active FROM pos_sessions JOIN staff ON staff.id = pos_sessions.staff_id AND staff.tenant_id = pos_sessions.tenant_id WHERE pos_sessions.tenant_id = ? AND token_hash = ?",
      tenantId, await hashSessionToken(token)
    );
    if (!row) return null;
    if (row.expires_at <= now() || !row.staff_active) {
      await run("DELETE FROM pos_sessions WHERE tenant_id = ? AND token_hash = ?", tenantId, row.token_hash);
      return null;
    }
    return { role: row.staff_role === "manager" ? "manager" : "staff", staff: { id: row.staff_id, name: row.staff_name }, deviceId: row.device_id, tenantId };
  }

  async function claimTable(tableInput, pos, { shared } = {}) {
    const table = String(tableInput).trim().toUpperCase();
    const at = now();
    // Who held the table before this call decides the fence: a different device
    // taking a free or lapsed table bumps the epoch, while the same device
    // renewing leaves it. Read before the upsert overwrites it.
    const before = await first("SELECT device_id, expires_at FROM table_claims WHERE tenant_id = ? AND table_no = ?", tenantId, table);
    await run(CLAIM_UPSERT_SQL, tenantId, table, pos.deviceId, pos.staff?.id ?? null, pos.staff?.name ?? null, new Date(Date.now() + CLAIM_TTL_MS).toISOString(), at);
    const row = await first(CLAIM_WITH_META_SQL, tenantId, table);
    // Another device's non-shared table is closed to this one: stop before
    // touching anything. A shared table, or one this device now owns, reads on.
    assertClaim(row, pos.deviceId, at);
    // A device joining a live shared table does not own the row, so the upsert
    // left it untouched: it rides alongside the lead rather than taking over.
    const joiningShared = Boolean(row?.shared) && row.device_id !== pos.deviceId && row.expires_at > at;
    // A takeover (different device, or a free or lapsed table) that actually
    // changed the owner climbs the fence and starts the mode fresh, so a stale
    // collaborative flag left by an earlier party is not inherited. `shared`
    // undefined (the hold heartbeat) keeps the current mode; true/false set it.
    const tookOver = row?.device_id === pos.deviceId && (!before || before.expires_at <= at || before.device_id !== pos.deviceId);
    const sharedNow = shared === undefined ? (tookOver ? 0 : Number(Boolean(row?.shared))) : (shared ? 1 : 0);
    await run(CLAIM_META_UPSERT_SQL, tenantId, table, sharedNow, at, tookOver ? 1 : 0);
    if (joiningShared) {
      // Keep the shared table's hold from lapsing while this device is active.
      await run("UPDATE table_claims SET expires_at = ? WHERE tenant_id = ? AND table_no = ?", new Date(Date.now() + CLAIM_TTL_MS).toISOString(), tenantId, table);
    }
    return claimView(await first(CLAIM_WITH_META_SQL, tenantId, table), at);
  }

  function tableConflict(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  /**
   * Throws unless nobody is at the table: no bill left open, no waiter with it
   * open on a POS, no guests ordering from their phones. What renumbering or
   * removing a table waits for.
   */
  async function assertTableIdle(tableNo) {
    const at = now();
    const claim = claimView(await first("SELECT * FROM table_claims WHERE tenant_id = ? AND table_no = ?", tenantId, tableNo), at);
    if (claim) throw tableConflict(`Table ${tableNo} is open on a POS (${claim.staffName ?? "?"})`, "TABLE_IN_USE");
    const open = (await first("SELECT COUNT(*) AS n FROM orders WHERE tenant_id = ? AND table_no = ? AND billed_at IS NULL AND status <> 'cancelled'", tenantId, tableNo))?.n ?? 0;
    if (open) throw tableConflict(`Table ${tableNo} still has a bill open`, "TABLE_IN_USE");
    if (await first("SELECT table_no FROM table_sessions WHERE tenant_id = ? AND table_no = ? AND expires_at > ?", tenantId, tableNo, at)) throw tableConflict(`Table ${tableNo} is open for guests to order`, "TABLE_IN_USE");
  }

  async function holdsTable(tableInput, deviceId) {
    return holdsClaim(await first("SELECT * FROM table_claims WHERE tenant_id = ? AND table_no = ?", tenantId, String(tableInput).trim().toUpperCase()), deviceId);
  }

  async function newTakeaway(pos) {
    const since = `${now().slice(0, 10)}T00:00:00.000Z`;
    let next = (await first(NEXT_PICKUP_SQL, tenantId, since))?.next ?? 1;
    for (;; next += 1) {
      try {
        return { table: `${TAKEAWAY_PREFIX}${next}`, pickupNo: next, claim: await claimTable(`${TAKEAWAY_PREFIX}${next}`, pos) };
      } catch (error) {
        if (error.code !== "TABLE_CLAIMED") throw error;
      }
    }
  }

  /**
   * 转桌 / 并台: an open table's unbilled orders move to another table.
   * Onto a free table it is a plain move; onto a table with its own open
   * bill it is a merge, and that takes saying so — a typed number or a stale
   * client must never silently fold two bills into one. Null when the source
   * has nothing open.
   */
  async function moveTable(fromInput, toInput, pos, { merge = false } = {}) {
    const from = normalizeTableNo(fromInput);
    const to = normalizeTableNo(toInput);
    if (from === to) throw new Error("That is the same table");
    return retrying(async () => {
      const last = await lastJournal();
      assertClaim(await first(CLAIM_WITH_META_SQL, tenantId, from), pos.deviceId);
      assertClaim(await first(CLAIM_WITH_META_SQL, tenantId, to), pos.deviceId);
      const open = (await first("SELECT COUNT(*) AS n FROM orders WHERE tenant_id = ? AND table_no = ? AND billed_at IS NULL AND status <> 'cancelled'", tenantId, from))?.n ?? 0;
      if (!open) return null;
      if (!merge) {
        const targetOpen = (await first("SELECT COUNT(*) AS n FROM orders WHERE tenant_id = ? AND table_no = ? AND billed_at IS NULL AND status <> 'cancelled'", tenantId, to))?.n ?? 0;
        if (targetOpen) {
          const error = new Error(
            `Table ${to} already has an open bill — merge the tables to combine them`,
          );
          error.code = "TABLE_OCCUPIED";
          throw error;
        }
      }
      const at = now();
      await batch([
        sql("UPDATE orders SET table_no = ?, updated_at = ? WHERE tenant_id = ? AND table_no = ? AND billed_at IS NULL AND status <> 'cancelled'", to, at, tenantId, from),
        sql("DELETE FROM table_claims WHERE tenant_id = ? AND table_no = ? AND device_id = ?", tenantId, from, pos.deviceId),
        // The table the bill left behind lets go of its collaborative flag too.
        sql("DELETE FROM table_claim_meta WHERE tenant_id = ? AND table_no = ?", tenantId, from),
        ...(moveTableSessionStatements(tenantId, from, to, await getSettings(), pos.staff?.name)),
        await journalStatement(last, "table.moved", from, { from, to, orders: open, staffName: pos.staff?.name ?? null }, at)
      ]);
      return { from, to, moved: open };
    });
  }

  async function reprintReceipt(id) {
    const view = await receiptDetail(await first("SELECT * FROM receipts WHERE tenant_id = ? AND id = ?", tenantId, String(id)));
    if (!view) return false;
    const at = now();
    await batch([printStatement(receiptPrintPayload(view, await getSettings(), { copy: true }), at)]);
    return true;
  }

  async function setAvailable(id, available) {
    if (!(await run(SET_AVAILABLE_SQL, available ? 1 : 0, now(), tenantId, String(id)))) return null;
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
      assertClaim(await first(CLAIM_WITH_META_SQL, tenantId, table), pos.deviceId);
      const at = now();
      const plan = planVoid(input, await first(VOID_ITEM_SQL, String(input?.orderItemId ?? "")), { table, staff: pos.staff, role, at });
      const entry = plan.void;
      await batch([
        // INSERT_VOID_SQL (register.mjs) carries no tenant column: the store writes its own.
        sql("INSERT INTO order_item_voids (tenant_id, id, order_item_id, order_id, table_no, quantity, amount_cents, reason, staff_id, staff_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", tenantId, entry.id, entry.orderItemId, entry.orderId, entry.table, entry.quantity, entry.amountCents, entry.reason, entry.staffId, entry.staffName, at),
        // Not cooked after all: the portions go back on today's count.
        sql(RETURN_STOCK_SQL, entry.quantity, at, tenantId, String(plan.productId ?? ""), restaurantDay((await getSettings()).timeZone)),
        sql("INSERT INTO print_jobs (tenant_id, id, order_id, printer_role, payload_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)", tenantId, plan.printJob.id, plan.printJob.orderId, plan.printJob.printerRole, plan.printJob.payloadJson, at, at),
        await journalStatement(last, plan.journal.kind, plan.journal.ref, plan.journal.payload, at),
        // The last open dish voided, and the rest paid: the table is settled.
        sql(SETTLE_PAID_TABLE_TENANT_SQL, at, at, tenantId, table, tenantId, table),
        sql(UNLOCK_PAID_TABLE_TENANT_SQL, at, tenantId, table, tenantId, table)
      ]);
      return { id: entry.id, orderItemId: entry.orderItemId, quantity: entry.quantity, amountCents: entry.amountCents, reason: entry.reason, staffName: entry.staffName, createdAt: at };
    });
  }

  /**
   * 催菜: queue a reminder ticket to the kitchen for a dish already sent on this
   * table. No journal entry — it changes nothing, it only prints (shared/register.mjs,
   * planUrge).
   */
  async function urgeItem(tableInput, orderItemId, pos) {
    const table = normalizeTableNo(tableInput);
    assertClaim(await first(CLAIM_WITH_META_SQL, tenantId, table), pos.deviceId);
    const plan = planUrge(await first(VOID_ITEM_SQL, String(orderItemId ?? "")), { table, staff: pos.staff, at: now() });
    const at = now();
    await batch([
      sql("INSERT INTO print_jobs (tenant_id, id, order_id, printer_role, payload_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)", tenantId, plan.printJob.id, plan.printJob.orderId, plan.printJob.printerRole, plan.printJob.payloadJson, at, at)
    ]);
    return { orderItemId: String(orderItemId), printJobId: plan.printJob.id };
  }

  /**
   * 叫起: fire a held (等叫) dish — clear its hold and print it to the kitchen
   * now. Only the device that holds the table may fire. Nothing fiscal changes.
   */
  async function fireItem(tableInput, orderItemId, pos) {
    const table = normalizeTableNo(tableInput);
    assertClaim(await first(CLAIM_WITH_META_SQL, tenantId, table), pos.deviceId);
    const plan = planFire(await first(VOID_ITEM_SQL, String(orderItemId ?? "")), { table, staff: pos.staff, at: now() });
    const at = now();
    await batch([
      sql("DELETE FROM order_item_holds WHERE order_item_id = ?", String(orderItemId)),
      sql("INSERT INTO print_jobs (tenant_id, id, order_id, printer_role, payload_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)", tenantId, plan.printJob.id, plan.printJob.orderId, plan.printJob.printerRole, plan.printJob.payloadJson, at, at)
    ]);
    return { orderItemId: String(orderItemId), printJobId: plan.printJob.id };
  }

  async function settleStaff(staffId, role) {
    return retrying(async () => {
      const last = await lastJournal();
      const staff = await first("SELECT * FROM staff WHERE tenant_id = ? AND id = ?", tenantId, String(staffId));
      const rows = staff ? await all(OPEN_STAFF_RECEIPTS_SQL, tenantId, staff.id, staff.id) : [];
      if (!rows.length) return null;
      const totals = settlementTotals(rows, await all(OPEN_STAFF_VOIDS_SQL, tenantId, staff.id, staff.id));
      const id = uuid();
      const at = now();
      const view = settlementView({ id, staff_id: staff.id, staff_name: staff.name, totals_json: JSON.stringify(totals), created_at: at });
      await batch([
        sql("INSERT INTO staff_settlements (tenant_id, id, staff_id, staff_name, last_receipt_no, totals_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", tenantId, id, staff.id, staff.name, totals.lastReceiptNo, JSON.stringify(totals), at),
        printStatement({ kind: "settlement", company: companyOf(await getSettings()), settlement: view }, at),
        await journalStatement(last, "staff.settled", id, { ...view, by: role }, at)
      ]);
      return settlementView(await first("SELECT * FROM staff_settlements WHERE tenant_id = ? AND id = ?", tenantId, id));
    });
  }

  // ——— The cash drawer (shared/drawer.mjs): opened with a float, money in and out, counted at the end.

  const drawerError = (message, code) => Object.assign(new Error(message), { code });

  /** A drawer with its figures: so far while open, as counted once closed. */
  async function drawerDetail(row) {
    if (!row) return null;
    const movements = await all(DRAWER_MOVEMENTS_SQL, tenantId, row.id);
    const totals = row.closed_at ? null : drawerTotals(row, await all(DRAWER_RECEIPTS_SQL, tenantId, row.after_receipt_no), movements);
    return drawerView(row, totals, movements);
  }

  async function openDrawer(input, staff = null) {
    const floatCents = floatOf(input);
    return retrying(async () => {
      const last = await lastJournal();
      const id = uuid();
      const at = now();
      try {
        await batch([
          sql(INSERT_DRAWER_SQL, tenantId, id, tenantId, floatCents, staff?.name ?? null, at),
          await journalStatement(last, "drawer.opened", id, { floatCents, by: staff?.name ?? null }, at)
        ]);
      } catch (error) {
        if (/UNIQUE constraint failed: drawer_sessions\.(tenant_id, drawer_sessions\.)?open_flag/.test(String(error?.message ?? error))) throw drawerError("The drawer is open already: count it before opening it again", "DRAWER_OPEN");
        throw error;
      }
      return drawerDetail(await first("SELECT * FROM drawer_sessions WHERE tenant_id = ? AND id = ?", tenantId, id));
    });
  }

  async function moveCash(input, staff = null) {
    return retrying(async () => {
      const session = await first(OPEN_DRAWER_SQL, tenantId);
      if (!session) throw drawerError("Open the drawer first", "NO_DRAWER");
      const last = await lastJournal();
      const at = now();
      const movement = planMovement(session, input, { staff, at });
      await batch([
        sql(INSERT_MOVEMENT_SQL, tenantId, movement.id, movement.kind, movement.amountCents, movement.reason, movement.staffId, movement.staffName, at, tenantId, session.id),
        await journalStatement(last, movement.kind === "in" ? "drawer.in" : "drawer.out", session.id, { amountCents: movement.amountCents, reason: movement.reason, by: movement.staffName }, at)
      ]);
      const row = await first("SELECT * FROM drawer_movements WHERE tenant_id = ? AND id = ?", tenantId, movement.id);
      // Counted by someone else in between: the movement had no drawer to go into.
      if (!row) throw drawerError("The drawer was counted meanwhile: open it again", "NO_DRAWER");
      return movementView(row);
    });
  }

  /** Counts the open drawer (Kassensturz) and closes it; the slip goes to the front printer. */
  async function closeDrawer(input, staff = null) {
    const counted = countedOf(input);
    const note = String(input?.note ?? "").trim().slice(0, 200) || null;
    return retrying(async () => {
      const session = await first(OPEN_DRAWER_SQL, tenantId);
      if (!session) throw drawerError("No drawer is open", "NO_DRAWER");
      const last = await lastJournal();
      const at = now();
      const movements = await all(DRAWER_MOVEMENTS_SQL, tenantId, session.id);
      const totals = drawerTotals(session, await all(DRAWER_RECEIPTS_SQL, tenantId, session.after_receipt_no), movements, counted.cents);
      const closed = { ...session, open_flag: null, closed_at: at, closed_by: staff?.name ?? null, counts_json: counted.counts ? JSON.stringify(counted.counts) : null, totals_json: JSON.stringify(totals), note };
      const view = drawerView(closed, totals, movements);
      await batch([
        sql(CLOSE_DRAWER_SQL, at, closed.closed_by, totals.lastReceiptNo ?? session.after_receipt_no, counted.cents, closed.counts_json, closed.totals_json, note, tenantId, session.id),
        printStatement(drawerPrintPayload(view, companyOf(await getSettings())), at),
        await journalStatement(last, "drawer.closed", session.id, { ...totals, counts: counted.counts, note, by: closed.closed_by }, at)
      ]);
      return drawerDetail(await first("SELECT * FROM drawer_sessions WHERE tenant_id = ? AND id = ?", tenantId, session.id));
    });
  }

  async function signOut(token) {
    if (!token) return false;
    return (await run(DELETE_ACCOUNT_SESSION_SQL, await hashSessionToken(token))) > 0;
  }

  async function getSettings() {
    const values = Object.fromEntries((await all("SELECT key, value FROM app_settings WHERE tenant_id = ?", tenantId)).map((row) => [row.key, row.value]));
    return settingsView(await first("SELECT * FROM restaurant_settings WHERE tenant_id = ?", tenantId), values);
  }

  /** Any subset of the settings may come; the ones left out keep their value.
   *  All of it is checked before any of it is written. */
  async function saveSettings(input) {
    const { menuTheme, rows } = normalizeSettingsInput(input);
    const timestamp = now();
    if (menuTheme !== undefined) {
      await run(
        `INSERT INTO restaurant_settings (tenant_id, menu_theme, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(tenant_id) DO UPDATE SET menu_theme = excluded.menu_theme, updated_at = excluded.updated_at`,
        tenantId, menuTheme, timestamp
      );
    }
    for (const [key, value] of rows) {
      await run(
        `INSERT INTO app_settings (tenant_id, key, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        tenantId, key, value, timestamp
      );
    }
    return getSettings();
  }

  /** The audit writer the HTTP layer and the owner methods share: the entry lands under this store's tenant (or `auditTenantId`). */
  async function recordAudit(entry, auditTenantId = tenantId) {
    await run(
      "INSERT INTO audit_log (tenant_id, id, at, role, ip, method, route, status, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      auditTenantId, uuid(), now(), String(entry.role), String(entry.ip ?? ""), String(entry.method),
      String(entry.route), Number(entry.status), JSON.stringify(entry.detail ?? {})
    );
  }

  // ——— Tenants, and the owner's account powers (shared/tenant.mjs, shared/account.mjs).

  /** A tenant by id, or null. */
  async function getTenant(id) {
    return tenantView(await first(TENANT_BY_ID_SQL, String(id)));
  }

  /** One account, by id, across tenants — the owner routes gate it to the owner role. */
  async function getAccount(id) {
    const row = await first(ACCOUNT_BY_ID_SQL, String(id));
    return row ? accountView(row) : null;
  }

  async function listTenants() {
    return (await all(LIST_TENANTS_SQL)).map(tenantView);
  }

  /**
   * A new restaurant. Its id is `t_<slug>` unless one is given. A tenant
   * with the same slug or id already there throws instead of failing on the
   * UNIQUE index.
   */
  async function createTenant(input) {
    const slug = normalizeTenantSlug(input?.slug);
    const id = input?.id === undefined ? `t_${slug}` : String(input.id);
    const name = normalizeTenantName(input?.name, slug);
    const config = normalizeTenantConfig(input?.config ?? {});
    const at = now();
    if (await first(TENANT_BY_ID_SQL, id)) throw new Error(`Tenant ${id} already exists`);
    if (await first(TENANT_BY_SLUG_SQL, slug)) throw new Error(`Tenant ${slug} already exists`);
    await run(INSERT_TENANT_SQL, id, slug, name, "active", JSON.stringify(config), at, at);
    return tenantView(await first(TENANT_BY_ID_SQL, id));
  }

  /**
   * Every table that carries tenant_id (server/database.mjs, SCHEMA_SQL) —
   * the per-tenant export and full delete walk exactly this list, so a table
   * added without a tenant_id column is a schema bug, not a leak. The
   * isolation tests assert the list matches the live schema. `tenants`
   * itself is not in the list: its key is `id`, and the tenant row goes last.
   * The order is the delete's order: children before the rows they point at,
   * because the foreign keys are enforced on node:sqlite.
   */
  const TENANT_TABLES = [
    "account_sessions", "account_tokens", "balance_ledger", "birthday_greetings",
    "customer_favorites", "customer_sessions", "drawer_movements", "guest_orders",
    "member_balances", "member_birthdays", "points_ledger", "order_item_holds",
    "order_item_notes", "order_item_vat_splits", "order_item_voids", "order_staff",
    "print_jobs", "receipt_items", "vouchers", "pos_sessions", "printer_status",
    "product_media", "product_stock",
    "app_settings", "audit_log", "balance_operators", "customer_verified_emails",
    "day_closings", "delivery_orders", "discovered_printers", "email_codes",
    "journal", "mail_outbox", "media_files", "print_bridges", "reservation_reminders",
    "reservations", "restaurant_settings", "restaurant_tables", "service_requests",
    "staff_settlements", "table_claim_meta", "table_claims", "table_sessions",
    "tenant_tokens", "waitlist",
    "order_items", "receipts", "customers", "accounts", "staff", "pos_devices",
    "printer_profiles", "products", "drawer_sessions",
    "orders",
  ];

  /**
   * The tenant's whole database, as plain rows — the export a restaurant
   * takes with it when it moves, or the owner keeps before a delete. Raw
   * rows, not views: the shape is the schema's, for a restore, not the API's.
   */
  async function exportTenantData(tenantIdArg) {
    const targetId = String(tenantIdArg ?? tenantId);
    const tenant = tenantView(await first(TENANT_BY_ID_SQL, targetId));
    if (!tenant) throw new Error("No such tenant");
    const tables = {};
    for (const name of TENANT_TABLES) tables[name] = await all(`SELECT * FROM ${name} WHERE tenant_id = ? ORDER BY rowid`, targetId);
    return { tenant, tables };
  }

  /**
   * The tenant, gone: every row it owns in every tenant table, then the
   * tenant row itself, in one batch — all or nothing. The default tenant
   * cannot be deleted: it is the deployment's own restaurant. This does not
   * audit: the audit row would be deleted with the tenant. The caller — the
   * owner dashboard (phase 3), acting as the platform owner — audits the
   * delete into the default tenant instead.
   */
  async function deleteTenant(tenantIdArg) {
    const targetId = String(tenantIdArg ?? tenantId);
    if (targetId === DEFAULT_TENANT_ID) throw new Error("The default tenant cannot be deleted");
    const tenant = tenantView(await first(TENANT_BY_ID_SQL, targetId));
    if (!tenant) throw new Error("No such tenant");
    const statements = [];
    for (const name of TENANT_TABLES) {
      // A receipt that refers to another receipt cannot go while the receipt
      // it refers to is still there: referrers first, then the rest.
      if (name === "receipts") statements.push(sql("DELETE FROM receipts WHERE tenant_id = ? AND refers_to IS NOT NULL", targetId));
      statements.push(sql(`DELETE FROM ${name} WHERE tenant_id = ?`, targetId));
    }
    const counts = await batch(statements);
    const deleted = {};
    let i = 0;
    for (const name of TENANT_TABLES) {
      deleted[name] = counts[i++];
      if (name === "receipts") deleted[name] += counts[i++];
    }
    await run("DELETE FROM tenants WHERE id = ?", targetId);
    return { tenant, deleted };
  }

  /**
   * Copies the default tenant's seed catalogue into a new tenant: every dish
   * and set menu under a NEW id (`<tenant>-<seed id>`, the seed ids would
   * collide on the products table's global id), bundle references remapped to
   * the new ids, the dishes' photos copied to new media files with the
   * product_media urls rewritten to them, and any stock rows carried over.
   * A tenant that already has dishes is left alone.
   */
  async function provisionTenant(tenantIdArg) {
    const targetId = String(tenantIdArg ?? tenantId);
    const tenant = tenantView(await first(TENANT_BY_ID_SQL, targetId));
    if (!tenant) throw new Error("No such tenant");
    const existing = await all("SELECT id FROM products WHERE tenant_id = ?", targetId);
    if (existing.length) return { tenant, products: existing.length, media: 0, files: 0, skipped: true };
    const seedProducts = await all("SELECT * FROM products WHERE tenant_id = ? ORDER BY sort_order, created_at", DEFAULT_TENANT_ID);
    const idMap = new Map(seedProducts.map((row) => [String(row.id), `${targetId}-${row.id}`]));
    const timestamp = now();
    const statements = [];
    for (const row of seedProducts) {
      const bundle = parseJson(row.bundle_items_json, []).map((item) => ({
        ...item,
        productId: idMap.get(String(item.productId)) ?? item.productId,
      }));
      statements.push(sql(PRODUCT_INSERT_SQL, ...productInsertParams({
        id: idMap.get(String(row.id)),
        sku: row.sku, kind: row.kind, category: row.category,
        nameZh: row.name_zh, nameDe: row.name_de, nameEn: row.name_en,
        description: row.description, priceCents: row.price_cents,
        allergensJson: row.allergens_json, prepTime: row.prep_time,
        portion: row.portion, level: row.level, ingredients: row.ingredients,
        art: row.art, pattern: row.pattern, tagColor: row.tag_color,
        available: row.available, published: row.published,
        sortOrder: row.sort_order, printStation: row.print_station,
        printPrinterId: row.print_printer_id, modifiersJson: row.modifiers_json,
        vatPercent: row.vat_percent, bundleItemsJson: JSON.stringify(bundle),
      }, timestamp, targetId)));
    }
    // The dishes' photos: each file copied under a new id, the media rows
    // rewritten to the new file and the new dish.
    const seedMedia = await all("SELECT * FROM product_media WHERE tenant_id = ? ORDER BY sort_order, created_at", DEFAULT_TENANT_ID);
    const fileMap = new Map();
    const fileIdOf = (url) => {
      const match = /^\/media\/(.+)$/.exec(String(url ?? ""));
      return match ? match[1] : null;
    };
    for (const mediaRow of seedMedia) {
      for (const url of [mediaRow.url, mediaRow.poster_url]) {
        const oldFileId = fileIdOf(url);
        if (!oldFileId || fileMap.has(oldFileId)) continue;
        if (!(await first("SELECT id FROM media_files WHERE tenant_id = ? AND id = ?", DEFAULT_TENANT_ID, oldFileId))) continue;
        const dot = String(oldFileId).lastIndexOf(".");
        const newFileId = `${uuid()}${dot > 0 ? String(oldFileId).slice(dot) : ""}`;
        fileMap.set(oldFileId, newFileId);
        statements.push(sql(
          "INSERT INTO media_files (id, tenant_id, content_type, bytes, credit, source_url, created_at) SELECT ?, ?, content_type, bytes, credit, source_url, ? FROM media_files WHERE tenant_id = ? AND id = ?",
          newFileId, targetId, timestamp, DEFAULT_TENANT_ID, oldFileId,
        ));
      }
    }
    for (const mediaRow of seedMedia) {
      const newProductId = idMap.get(String(mediaRow.product_id));
      if (!newProductId) continue;
      const rewrite = (url) => {
        const oldFileId = fileIdOf(url);
        return oldFileId && fileMap.has(oldFileId) ? `/media/${fileMap.get(oldFileId)}` : url;
      };
      statements.push(sql(
        "INSERT INTO product_media (id, tenant_id, product_id, type, url, poster_url, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        uuid(), targetId, newProductId, mediaRow.type, rewrite(mediaRow.url), mediaRow.poster_url ? rewrite(mediaRow.poster_url) : null, mediaRow.sort_order, timestamp,
      ));
    }
    const seedStock = await all("SELECT * FROM product_stock WHERE tenant_id = ?", DEFAULT_TENANT_ID);
    for (const stockRow of seedStock) {
      const newProductId = idMap.get(String(stockRow.product_id));
      if (!newProductId) continue;
      statements.push(sql(
        "INSERT INTO product_stock (tenant_id, product_id, daily_limit, stock_day, stock_left, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        targetId, newProductId, stockRow.daily_limit, stockRow.stock_day, stockRow.stock_left, timestamp,
      ));
    }
    // A D1 batch is one request: keep each under its statement budget.
    for (let index = 0; index < statements.length; index += 50) {
      await batch(statements.slice(index, index + 50));
    }
    return { tenant, products: seedProducts.length, media: seedMedia.length, files: fileMap.size, skipped: false };
  }

  /** A tenant's role token (its kitchen screen, its staff tablets): the raw token, returned once — only its SHA-256 is stored. */
  const TENANT_TOKEN_ROLES = new Set(["kitchen", "staff", "manager"]);
  async function createTenantToken(tenantIdArg, role) {
    const targetId = String(tenantIdArg ?? tenantId);
    if (!TENANT_TOKEN_ROLES.has(String(role))) throw new Error("A tenant token is for kitchen, staff or manager");
    if (!(await first(TENANT_BY_ID_SQL, targetId))) throw new Error("No such tenant");
    const token = newSessionToken();
    await run(INSERT_TENANT_TOKEN_SQL, await hashSessionToken(token), targetId, String(role), now());
    return { token, tenantId: targetId, role: String(role) };
  }

  async function tenantTokenFor(token) {
    if (!token) return null;
    const row = await first(TENANT_TOKEN_SQL, await hashSessionToken(token));
    return row ? { tenantId: row.tenant_id, role: row.role, createdAt: row.created_at } : null;
  }

  /**
   * The owner's view of a user's password (shared/tenant.mjs): the AES-GCM
   * copy beside the PBKDF2 hash, decrypted only while a view key is
   * configured. The account lookup is by id across tenants — the owner
   * manages every tenant's accounts, and the HTTP layer gates these methods
   * to the owner role — so they never leak through a tenant store on their
   * own. Every view and change is audit-logged, without the password itself.
   */
  async function setAccountPassword(accountId, { password }) {
    const row = await first(ACCOUNT_BY_ID_SQL, String(accountId));
    if (!row) return null;
    const stored = await hashPassword(assertPassword(password));
    const passwordEnc = passwordViewKey ? await encryptPasswordForOwner(password, passwordViewKey) : null;
    const at = now();
    await run(UPDATE_ACCOUNT_SQL, row.login, row.name, row.email ?? "", stored.hash, stored.salt, stored.iterations, passwordEnc, at, row.id);
    await run(DELETE_ACCOUNT_SESSIONS_SQL, row.id);
    await recordAudit({ role: "owner", ip: "", method: "SET_PASSWORD", route: `/api/admin/accounts/${row.id}/password`, status: 200, detail: { accountId: row.id, login: row.login } }, row.tenant_id ?? DEFAULT_TENANT_ID);
    return accountView(await first(ACCOUNT_BY_ID_SQL, row.id));
  }

  async function viewAccountPassword(accountId) {
    const row = await first(ACCOUNT_BY_ID_SQL, String(accountId));
    if (!row) return null;
    await recordAudit({ role: "owner", ip: "", method: "VIEW_PASSWORD", route: `/api/admin/accounts/${row.id}/password`, status: 200, detail: { accountId: row.id, login: row.login } }, row.tenant_id ?? DEFAULT_TENANT_ID);
    if (!row.password_enc || !passwordViewKey) return null;
    return decryptPasswordForOwner(row.password_enc, passwordViewKey);
  }

  /**
   * An invite: the admin account, with no password yet (it cannot sign in
   * until the link is used), plus the one-time link. The raw token is
   * returned once — only its SHA-256 is stored, for 7 days.
   */
  async function inviteAccount({ tenantId: inviteTenantId, login, name, email }) {
    const targetTenant = String(inviteTenantId ?? tenantId);
    const tenant = tenantView(await first(TENANT_BY_ID_SQL, targetTenant));
    if (!tenant) throw new Error("No such tenant");
    const loginNorm = normalizeLogin(login);
    const nameNorm = normalizeAccountName(name, loginNorm);
    const emailNorm = normalizeAccountEmail(email);
    if (await first(ACCOUNT_BY_LOGIN_SQL, loginNorm)) throw new Error("That account name is taken");
    const token = newSessionToken();
    const at = now();
    const id = uuid();
    const expiresAt = new Date(Date.now() + ACCOUNT_TOKEN_TTL_MS).toISOString();
    await batch([
      // No password yet: an empty hash, which verifyPassword refuses (shared/auth.mjs).
      sql(INSERT_ACCOUNT_SQL, id, targetTenant, ADMIN_ROLE, "active", loginNorm, nameNorm, emailNorm, "", "", 0, null, at, at),
      sql(INSERT_ACCOUNT_TOKEN_SQL, uuid(), "invite", targetTenant, id, loginNorm, nameNorm, emailNorm, await hashSessionToken(token), expiresAt, at),
    ]);
    await recordAudit({ role: "owner", ip: "", method: "INVITE_ACCOUNT", route: "/api/admin/accounts/invite", status: 201, detail: { accountId: id, login: loginNorm, tenantId: targetTenant } }, targetTenant);
    return { account: accountView(await first(ACCOUNT_BY_ID_SQL, id)), token };
  }

  /**
   * An invite or reset link used: the token must exist, be unused and
   * unexpired, and the account it names gets its password — hash, and the
   * owner's encrypted copy while a view key is configured. Null when the
   * link is no good. The token itself carries the tenant, so the link works
   * whatever store the caller built.
   */
  async function useAccountToken(token, { password }) {
    if (!token) return null;
    const row = await first(ACCOUNT_TOKEN_SQL, await hashSessionToken(token));
    if (!row || row.used_at || row.expires_at <= now()) return null;
    const account = await first(ACCOUNT_BY_ID_SQL, row.account_id);
    if (!account) return null;
    const stored = await hashPassword(assertPassword(password));
    const passwordEnc = passwordViewKey ? await encryptPasswordForOwner(password, passwordViewKey) : null;
    const at = now();
    // The token is marked used only while it still is unused and unexpired:
    // the loser of a race gets 0 changes and no password is set.
    if (!(await run(USE_ACCOUNT_TOKEN_SQL, at, row.id, at))) return null;
    await run(UPDATE_ACCOUNT_SQL, account.login, account.name, account.email ?? "", stored.hash, stored.salt, stored.iterations, passwordEnc, at, account.id);
    await run(DELETE_ACCOUNT_SESSIONS_SQL, account.id);
    await recordAudit({ role: "owner", ip: "", method: "USE_ACCOUNT_TOKEN", route: "/api/admin/accounts/set-password", status: 200, detail: { accountId: account.id, login: account.login, kind: row.kind } }, account.tenant_id ?? DEFAULT_TENANT_ID);
    return accountView(await first(ACCOUNT_BY_ID_SQL, account.id));
  }

  /**
   * A password reset link for an account, by login. Null when the login is
   * unknown — the caller must not learn whether it exists.
   */
  async function requestPasswordReset(loginInput) {
    const row = await first(ACCOUNT_BY_LOGIN_SQL, String(loginInput ?? "").trim().toLowerCase());
    if (!row) return null;
    const token = newSessionToken();
    const at = now();
    await run(INSERT_ACCOUNT_TOKEN_SQL, uuid(), "reset", row.tenant_id ?? DEFAULT_TENANT_ID, row.id, row.login, row.name, row.email ?? "", await hashSessionToken(token), new Date(Date.now() + ACCOUNT_TOKEN_TTL_MS).toISOString(), at);
    return { token, account: accountView(row) };
  }

  /**
   * Retention: what is past its life goes — expired sessions, spent auth
   * throttles, used or expired one-time links, expired email codes, the mail
   * outbox past 30 days and the audit log past 24 months. Counts per
   * category. Wiring (Worker cron, Node timer) is the caller's job.
   */
  async function purgeExpired() {
    const at = now();
    const twoYearsAgo = new Date();
    twoYearsAgo.setMonth(twoYearsAgo.getMonth() - 24);
    return {
      accountSessions: await run(DELETE_EXPIRED_ACCOUNT_SESSIONS_TENANT_SQL, tenantId, at),
      posSessions: await run("DELETE FROM pos_sessions WHERE tenant_id = ? AND expires_at <= ?", tenantId, at),
      customerSessions: await run("DELETE FROM customer_sessions WHERE tenant_id = ? AND expires_at <= ?", tenantId, at),
      // auth_throttle has no tenant column: the expired rows go globally.
      authThrottle: await run("DELETE FROM auth_throttle WHERE reset_at <= ?", at),
      accountTokens: await run("DELETE FROM account_tokens WHERE tenant_id = ? AND (used_at IS NOT NULL OR expires_at <= ?)", tenantId, at),
      emailCodes: await run("DELETE FROM email_codes WHERE tenant_id = ? AND expires_at <= ?", tenantId, at),
      mailOutbox: await run("DELETE FROM mail_outbox WHERE tenant_id = ? AND created_at < ?", tenantId, new Date(Date.now() - 30 * 86_400_000).toISOString()),
      auditLog: await run("DELETE FROM audit_log WHERE tenant_id = ? AND at < ?", tenantId, twoYearsAgo.toISOString()),
    };
  }

  const deliveryStore = createDeliveryStore(driver, { settings: getSettings, tenantId });

  return {
    listProducts,
    getProduct,
    setStock,
    saveProduct,
    deleteProduct: async (id) => (await run("DELETE FROM products WHERE tenant_id = ? AND id = ?", tenantId, String(id))) > 0,
    addMedia,
    duplicateProduct,
    renameCategory,
    setCategoryVat,
    getMediaFile,
    storeMedia,
    appIcons: async () => appIconsView(await storedAppIcons()),
    storedAppIcons,
    appIconFile,
    saveAppIcon,
    resetAppIcon,
    listOrders: async (limit = 100) => {
      const rows = await all(RECENT_ORDERS_SQL, tenantId, boundedLimit(limit));
      return viewOrders(rows);
    },
    createOrder,
    /** A guest's own order from the menu (shared/ordering.mjs): `guest` is { channel, customer, payment }. */
    placeGuestOrder: (input, guest) => createOrder(input, null, guest),
    openTable,
    closeTable: async (table) => (await run(CLOSE_TABLE_SESSION_SQL, tenantId, normalizeTableNo(table))) > 0,
    // Guests' accounts, favourites and points: the one implementation both backends share.
    customers: createCustomerStore(driver, {
      ordersFor: (rows) => viewOrders(rows),
      membershipConfig: async () => { const s = await getSettings(); return { memberTiers: s.memberTiers, birthdayPerk: s.birthdayPerk, timeZone: s.timeZone }; },
      tenantId
    }),
    // Table reservations (shared/reservation-store.mjs), both backends alike.
    reservations: createReservationStore(driver, { settings: getSettings, tenantId }),
    // The walk-in waitlist (shared/waitlist-store.mjs), both backends alike.
    waitlist: createWaitlistStore(driver, { tenantId }),
    // Orders from the delivery platforms (shared/delivery-store.mjs), both backends alike.
    delivery: deliveryStore,
    /** For what the backends add of their own (seeding, the Node print agent). */
    driver,
    updateOrder,
    listServiceRequests: async (limit = 100) =>
      (await all("SELECT * FROM service_requests WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?", tenantId, boundedLimit(limit))).map(serviceRequestView),
    createServiceRequest,
    openServiceRequests,
    updateServiceRequest,
    listPrinters: async () => (await all(PRINTERS_WITH_STATUS_SQL, tenantId)).map(printerView),
    savePrinter,
    deletePrinter: async (id) => (await run("DELETE FROM printer_profiles WHERE tenant_id = ? AND id = ?", tenantId, String(id))) > 0,
    getSettings,
    saveSettings,
    accountStatus,
    registerAccount,
    signInAccount,
    updateAccount,
    recoverAccount,
    signOut,
    roleForSession,
    resolveTenant,
    tenantForCustomerEmail,
    pairDevice,
    deviceForToken,
    listDevices: async () => (await all("SELECT * FROM pos_devices WHERE tenant_id = ? ORDER BY created_at", tenantId)).map(deviceView),
    deleteDevice: async (id) => (await run("DELETE FROM pos_devices WHERE tenant_id = ? AND id = ?", tenantId, String(id))) > 0,
    listStaff: async (activeOnly = false) => (await all("SELECT * FROM staff WHERE tenant_id = ? ORDER BY active DESC, name", tenantId)).filter((row) => !activeOnly || row.active).map(staffView),
    saveStaff,
    posSignIn,
    posSignOut: async (token) => (token ? (await run("DELETE FROM pos_sessions WHERE tenant_id = ? AND token_hash = ?", tenantId, await hashSessionToken(token))) > 0 : false),
    claimTable,
    holdsTable,
    voidItem,
    urgeItem,
    fireItem,
    reprintReceipt,
    setAvailable,
    releaseTable: async (table, pos, force = false) => {
      const tableNo = String(table).trim().toUpperCase();
      const released = (await run("DELETE FROM table_claims WHERE tenant_id = ? AND table_no = ? AND (device_id = ? OR ? = 1)", tenantId, tableNo, pos.deviceId, force ? 1 : 0)) > 0;
      // Letting the table go drops its collaborative flag and fencing token too,
      // so the next party that sits there starts over.
      if (released) await run("DELETE FROM table_claim_meta WHERE tenant_id = ? AND table_no = ?", tenantId, tableNo);
      return released;
    },
    liveClaims: async () => (await all(LIVE_CLAIMS_SQL, tenantId, now())).map((row) => claimView(row)),
    newTakeaway,
    moveTable,
    settleStaff,
    staffSettlementPreview: async (staffId) => settlementTotals(await all(OPEN_STAFF_RECEIPTS_SQL, tenantId, String(staffId), String(staffId)), await all(OPEN_STAFF_VOIDS_SQL, tenantId, String(staffId), String(staffId))),
    listSettlements: async (limit = 30) => (await all("SELECT * FROM staff_settlements WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?", tenantId, Math.min(Number(limit) || 30, 200))).map(settlementView),
    listPrintJobs: async (status = "queued", limit = 100) =>
      (await all("SELECT * FROM print_jobs WHERE tenant_id = ? AND status = ? ORDER BY created_at LIMIT ?", tenantId, String(status), boundedLimit(limit)))
        .map(printJobView),
    retryPrintJob: async (id) =>
      (await run(
        "UPDATE print_jobs SET status = 'queued', attempts = 0, error = NULL, claimed_by = NULL, lease_until = NULL, next_attempt_at = NULL, updated_at = ? WHERE tenant_id = ? AND id = ? AND status = 'failed'",
        now(), tenantId, String(id)
      )) > 0,

    /**
     * The print agent runs in the restaurant, next to the printers, and claims
     * work over HTTP now instead of opening the database file. The lease is what
     * stops two agents printing the same ticket: the UPDATE only lands if the
     * job is still claimable, so a loser gets 0 changes and asks again.
     */
    /**
     * The print bridge's way in: up to `max` jobs across the stations it
     * serves, oldest first, each claimed the way claimPrintJob claims one.
     */
    claimPrintJobs: async (roles, workerId, leaseMs = 30_000, max = 5) => {
      const stations = [...new Set((Array.isArray(roles) ? roles : []).map(String))].filter((role) => PRINT_STATIONS.has(role));
      if (!stations.length) return [];
      const timestamp = now();
      const leaseUntil = new Date(Date.now() + leaseMs).toISOString();
      const candidates = await all(
        `SELECT * FROM print_jobs WHERE tenant_id = ? AND printer_role IN (${stations.map(() => "?").join(", ")})
           AND ((status = 'queued')
             OR (status = 'retry-wait' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
             OR (status = 'claimed' AND lease_until <= ?))
         ORDER BY created_at LIMIT ?`,
        tenantId, ...stations, timestamp, timestamp, Math.min(20, Math.max(1, Number(max) || 5))
      );
      const claimed = [];
      for (const job of candidates) {
        const changed = await run(
          `UPDATE print_jobs SET status = 'claimed', claimed_by = ?, lease_until = ?, updated_at = ?
           WHERE tenant_id = ? AND id = ? AND (status = 'queued' OR status = 'retry-wait' OR (status = 'claimed' AND lease_until <= ?))`,
          String(workerId), leaseUntil, timestamp, tenantId, job.id, timestamp
        );
        if (changed) claimed.push(printJobView({ ...job, status: "claimed", claimed_by: String(workerId), lease_until: leaseUntil }));
      }
      return claimed;
    },
    claimPrintJob: async (role, workerId, leaseMs = 30_000) => {
      const timestamp = now();
      const leaseUntil = new Date(Date.now() + leaseMs).toISOString();
      const job = await first(
        `SELECT * FROM print_jobs WHERE tenant_id = ? AND printer_role = ?
           AND ((status = 'queued')
             OR (status = 'retry-wait' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
             OR (status = 'claimed' AND lease_until <= ?))
         ORDER BY created_at LIMIT 1`,
        tenantId, String(role), timestamp, timestamp
      );
      if (!job) return null;
      const changed = await run(
        `UPDATE print_jobs SET status = 'claimed', claimed_by = ?, lease_until = ?, updated_at = ?
         WHERE tenant_id = ? AND id = ? AND (status = 'queued' OR status = 'retry-wait' OR (status = 'claimed' AND lease_until <= ?))`,
        String(workerId), leaseUntil, timestamp, tenantId, job.id, timestamp
      );
      if (!changed) return null;
      return { ...job, status: "claimed", claimed_by: String(workerId), lease_until: leaseUntil, payload: parseJson(job.payload_json, {}) };
    },
    completePrintJob: async (id, workerId) =>
      (await run(
        "UPDATE print_jobs SET status = 'printed', claimed_by = NULL, lease_until = NULL, next_attempt_at = NULL, error = NULL, updated_at = ? WHERE tenant_id = ? AND id = ? AND status = 'claimed' AND claimed_by = ?",
        now(), tenantId, String(id), String(workerId)
      )) > 0,
    failPrintJob: async (id, workerId, error, maxAttempts = 5) => {
      const current = await first("SELECT * FROM print_jobs WHERE tenant_id = ? AND id = ?", tenantId, String(id));
      if (!current || current.claimed_by !== String(workerId)) return false;
      const { status, nextAttemptAt } = planPrintFailure(current.attempts, maxAttempts);
      return (await run(
        "UPDATE print_jobs SET status = ?, attempts = attempts + 1, error = ?, claimed_by = NULL, lease_until = NULL, next_attempt_at = ?, updated_at = ? WHERE tenant_id = ? AND id = ? AND status = 'claimed' AND claimed_by = ?",
        status, String(error).slice(0, 1000), nextAttemptAt, now(), tenantId, String(id), String(workerId)
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
    /** Sales over the manager's days, from the receipts (shared/reports.mjs). */
    salesReport: async (from, to) => {
      const range = reportRange(from, to);
      const rows = await all(REPORT_RECEIPTS_SQL, tenantId, range.readFrom, range.readTo);
      const report = salesReport(rows, range, (await getSettings()).timeZone);
      // The delivery platforms' orders beside the register's: their money is the platform's to collect, not in the receipts.
      report.delivery = await deliveryStore.totalsFor(range.readFrom, range.readTo, range.from, range.to);
      return report;
    },
    /** 会员数据看板: read-only member analytics over the manager's days (shared/reports.mjs). */
    memberReport: async (from, to) => {
      const range = reportRange(from, to);
      const [memberCounts, balanceTotal, newMembers, balanceLedger, pointsLedger, topBalance, topPoints] = await Promise.all([
        first("SELECT COUNT(*) AS members, COALESCE(SUM(points), 0) AS points FROM customers WHERE tenant_id = ?", tenantId),
        first("SELECT COALESCE(SUM(balance_cents), 0) AS balance_cents FROM member_balances WHERE tenant_id = ?", tenantId),
        all(MEMBER_NEW_SQL, tenantId, range.readFrom, range.readTo),
        all(MEMBER_BALANCE_LEDGER_SQL, tenantId, range.readFrom, range.readTo),
        all(MEMBER_POINTS_LEDGER_SQL, tenantId, range.readFrom, range.readTo),
        all(MEMBER_TOP_BALANCE_SQL, tenantId),
        all(MEMBER_TOP_POINTS_SQL, tenantId)
      ]);
      const data = {
        totals: { members: memberCounts?.members ?? 0, points: memberCounts?.points ?? 0, balanceCents: balanceTotal?.balance_cents ?? 0 },
        newMembers, balanceLedger, pointsLedger, topBalance, topPoints
      };
      return memberReport(data, range, (await getSettings()).timeZone);
    },
    /**
     * Wrong passwords and PINs, counted in the database so that every Worker
     * isolate and every Node process adds to the same count (shared/http.mjs).
     * `entries` are [key, limit]; `retryAfter` is the seconds until the most
     * spent of them opens again, or 0.
     */
    authThrottle: {
      async retryAfter(entries) {
        const at = now();
        let wait = 0;
        for (const [key, limit] of entries) {
          const row = await first("SELECT failures, reset_at FROM auth_throttle WHERE key = ? AND reset_at > ?", key, at);
          if (row && row.failures >= limit) wait = Math.max(wait, Math.ceil((Date.parse(row.reset_at) - Date.now()) / 1000));
        }
        return wait;
      },
      async fail(keys, windowMs) {
        const at = now();
        const resetAt = new Date(Date.now() + windowMs).toISOString();
        await batch([
          sql("DELETE FROM auth_throttle WHERE reset_at <= ?", at),
          ...keys.map((key) => sql(
            `INSERT INTO auth_throttle (key, failures, reset_at) VALUES (?, 1, ?)
             ON CONFLICT(key) DO UPDATE SET failures = auth_throttle.failures + 1`,
            key, resetAt
          ))
        ]);
      },
      async clear(keys) {
        await batch(keys.map((key) => sql("DELETE FROM auth_throttle WHERE key = ?", key)));
      }
    },
    /** The database answers: what /api/health asks. */
    ping: async () => Boolean(await first("SELECT 1 AS ok")),
    hasTables: async () => Boolean(await first("SELECT table_no FROM restaurant_tables WHERE tenant_id = ? LIMIT 1", tenantId)),
    /** Whether a waiter has opened the table for its guests to order (开台), and it has not run out. */
    /** The drinks ordered most in the last `days`, cancelled orders aside: what the cart offers when the owner picked none. */
    topDrinks: async (days = 30, limit = 3) => (await all(
      `SELECT order_items.product_id AS id, SUM(order_items.quantity) AS sold FROM order_items
         JOIN orders ON orders.id = order_items.order_id AND orders.tenant_id = order_items.tenant_id
         JOIN products ON products.id = order_items.product_id AND products.tenant_id = order_items.tenant_id
       WHERE order_items.tenant_id = ? AND products.kind = 'drink' AND orders.status <> 'cancelled' AND orders.created_at >= ?
       GROUP BY order_items.product_id ORDER BY sold DESC, order_items.product_id LIMIT ?`,
      tenantId, new Date(Date.now() - days * 86_400_000).toISOString(), limit
    )).map((row) => String(row.id)),
    tableOpenForGuests: async (table) => Boolean(await first("SELECT table_no FROM table_sessions WHERE tenant_id = ? AND table_no = ? AND expires_at > ?", tenantId, String(table), now())),
    // 2 before 10: numbers in the order a waiter counts them.
    listTables: async () => (await all("SELECT * FROM restaurant_tables WHERE tenant_id = ? ORDER BY length(table_no), table_no", tenantId)).map(tableView),
    getTable: async (table) => tableView(await first("SELECT * FROM restaurant_tables WHERE tenant_id = ? AND table_no = ?", tenantId, normalizeTableNo(table))),
    saveTable: async (input) => {
      const table = normalizeTableNo(input.table);
      const current = await first("SELECT * FROM restaurant_tables WHERE tenant_id = ? AND table_no = ?", tenantId, table);
      const timestamp = now();
      const token = input.rotateToken || !current ? entryToken() : current.token;
      await run(
        `INSERT INTO restaurant_tables (tenant_id, table_no, label, token, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, table_no) DO UPDATE SET label = excluded.label, token = excluded.token,
           enabled = excluded.enabled, updated_at = excluded.updated_at`,
        tenantId,
        table,
        String(input.label ?? current?.label ?? "").trim(),
        token,
        bool(input.enabled, current ? Boolean(current.enabled) : true) ? 1 : 0,
        current?.created_at ?? timestamp,
        timestamp
      );
      return tableView(await first("SELECT * FROM restaurant_tables WHERE tenant_id = ? AND table_no = ?", tenantId, table));
    },
    /**
     * Tables 1 to `count` set up in one go, for the table cards: each gets an
     * entry code of its own, and a table already there keeps the code on the
     * card that stands on it.
     */
    registerNumberedTables: async (count) => {
      const numbers = Array.from({ length: count }, (_, index) => String(index + 1));
      const existing = new Set((await all("SELECT table_no FROM restaurant_tables WHERE tenant_id = ?", tenantId)).map((row) => row.table_no));
      const missing = numbers.filter((table) => !existing.has(table));
      const timestamp = now();
      if (missing.length) {
        await batch(missing.map((table) => sql(
          "INSERT INTO restaurant_tables (tenant_id, table_no, label, token, enabled, created_at, updated_at) VALUES (?, ?, '', ?, 1, ?, ?) ON CONFLICT(tenant_id, table_no) DO NOTHING",
          tenantId, table, entryToken(), timestamp, timestamp
        )));
      }
      const wanted = new Set(numbers);
      const tables = (await all("SELECT * FROM restaurant_tables WHERE tenant_id = ? ORDER BY length(table_no), table_no", tenantId)).filter((row) => wanted.has(row.table_no)).map(tableView);
      return { tables, created: missing.length };
    },
    /**
     * The by-letter generator: `letters` zones A, B, C … each with `perLetter`
     * tables, giving A1, A2 … A{n}, B1 … in that order. The names it would make
     * mirror the console's preview exactly, capped at 400 so one click can't
     * flood the room. Tables that already exist keep their code; only the
     * missing ones are inserted. The result is sorted in generation order (A2
     * before A10), so the printable cards come out in the order a manager laid
     * the room out.
     */
    registerLetteredTables: async ({ letters, perLetter }) => {
      const names = [];
      for (let zone = 0; zone < letters && names.length < 400; zone += 1) {
        const letter = String.fromCharCode(65 + zone);
        for (let n = 1; n <= perLetter && names.length < 400; n += 1) names.push(`${letter}${n}`);
      }
      const order = new Map(names.map((name, index) => [name, index]));
      const existing = new Set((await all("SELECT table_no FROM restaurant_tables WHERE tenant_id = ?", tenantId)).map((row) => row.table_no));
      const missing = names.filter((table) => !existing.has(table));
      const timestamp = now();
      if (missing.length) {
        await batch(missing.map((table) => sql(
          "INSERT INTO restaurant_tables (tenant_id, table_no, label, token, enabled, created_at, updated_at) VALUES (?, ?, '', ?, 1, ?, ?) ON CONFLICT(tenant_id, table_no) DO NOTHING",
          tenantId, table, entryToken(), timestamp, timestamp
        )));
      }
      const wanted = new Set(names);
      const tables = (await all("SELECT * FROM restaurant_tables WHERE tenant_id = ?", tenantId))
        .filter((row) => wanted.has(row.table_no))
        .sort((a, b) => order.get(a.table_no) - order.get(b.table_no))
        .map(tableView);
      return { tables, created: missing.length };
    },
    /**
     * A table given another number, a label, or both. The number changes only
     * while nobody is at the table: an open bill, a waiter on a POS or guests
     * ordering from their phones all hang on the number. The card on the table
     * keeps its code, so it only needs the new number written on it.
     */
    renameTable: async (fromInput, input) => {
      const from = normalizeTableNo(fromInput);
      const to = input.table === undefined ? from : normalizeTableNo(input.table);
      const current = await first("SELECT * FROM restaurant_tables WHERE tenant_id = ? AND table_no = ?", tenantId, from);
      if (!current) return null;
      if (to !== from) {
        if (await first("SELECT table_no FROM restaurant_tables WHERE tenant_id = ? AND table_no = ?", tenantId, to)) throw tableConflict(`Table ${to} already exists`, "TABLE_EXISTS");
        await assertTableIdle(from);
        await assertTableIdle(to);
      }
      const timestamp = now();
      await batch([
        sql("UPDATE restaurant_tables SET table_no = ?, label = ?, updated_at = ? WHERE tenant_id = ? AND table_no = ?", to, String(input.label ?? current.label ?? "").trim(), timestamp, tenantId, from),
        ...(to !== from ? [sql(CLOSE_TABLE_SESSION_SQL, tenantId, from)] : [])
      ]);
      return tableView(await first("SELECT * FROM restaurant_tables WHERE tenant_id = ? AND table_no = ?", tenantId, to));
    },
    /** A table taken out of the room, once nobody is at it. */
    deleteTable: async (table) => {
      const tableNo = normalizeTableNo(table);
      if (!await first("SELECT table_no FROM restaurant_tables WHERE tenant_id = ? AND table_no = ?", tenantId, tableNo)) return false;
      await assertTableIdle(tableNo);
      return (await run("DELETE FROM restaurant_tables WHERE tenant_id = ? AND table_no = ?", tenantId, tableNo)) > 0;
    },
    /** Throws when another device has the table open: what the console and other POS may not touch. */
    assertTableFree: async (table, deviceId = null) =>
      assertClaim(await first(CLAIM_WITH_META_SQL, tenantId, String(table).trim().toUpperCase()), deviceId),
    setTableLock: async (table, locked) => {
      const tableNo = normalizeTableNo(table);
      if (!await first("SELECT table_no FROM restaurant_tables WHERE tenant_id = ? AND table_no = ?", tenantId, tableNo)) return null;
      const timestamp = now();
      await run("UPDATE restaurant_tables SET locked_at = ?, updated_at = ? WHERE tenant_id = ? AND table_no = ?", locked ? timestamp : null, timestamp, tenantId, tableNo);
      return tableView(await first("SELECT * FROM restaurant_tables WHERE tenant_id = ? AND table_no = ?", tenantId, tableNo));
    },

    /**
     * Every table the floor has to look at, whether or not it is registered.
     *
     * An unregistered table with orders on it is real — someone scanned a card
     * that was deleted, or typed a number — so it appears as seated rather
     * than not appearing at all.
     */
    tablesOverview: async () => {
      const orders = await viewOrders(await all(OPEN_TABLE_ORDERS_SQL, tenantId));
      const claims = (await all(LIVE_CLAIMS_SQL, tenantId, now())).map((row) => claimView(row));
      const { floorTables } = await getSettings();
      // Tables 1 to floorTables stand in until the manager sets the room up;
      // from then on the room is the tables they set up, added and taken away.
      const tableRows = await all("SELECT * FROM restaurant_tables WHERE tenant_id = ? ORDER BY table_no", tenantId);
      return tablesOverviewView(tableRows, orders, claims, await all(LIVE_TABLE_SESSIONS_SQL, tenantId, now()), tableRows.length ? 0 : floorTables);
    },
    staffActivity: async () => {
      const staffRows = await all("SELECT * FROM staff WHERE tenant_id = ? ORDER BY active DESC, name", tenantId);
      const shifts = new Map();
      for (const row of staffRows) shifts.set(row.id, settlementTotals(await all(OPEN_STAFF_RECEIPTS_SQL, tenantId, row.id, row.id), await all(OPEN_STAFF_VOIDS_SQL, tenantId, row.id, row.id)));
      const claims = (await all(LIVE_CLAIMS_SQL, tenantId, now())).map((row) => claimView(row));
      return staffActivityView(staffRows, await all(LIVE_POS_SESSIONS_SQL, tenantId, now()), claims, shifts);
    },
    openBillTables: async () =>
      (await all("SELECT DISTINCT table_no FROM orders WHERE tenant_id = ? AND billed_at IS NULL AND status <> 'cancelled' ORDER BY table_no", tenantId))
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
        "INSERT INTO print_jobs (tenant_id, id, order_id, printer_role, payload_json, status, created_at, updated_at) VALUES (?, ?, ?, 'front', ?, 'queued', ?, ?)",
        tenantId, jobId, bill.orderIds[0], JSON.stringify({ kind: "bill", ...bill, issuedAt: timestamp }), timestamp, timestamp
      );
      return { ...bill, issuedAt: timestamp, printJobId: jobId };
    },
    checkout,
    topUp,
    stornoReceipt,
    closeDay,
    exportJournal,
    closingPreview: async () => closingTotals(await all(OPEN_RECEIPTS_TENANT_SQL, tenantId, tenantId)),
    drawer: {
      current: async () => drawerDetail(await first(OPEN_DRAWER_SQL, tenantId)),
      list: async (limit = 20) => Promise.all((await all("SELECT * FROM drawer_sessions WHERE tenant_id = ? AND closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT ?", tenantId, boundedLimit(limit, 20))).map(drawerDetail)),
      open: openDrawer,
      move: moveCash,
      close: closeDrawer
    },
    listClosings: async (limit = 30) => (await all("SELECT * FROM day_closings WHERE tenant_id = ? ORDER BY closing_no DESC LIMIT ?", tenantId, Math.min(Number(limit) || 30, 366))).map(closingView),
    listReceipts: async (limit = 50) => receiptDetails(await all("SELECT * FROM receipts WHERE tenant_id = ? ORDER BY receipt_no DESC LIMIT ?", tenantId, boundedLimit(limit, 50))),
    getReceipt: async (id) => receiptDetail(await first("SELECT * FROM receipts WHERE tenant_id = ? AND id = ?", tenantId, String(id))),
    getVoucher: async (code) => {
      const row = await first("SELECT * FROM vouchers WHERE tenant_id = ? AND code = ?", tenantId, normalizeVoucherCode(code));
      return row ? { code: row.code, valueCents: row.value_cents, balanceCents: row.balance_cents, voided: Boolean(row.voided_at), createdAt: row.created_at } : null;
    },

    // A valid token used beyond its role is worth recording, not just refusing.
    recordAudit,
    listAudit: async (limit = 100) =>
      (await all("SELECT * FROM audit_log WHERE tenant_id = ? ORDER BY at DESC, rowid DESC LIMIT ?", tenantId, boundedLimit(limit))).map(auditView),

    /** A test page for one printer, through the bridge like any ticket. */
    queueTestPrint: async (id) => {
      const printer = await first("SELECT * FROM printer_profiles WHERE tenant_id = ? AND id = ?", tenantId, String(id));
      if (!printer) return null;
      const at = now();
      const job = planTestPrint(printer, at);
      await run("INSERT INTO print_jobs (tenant_id, id, order_id, printer_role, payload_json, status, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, 'queued', ?, ?)", tenantId, job.id, job.printerRole, job.payloadJson, at, at);
      return { jobId: job.id };
    },
    /** A print bridge checking in: itself, and what it found at each printer. */
    recordBridgeReport: async (input) => {
      const report = normalizeBridgeReport(input);
      const at = now();
      const known = new Set((await all("SELECT id FROM printer_profiles WHERE tenant_id = ?", tenantId)).map((row) => row.id));
      await batch([
        sql(`INSERT INTO print_bridges (tenant_id, id, name, version, last_seen_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, version = excluded.version, last_seen_at = excluded.last_seen_at`, tenantId, report.id, report.name, report.version, at),
        ...report.printers.filter((printer) => known.has(printer.id)).map((printer) => sql(
          `INSERT INTO printer_status (tenant_id, printer_id, bridge_id, ok, error, checked_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(printer_id) DO UPDATE SET bridge_id = excluded.bridge_id, ok = excluded.ok, error = excluded.error, checked_at = excluded.checked_at`,
          tenantId, printer.id, report.id, printer.ok ? 1 : 0, printer.error, at
        )),
        // What this bridge found replaces what it found before.
        ...(report.discovered ? [
          sql("DELETE FROM discovered_printers WHERE tenant_id = ? AND bridge_id = ?", tenantId, report.id),
          ...report.discovered.map((entry) => sql(
            `INSERT INTO discovered_printers (tenant_id, address, port, escpos, bridge_id, seen_at) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(tenant_id, address, port) DO UPDATE SET escpos = excluded.escpos, bridge_id = excluded.bridge_id, seen_at = excluded.seen_at`,
            tenantId, entry.address, entry.port, entry.escpos ? 1 : 0, report.id, at
          ))
        ] : [])
      ]);
      return { ok: true, at };
    },
    /** What the bridges found on the shop's network that is not a printer here yet. */
    listDiscoveredPrinters: async () => (await all(
      `SELECT * FROM discovered_printers WHERE tenant_id = ? AND NOT EXISTS (
         SELECT 1 FROM printer_profiles WHERE printer_profiles.tenant_id = discovered_printers.tenant_id AND printer_profiles.address = discovered_printers.address AND COALESCE(printer_profiles.port, 9100) = discovered_printers.port)
       ORDER BY escpos DESC, address`, tenantId
    )).map(discoveredPrinterView),
    listPrintBridges: async () => (await all("SELECT * FROM print_bridges WHERE tenant_id = ? ORDER BY last_seen_at DESC LIMIT 20", tenantId)).map(printBridgeView),
    printQueue: async () => {
      const rows = await all("SELECT status, COUNT(*) AS count FROM print_jobs WHERE tenant_id = ? AND status IN ('queued', 'claimed', 'retry-wait', 'failed') GROUP BY status", tenantId);
      const count = (status) => Number(rows.find((row) => row.status === status)?.count ?? 0);
      return { waiting: count("queued") + count("claimed") + count("retry-wait"), failed: count("failed") };
    },
    printerForRole: async (role) => {
      const row = await first("SELECT * FROM printer_profiles WHERE tenant_id = ? AND role = ? AND enabled = 1 ORDER BY name LIMIT 1", tenantId, String(role));
      return printerView(row);
    },

    // ——— Tenants, and the owner's account powers (phase 3's HTTP routes call these).
    tenantId,
    withTenant,
    getTenant,
    getAccount,
    listTenants,
    createTenant,
    exportTenantData,
    deleteTenant,
    provisionTenant,
    createTenantToken,
    tenantTokenFor,
    inviteAccount,
    useAccountToken,
    requestPasswordReset,
    setAccountPassword,
    viewAccountPassword,
    purgeExpired
  };
}

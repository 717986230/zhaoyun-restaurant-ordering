/**
 * The delivery platforms' orders over any SQLite: one implementation for both
 * backends, over the same small driver as the reservations
 * (shared/reservation-store.mjs):
 *
 *   first(sql, ...params) → row | null
 *   all(sql, ...params)   → rows
 *   run(sql, ...params)   → number of rows changed
 *
 * What the platforms send and what they are told is shared/delivery.mjs; this
 * keeps the orders, and puts the kitchen tickets in the same print queue as
 * every other order. `settings()` is the store's own getSettings.
 *
 * An order is kept once per platform and platform id: a platform that sends
 * the same order again (it does, when our answer was slow) gets the one it
 * already sent back, and the kitchen does not cook it twice.
 */
import { now, uuid } from "./core.mjs";
import { leftToday, restaurantDay, TAKE_STOCK_SQL } from "./stock.mjs";
import {
  assertDeliveryTransition, DELIVERY_PROVIDER_IDS, DELIVERY_PROVIDERS, DELIVERY_RETENTION_DAYS, DELIVERY_STATUSES, deliveryError, deliveryOrderView,
  deliveryTickets, OPEN_DELIVERY_STATUSES, readDeliveryOrder, REJECT_REASONS
} from "./delivery.mjs";

const OPEN_SQL = OPEN_DELIVERY_STATUSES.map((status) => `'${status}'`).join(", ");
/** The records: a year at a time at most, as the other records. */
const MAX_LISTED_DAYS = 366;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const INSERT_SQL = `INSERT INTO delivery_orders
  (id, provider, external_id, reference, status, type, placed_at, due_at, customer_name, customer_phone, address, notes,
   items_json, total_cents, delivery_fee_cents, paid_online, test, prep_minutes, reject_reason, sync_status, sync_error, synced_at, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'none', NULL, NULL, ?, ?)`;
const PRINT_SQL = "INSERT INTO print_jobs (id, order_id, printer_role, payload_json, status, created_at, updated_at) VALUES (?, NULL, ?, ?, 'queued', ?, ?)";

/** A moment as the restaurant's calendar day. */
function localDate(timeZone) {
  const format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return (iso) => format.format(new Date(iso));
}

export function createDeliveryStore(driver, { settings }) {
  const byId = async (id) => driver.first("SELECT * FROM delivery_orders WHERE id = ?", String(id));

  /**
   * A customer's name, phone and address are the platform's to keep, and
   * ours only while the order is being cooked and fetched: a month after,
   * they are blanked; the dishes and the money stay for the owner's numbers.
   */
  async function forgetOld() {
    const before = new Date(Date.now() - DELIVERY_RETENTION_DAYS * 86_400_000).toISOString();
    await driver.run(
      "UPDATE delivery_orders SET customer_name = '', customer_phone = '', address = '', notes = '' WHERE created_at < ? AND (customer_name != '' OR customer_phone != '' OR address != '' OR notes != '')",
      before
    );
  }

  /** Our dishes by SKU, for the lines whose PLU names one: the station, and the names the kitchen knows. */
  async function productsFor(items) {
    const skus = [...new Set(items.map((item) => item.sku.toUpperCase()).filter(Boolean))];
    if (!skus.length) return new Map();
    const rows = await driver.all(
      `SELECT id, sku, name_zh, name_de, name_en, print_station, available FROM products WHERE UPPER(sku) IN (${skus.map(() => "?").join(", ")})`,
      ...skus
    );
    return new Map(rows.map((row) => [row.sku.toUpperCase(), row]));
  }

  /** The kitchen's tickets for an order, queued like any other order's; a void ticket when `kind` is "void". */
  async function queueTickets(row, kind = "order", reason = "") {
    const order = deliveryOrderView(row);
    const at = now();
    for (const ticket of deliveryTickets(order, await productsFor(order.items))) {
      const payload = kind === "void" ? { ...ticket.payload, kind: "void", reason } : ticket.payload;
      await driver.run(PRINT_SQL, uuid(), ticket.station, JSON.stringify(payload), at, at);
    }
  }

  /** Today's portions (shared/stock.mjs) of the dishes named by SKU, by product id. */
  async function stockOf(products) {
    const ids = [...products.values()].map((product) => String(product.id));
    if (!ids.length) return new Map();
    const rows = await driver.all(`SELECT * FROM product_stock WHERE product_id IN (${ids.map(() => "?").join(", ")})`, ...ids);
    return new Map(rows.map((row) => [String(row.product_id), row]));
  }

  /** How many of each of our dishes an order asks for, by product id. */
  function demandOf(order, products) {
    const demand = new Map();
    for (const item of order.items) {
      const product = item.sku ? products.get(item.sku.toUpperCase()) : null;
      if (product) demand.set(String(product.id), { product, quantity: (demand.get(String(product.id))?.quantity ?? 0) + item.quantity });
    }
    return demand;
  }

  /**
   * An accepted order's portions come off today's count, as a waiter's would.
   * Never refused here: the floor said yes, knowing what it had.
   */
  async function takeStock(row) {
    const order = deliveryOrderView(row);
    const products = await productsFor(order.items);
    const today = restaurantDay((await settings()).timeZone);
    const at = now();
    for (const [id, { quantity }] of demandOf(order, products)) await driver.run(TAKE_STOCK_SQL, today, quantity, today, at, id, today);
  }

  /**
   * What the floor should know before saying yes: the dishes in an order that
   * are sold out, by hand or by count, or have fewer portions left than it asks for.
   */
  async function shortages(order, today) {
    const products = await productsFor(order.items);
    const stock = await stockOf(products);
    const short = [];
    for (const [id, { product, quantity }] of demandOf(order, products)) {
      const left = product.available ? leftToday(stock.get(id), today) : 0;
      if (left !== null && quantity > left) short.push({ sku: product.sku, name: product.name_zh || product.name_de || product.name_en || product.sku, wanted: quantity, left });
    }
    return short;
  }

  async function setStatus(id, status, fields = {}) {
    const at = now();
    const sets = ["status = ?", "updated_at = ?"];
    const values = [status, at];
    for (const [column, value] of Object.entries(fields)) {
      sets.push(`${column} = ?`);
      values.push(value);
    }
    await driver.run(`UPDATE delivery_orders SET ${sets.join(", ")} WHERE id = ?`, ...values, String(id));
    return byId(id);
  }

  return {
    /**
     * A new order from a platform's webhook. Returns { order, created, autoAccepted }:
     * `created` false for one the platform sent before. An order from a
     * platform the owner has not switched on is refused, so the platform
     * keeps it on its own tablet instead of it vanishing here — unless it is
     * the console's made-up order (`simulate`), always a test order.
     */
    async receive(provider, payload, { simulate = false } = {}) {
      const current = await settings();
      const rules = current.delivery?.[provider];
      if (!DELIVERY_PROVIDERS[provider]) throw deliveryError("Unknown delivery platform", "UNKNOWN_PROVIDER", 404);
      if (!rules?.enabled && !simulate) throw deliveryError(`${DELIVERY_PROVIDERS[provider].name} is not switched on`, "DELIVERY_OFF", 409);
      const order = readDeliveryOrder(provider, payload);
      if (simulate) order.test = true;
      const known = await driver.first("SELECT * FROM delivery_orders WHERE provider = ? AND external_id = ?", provider, order.externalId);
      if (known) return { order: deliveryOrderView(known), created: false, autoAccepted: false };

      await forgetOld();
      const id = uuid();
      const at = now();
      const autoAccept = Boolean(rules?.enabled && rules.autoAccept);
      const status = autoAccept ? "accepted" : "new";
      try {
        await driver.run(
          INSERT_SQL, id, provider, order.externalId, order.reference || order.externalId.slice(-6), status, order.type, order.placedAt, order.dueAt,
          order.customerName, order.customerPhone, order.address, order.notes, JSON.stringify(order.items), order.totalCents, order.deliveryFeeCents,
          order.paidOnline ? 1 : 0, order.test ? 1 : 0, autoAccept ? rules.prepMinutes : null, at, at
        );
      } catch (error) {
        // The same order, sent twice at once: the other request kept it.
        const raced = await driver.first("SELECT * FROM delivery_orders WHERE provider = ? AND external_id = ?", provider, order.externalId);
        if (raced) return { order: deliveryOrderView(raced), created: false, autoAccepted: false };
        throw error;
      }
      const row = await byId(id);
      if (autoAccept) {
        await queueTickets(row);
        await takeStock(row);
      }
      return { order: deliveryOrderView(row), created: true, autoAccepted: autoAccept };
    },

    /**
     * The platform says what became of an order on its side: the customer or
     * the platform cancelled it. A kitchen already cooking it gets a void ticket.
     */
    async platformCancelled(provider, externalId, reason = "") {
      const row = await driver.first("SELECT * FROM delivery_orders WHERE provider = ? AND external_id = ?", provider, String(externalId));
      if (!row) return null;
      if (!OPEN_DELIVERY_STATUSES.includes(row.status)) return deliveryOrderView(row);
      const cooking = row.status !== "new";
      const updated = await setStatus(row.id, "cancelled", { reject_reason: String(reason || "PLATFORM").slice(0, 120) });
      if (cooking) await queueTickets(updated, "void", DELIVERY_PROVIDERS[provider].name);
      return deliveryOrderView(updated);
    },

    /**
     * The floor's answer: accept (with the minutes it takes), reject (and
     * why), ready, completed. Accepting prints the kitchen's tickets.
     * Returns { order, previous } or null for an unknown id.
     */
    async act(id, action, { prepMinutes, reason } = {}) {
      const row = await byId(id);
      if (!row) return null;
      const status = { accept: "accepted", reject: "rejected", ready: "ready", complete: "completed" }[action];
      if (!status) throw deliveryError("Unknown action", "BAD_ACTION", 400);
      assertDeliveryTransition(row.status, status);
      const current = await settings();
      if (action === "accept") {
        const minutes = prepMinutes === undefined ? current.delivery?.[row.provider]?.prepMinutes ?? 20 : Number(prepMinutes);
        if (!Number.isInteger(minutes) || minutes < 5 || minutes > 180) throw deliveryError("Preparation time is 5 to 180 minutes", "BAD_PREP");
        const updated = await setStatus(id, status, { prep_minutes: minutes });
        await queueTickets(updated);
        await takeStock(updated);
        return { order: deliveryOrderView(updated), previous: row.status };
      }
      if (action === "reject") {
        const why = REJECT_REASONS.includes(reason) ? reason : "OTHER";
        return { order: deliveryOrderView(await setStatus(id, status, { reject_reason: why })), previous: row.status };
      }
      return { order: deliveryOrderView(await setStatus(id, status)), previous: row.status };
    },

    /** What the platform said to our answer: sent, failed (and why), or nothing to send. */
    async recordSync(id, result) {
      const status = result.ok === null ? "none" : result.ok ? "sent" : "failed";
      await driver.run(
        "UPDATE delivery_orders SET sync_status = ?, sync_error = ?, synced_at = ? WHERE id = ?",
        status, result.ok === false ? String(result.error ?? "").slice(0, 300) : null, now(), String(id)
      );
      const row = await byId(id);
      return row ? deliveryOrderView(row) : null;
    },

    get: async (id) => {
      const row = await byId(id);
      return row ? deliveryOrderView(row) : null;
    },

    /**
     * The kitchen's view: what is being cooked and what waits for its rider,
     * soonest due first. `readyBy` is when the floor told the platform it
     * would be ready (the time it was accepted, plus the minutes it said).
     */
    async kitchen() {
      const rows = await driver.all("SELECT * FROM delivery_orders WHERE status IN ('accepted', 'ready') ORDER BY created_at LIMIT 200");
      const orders = rows.map((row) => {
        const order = deliveryOrderView(row);
        const readyBy = row.status === "accepted" && row.prep_minutes ? new Date(Date.parse(row.updated_at) + row.prep_minutes * 60_000).toISOString() : null;
        return { ...order, readyBy };
      });
      const due = (order) => Date.parse(order.readyBy ?? order.dueAt ?? order.createdAt);
      return orders.sort((a, b) => (a.status === b.status ? due(a) - due(b) : a.status === "accepted" ? -1 : 1));
    },

    /** The orders the floor still has to do something about, oldest first. */
    async open() {
      const rows = await driver.all(`SELECT * FROM delivery_orders WHERE status IN (${OPEN_SQL}) ORDER BY created_at LIMIT 200`);
      const today = restaurantDay((await settings()).timeZone);
      // A new one says, before anyone accepts it, which of its dishes the kitchen is out of.
      return Promise.all(rows.map(async (row) => {
        const order = deliveryOrderView(row);
        return row.status === "new" ? { ...order, shortages: await shortages(order, today) } : order;
      }));
    },

    /**
     * The records over the manager's days (the restaurant's calendar), newest
     * first, with what each platform brought in: orders cooked and their
     * money, test orders left out.
     */
    async list(from, to, { provider = "", status = "" } = {}) {
      if (!DATE.test(String(from)) || !DATE.test(String(to))) throw deliveryError("from and to are dates: YYYY-MM-DD", "BAD_RANGE");
      if (to < from) throw deliveryError("to comes before from", "BAD_RANGE");
      const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
      if (days > MAX_LISTED_DAYS) throw deliveryError(`At most ${MAX_LISTED_DAYS} days at once`, "BAD_RANGE");
      if (provider && !DELIVERY_PROVIDER_IDS.includes(provider)) throw deliveryError("Unknown delivery platform", "BAD_PROVIDER");
      if (status && !DELIVERY_STATUSES.includes(status)) throw deliveryError("Unknown status", "BAD_STATUS");
      await forgetOld();
      // A day wider on each side in UTC; the restaurant's own days are picked below.
      const readFrom = new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString();
      const readTo = new Date(Date.parse(`${to}T00:00:00Z`) + 2 * 86_400_000).toISOString();
      const rows = await driver.all("SELECT * FROM delivery_orders WHERE created_at >= ? AND created_at < ? ORDER BY created_at DESC LIMIT 5000", readFrom, readTo);
      const local = localDate((await settings()).timeZone);
      const inRange = rows.filter((row) => {
        const day = local(row.created_at);
        return day >= from && day <= to;
      });
      return {
        from,
        to,
        totals: deliveryTotals(inRange),
        orders: inRange.filter((row) => (!provider || row.provider === provider) && (!status || row.status === status)).map(deliveryOrderView)
      };
    },

    /** The report's line per platform, over rows already in the manager's days. */
    totalsFor: async (readFrom, readTo, from, to) => {
      const rows = await driver.all("SELECT provider, status, test, total_cents, created_at FROM delivery_orders WHERE created_at >= ? AND created_at < ?", readFrom, readTo);
      const local = localDate((await settings()).timeZone);
      return deliveryTotals(rows.filter((row) => {
        const day = local(row.created_at);
        return day >= from && day <= to;
      }));
    }
  };
}

/**
 * Per platform: the orders the kitchen cooked (accepted, ready, completed)
 * and their money, and how many were turned down or cancelled. Test orders
 * count for nothing.
 */
export function deliveryTotals(rows) {
  const totals = Object.fromEntries(DELIVERY_PROVIDER_IDS.map((id) => [id, { provider: id, name: DELIVERY_PROVIDERS[id].name, orders: 0, grossCents: 0, rejected: 0, cancelled: 0 }]));
  for (const row of rows) {
    const entry = totals[row.provider];
    if (!entry || row.test) continue;
    if (row.status === "rejected") entry.rejected += 1;
    else if (row.status === "cancelled") entry.cancelled += 1;
    else if (row.status !== "new") {
      entry.orders += 1;
      entry.grossCents += row.total_cents;
    }
  }
  return Object.values(totals);
}

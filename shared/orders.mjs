/**
 * Tables, orders and bills: the order and service-request lifecycles, the
 * room's overview, turning an order command into the rows to write
 * (planOrder), and a table's open bill with its VAT.
 *
 * Nothing here may import `node:` anything, so it runs unchanged on Workers.
 */

import { now, parseJson, uuid } from "./core.mjs";
import { assertSetServed, mainVatPercent, resolveModifiers, vatSplit } from "./products.mjs";

export const ORDER_STATUSES = new Set(["new", "preparing", "ready", "completed", "cancelled"]);
export const REQUEST_STATUSES = new Set(["open", "acknowledged", "completed", "cancelled"]);

const TABLE_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,7}$/;

export function normalizeTableNo(value) {
  const table = String(value ?? "").trim().toUpperCase();
  if (!TABLE_PATTERN.test(table)) throw new Error("Table number must be 1-8 letters or digits");
  return table;
}

export function tableView(row) {
  return row
    ? {
        table: row.table_no,
        label: row.label,
        token: row.token,
        enabled: Boolean(row.enabled),
        locked: Boolean(row.locked_at),
        lockedAt: row.locked_at ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    : null;
}

export const TABLE_STATES = new Set(["free", "seated", "locked"]);

/**
 * Orders with the waiter who took them on a POS and a takeaway's pickup
 * number (order_staff), for the board and the room. A guest's own order
 * has neither.
 */
const ORDERS_WITH_STAFF = `SELECT orders.*, order_staff.staff_name AS staff_name, order_staff.pickup_no AS pickup_no,
    guest_orders.channel AS guest_channel, guest_orders.points_spent AS points_spent
  FROM orders LEFT JOIN order_staff ON order_staff.order_id = orders.id LEFT JOIN guest_orders ON guest_orders.order_id = orders.id`;
/** One order, with who took it and how it came in: what an order's writer answers with. */
export const ORDER_BY_ID_SQL = `${ORDERS_WITH_STAFF} WHERE orders.id = ?`;
export const ORDER_BY_REQUEST_SQL = `${ORDERS_WITH_STAFF} WHERE orders.client_request_id = ?`;
export const RECENT_ORDERS_SQL = `${ORDERS_WITH_STAFF} ORDER BY orders.created_at DESC, orders.rowid DESC LIMIT ?`;
export const OPEN_TABLE_ORDERS_SQL = `${ORDERS_WITH_STAFF} WHERE orders.billed_at IS NULL AND orders.status <> 'cancelled' ORDER BY orders.table_no, orders.created_at`;

/**
 * One table as the floor sees it: is anyone sitting there, what have they
 * ordered, and may they order more.
 *
 * `locked` is service state, not configuration — `enabled` is what takes a
 * table out of the room altogether. A locked table refuses new orders, which
 * is what makes it useful while a bill is being settled, and settling the bill
 * releases it. The store gathers the rows; this decides what they mean.
 *
 * `claims` are the live table claims (claimView): who has each table open on
 * a POS. `sessions` are the tables open for guests to order (table_sessions
 * rows, still live).
 */
export function tablesOverviewView(tableRows, orders, claims = [], sessions = []) {
  const byTable = new Map();
  for (const order of orders) byTable.set(order.table, [...(byTable.get(order.table) ?? []), order]);
  const claimOf = new Map(claims.map((claim) => [claim.table, claim]));
  const sessionOf = new Map(sessions.map((session) => [session.table_no, session]));
  const overview = tableRows.map((row) => tableOverviewView(row, byTable.get(row.table_no) ?? [], "", claimOf.get(row.table_no), sessionOf.get(row.table_no)));
  const known = new Set(tableRows.map((row) => row.table_no));
  for (const tableNo of new Set([...byTable.keys(), ...sessionOf.keys()])) {
    if (!known.has(tableNo)) overview.push(tableOverviewView(null, byTable.get(tableNo) ?? [], tableNo, claimOf.get(tableNo), sessionOf.get(tableNo)));
  }
  return overview.sort((left, right) => left.table.localeCompare(right.table, "en", { numeric: true }));
}

export function tableOverviewView(row, orders = [], fallbackTable = "", claim = null, session = null) {
  const open = orders.filter((order) => order.status !== "cancelled");
  const view = tableView(row) ?? { table: String(fallbackTable), label: "", enabled: true, locked: false, lockedAt: null };
  return {
    table: view.table,
    label: view.label,
    enabled: view.enabled,
    locked: view.locked,
    lockedAt: view.lockedAt,
    // A table nobody has registered can still have orders on it, and it is
    // seated rather than invisible: the guest scanned something.
    registered: Boolean(row),
    state: view.locked ? "locked" : open.length ? "seated" : "free",
    orders: open,
    // What is still to pay: a line a receipt paid for is off the table's total.
    total: open.reduce((sum, order) => sum + order.items.reduce((part, item) => part + Math.round(item.unitPrice * 100) * (item.qty - (item.paid ?? 0) - (item.voided ?? 0)), 0), 0) / 100,
    since: open.length ? open.map((order) => order.createdAt).sort()[0] : null,
    // Open on a POS right now, and by whom.
    openOn: claim ? { staffId: claim.staffId, staffName: claim.staffName } : null,
    // Open for the guests to order from their phones (开台), until when.
    orderingUntil: session?.expires_at ?? null
  };
}

export const ORDER_TRANSITIONS = new Map([
  ["new", new Set(["preparing", "cancelled"])],
  ["preparing", new Set(["ready", "cancelled"])],
  ["ready", new Set(["completed", "cancelled"])],
  ["completed", new Set()],
  ["cancelled", new Set()]
]);

export const REQUEST_TRANSITIONS = new Map([
  ["open", new Set(["acknowledged", "completed", "cancelled"])],
  ["acknowledged", new Set(["completed", "cancelled"])],
  ["completed", new Set()],
  ["cancelled", new Set()]
]);

export function orderView(row, itemRows = []) {
  if (!row) return null;
  return {
    id: row.id,
    no: row.order_no,
    clientRequestId: row.client_request_id,
    table: row.table_no,
    status: row.status,
    note: row.note,
    // As ordered, less what was voided since.
    total: (row.total_cents - itemRows.reduce((sum, item) => sum + item.unit_price_cents * (item.voided_quantity ?? 0), 0)) / 100,
    items: itemRows.map((item) => ({
      id: item.product_id,
      name: item.product_name,
      qty: item.quantity,
      // How much of the line receipts have paid for, and how much was voided (ORDER_ITEMS_SQL).
      paid: item.paid_quantity ?? 0,
      voided: item.voided_quantity ?? 0,
      unitPrice: item.unit_price_cents / 100,
      printStation: item.print_station,
      vatPercent: item.vat_percent,
      modifiers: parseJson(item.modifiers_json, []).map((modifier) => ({ ...modifier, price: modifier.priceCents / 100 }))
    })),
    billedAt: row.billed_at ?? null,
    // Who took it on a POS, and a takeaway's number, when the query asked (RECENT_ORDERS_SQL).
    ...(row.staff_name ? { staffName: row.staff_name } : {}),
    ...(row.pickup_no ? { pickupNo: row.pickup_no } : {}),
    // A guest's own order from the menu: at the table or for pickup (shared/ordering.mjs).
    ...(row.guest_channel ? { channel: row.guest_channel } : {}),
    ...(row.points_spent ? { pointsSpent: row.points_spent } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function serviceRequestView(row) {
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

export function assertOrderTransition(currentStatus, status) {
  if (!ORDER_STATUSES.has(status)) throw new Error("Unsupported order status");
  if (currentStatus !== status && !ORDER_TRANSITIONS.get(currentStatus)?.has(status)) {
    throw new Error(`Invalid order transition: ${currentStatus} -> ${status}`);
  }
}

export function assertRequestTransition(currentStatus, status) {
  if (!REQUEST_STATUSES.has(status)) throw new Error("Unsupported service request status");
  if (currentStatus !== status && !REQUEST_TRANSITIONS.get(currentStatus)?.has(status)) {
    throw new Error(`Invalid service request transition: ${currentStatus} -> ${status}`);
  }
}

/** What marks a reward's line, on the kitchen ticket, the bill and the receipt. */
export const REWARD_MODIFIER = Object.freeze({ id: "reward", name: "积分兑换", names: { zh: "积分兑换", de: "Prämie (Punkte)", en: "Reward (points)" }, priceCents: 0 });

/** The ids of the products an order command refers to, so a driver can fetch
 *  them in whatever way it has before the rules run over the rows. */

export function orderProductIds(input) {
  return (Array.isArray(input.items) ? input.items : []).map((item) => String(item.id));
}

/**
 * Turns an order command plus the product rows it names into the exact rows to
 * write: one order, its items, and one print job per station. Validation and
 * money happen here, so a synchronous transaction and a D1 batch write the same
 * thing. `productRows` also holds the dishes inside any set ordered
 * (bundleComponentIds), for the set's VAT split.
 *
 * A kitchen ticket carries no prices and no tax: it is not a receipt, and
 * says so when printed. `meta` is what the server adds, never the order a
 * guest sends: the waiter's name and a takeaway's pickup number (the POS), how
 * a guest's own order came in (`guest`), and the rewards a signed-in guest may
 * order for points (`rewards`: dish id → points, `maxRewards` per order).
 */
export function planOrder(input, productRows, hours = {}, meta = {}) {
  const clientRequestId = String(input.clientRequestId || uuid());
  const table = String(input.table || "").trim();
  if (!table) throw new Error("Order requires a table number");
  if (!Array.isArray(input.items) || !input.items.length) throw new Error("Order requires at least one item");

  // A reward (shared/customer.mjs) is the dish for its points: the line costs
  // only its priced options, and says on the ticket and the bill what it is.
  let pointsSpent = 0;
  let rewardCount = 0;
  const resolved = input.items.map((item) => {
    const product = productRows.get(String(item.id));
    const quantity = Number(item.qty);
    if (!product || !product.published || !product.available) throw new Error(`Product ${item.id} is unavailable`);
    assertSetServed(product, hours);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error("Invalid item quantity");
    const modifiers = resolveModifiers(product, item.modifiers);
    const modifierTotalCents = modifiers.reduce((sum, modifier) => sum + modifier.priceCents, 0);
    if (!item.reward) return { product, quantity, modifiers, unitPriceCents: product.price_cents + modifierTotalCents };
    const points = meta.rewards?.get(String(product.id));
    if (!meta.rewards) throw new Error("Sign in to order a reward");
    if (!points) throw new Error(`${product.sku} is not a reward`);
    pointsSpent += points * quantity;
    rewardCount += quantity;
    return { product, quantity, modifiers: [...modifiers, REWARD_MODIFIER], unitPriceCents: modifierTotalCents };
  });
  if (rewardCount > (meta.maxRewards ?? 1)) throw new Error(`At most ${meta.maxRewards ?? 1} reward${(meta.maxRewards ?? 1) > 1 ? "s" : ""} per order`);

  const totalCents = resolved.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  const id = uuid();
  const timestamp = now();
  const orderNo = `${timestamp.slice(2, 10).replaceAll("-", "")}-${id.slice(0, 5).toUpperCase()}`;
  const note = String(input.note || "").trim();

  const items = [];
  const stations = new Map();
  for (const { product, quantity, modifiers, unitPriceCents } of resolved) {
    const productName = product.name_zh || product.name_de || product.name_en;
    const split = vatSplit(product, productRows, unitPriceCents);
    items.push({
      id: uuid(),
      orderId: id,
      productId: product.id,
      productName,
      quantity,
      unitPriceCents,
      printStation: product.print_station,
      modifiersJson: JSON.stringify(modifiers),
      vatPercent: mainVatPercent(split),
      // Kept only for a line over more than one rate (order_item_vat_splits).
      vatSplitJson: split.length > 1 ? JSON.stringify(split) : null
    });
    const stationItems = stations.get(product.print_station) || [];
    stationItems.push({
      sku: product.sku,
      name: productName,
      names: { zh: product.name_zh, de: product.name_de, en: product.name_en },
      quantity,
      modifiers: modifiers.map((modifier) => ({ name: modifier.name, names: modifier.names }))
    });
    stations.set(product.print_station, stationItems);
  }

  const printJobs = [...stations].map(([station, stationItems]) => ({
    id: uuid(),
    orderId: id,
    printerRole: station,
    // Who ordered it and the takeaway number come from the server (meta),
    // never from the order a guest sends.
    payloadJson: JSON.stringify({
      orderNo, table, note: String(input.note || ""), items: stationItems,
      ...(meta.staffName ? { staffName: meta.staffName } : {}),
      ...(meta.pickupNo ? { pickupNo: meta.pickupNo } : {}),
      // A guest's own order (shared/ordering.mjs): how it came in, and whose pickup it is.
      ...(meta.guest ? { guest: meta.guest } : {})
    })
  }));

  return {
    clientRequestId,
    order: { id, orderNo, clientRequestId, table, note, totalCents, timestamp },
    items,
    printJobs,
    pointsSpent
  };
}

/**
 * One table's open bill.
 *
 * Menu prices are gross, so VAT is extracted per rate group rather than added:
 * a 10% line of 39.90 is 36.27 net and 3.63 tax, and getting that backwards is
 * the mistake a POS integration most often arrives with. The rounding is done
 * once per rate group, not per line, which is what the tax office expects and
 * what keeps the group totals adding up to the printed total.
 *
 * This is an internal bill and says so. Under the RKSV the receipt a guest is
 * owed comes from the Registrierkasse, not from here.
 *
 * Pure, over rows both backends already have: `node:sqlite` reads them
 * synchronously and D1 does not, and that is the only difference between the
 * two. It lives here because a second, guessed implementation of a tax
 * calculation is the last thing this system needs.
 */
export function billView(tableNo, orderRows, itemsByOrderId, productsById, issuedAt = now()) {
  const items = [];
  const groups = new Map();
  let totalCents = 0;

  for (const order of orderRows) {
    for (const row of itemsByOrderId.get(order.id) ?? []) {
      // What receipts have paid for, or a void took back, is off the bill; a line settled in full is gone.
      const quantity = row.quantity - (row.paid_quantity ?? 0) - (row.voided_quantity ?? 0);
      if (quantity <= 0) continue;
      const lineCents = row.unit_price_cents * quantity;
      const vatPercent = row.vat_percent;
      // A line with no split kept is all at its own rate.
      const split = parseJson(row.vat_split_json, null) ?? [{ percent: vatPercent, cents: row.unit_price_cents }];
      // Guests read the bill: keep the localized names next to the snapshot name.
      const product = productsById.get(row.product_id);
      items.push({
        orderItemId: row.id,
        orderNo: order.order_no,
        name: row.product_name,
        names: product ? { zh: product.name_zh, de: product.name_de, en: product.name_en } : undefined,
        qty: quantity,
        unitPrice: row.unit_price_cents / 100,
        lineTotal: lineCents / 100,
        vatPercent,
        // A set menu over more than one rate shows each part.
        ...(split.length > 1 ? { vatSplit: split.map((part) => ({ percent: part.percent, amount: (part.cents * quantity) / 100 })) } : {}),
        modifiers: parseJson(row.modifiers_json, []).map((modifier) => ({ name: modifier.name, names: modifier.names }))
      });
      for (const part of split) groups.set(part.percent, (groups.get(part.percent) || 0) + part.cents * quantity);
      totalCents += lineCents;
    }
  }

  const vatBreakdown = [...groups.entries()].sort(([left], [right]) => left - right).map(([percent, grossCents]) => {
    const netCents = Math.round(grossCents / (1 + percent / 100));
    return { percent, gross: grossCents / 100, net: netCents / 100, vat: (grossCents - netCents) / 100 };
  });

  return {
    table: String(tableNo),
    orderNos: orderRows.map((order) => order.order_no),
    orderIds: orderRows.map((order) => order.id),
    items,
    vatBreakdown,
    total: totalCents / 100,
    issuedAt,
    fiscalReceipt: false
  };
}

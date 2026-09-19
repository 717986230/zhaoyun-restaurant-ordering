/**
 * Everything the ordering rules decide, with no database attached.
 *
 * This is the Worker's copy. The Node server in server/database.mjs grew its
 * own after the billing and table work landed there, so the two are held
 * together by shared/contract-suite.mjs instead — it runs the same assertions
 * against both and fails when they disagree, which is how the two mismatches
 * this file had (`serviceType` for `type`, and a raw print-job row) were found.
 * Folding the Node server back onto this module is worth doing; it is a change
 * of its own, not a rider on a merge.
 *
 * Nothing here may import `node:` anything, so it runs unchanged on Workers.
 */

export const ORDER_STATUSES = new Set(["new", "preparing", "ready", "completed", "cancelled"]);
export const REQUEST_STATUSES = new Set(["open", "acknowledged", "completed", "cancelled"]);
export const PRODUCT_KINDS = new Set(["food", "drink", "sushi"]);
export const PRINT_STATIONS = new Set(["kitchen", "bar", "sushi", "front"]);
export const PRINTER_TRANSPORTS = new Set(["lan", "bluetooth", "usb"]);

/**
 * Who may do what.
 *
 * Three shared tokens, one per role, and a rank so a route can ask for a
 * minimum rather than enumerate. A manager outranks a waiter outranks the
 * kitchen screen, and the catalogue — the menu, its prices and its allergen
 * declarations — is manager-only on both backends.
 *
 * This lives here because it is the one rule that must not differ between the
 * Node server and the Worker. It did: the Worker had a single token and no
 * roles at all, so a waiter tablet pointed at the Cloudflare deployment would
 * have been able to edit the menu. `shared/contract-suite.mjs` now asks both.
 */
export const STAFF_ROLES = ["kitchen", "staff", "manager"];
export const ROLE_RANK = { kitchen: 1, staff: 2, manager: 3 };

/**
 * `matches(expected)` is the runtime's own constant-time comparison against the
 * token the request carried — `node:crypto` on the server, a hand-rolled loop
 * on the Worker — so only the precedence lives here.
 *
 * Order matters: the manager token wins, and an unset staff or kitchen token
 * never matches, so a deployment that configures only ADMIN_TOKEN has exactly
 * one role rather than three aliases of it.
 */
export function resolveStaffRole(matches, tokens = {}) {
  if (tokens.manager && matches(tokens.manager)) return "manager";
  if (tokens.staff && matches(tokens.staff)) return "staff";
  if (tokens.kitchen && matches(tokens.kitchen)) return "kitchen";
  return null;
}

export function roleAllows(role, minimumRole) {
  return Boolean(role) && ROLE_RANK[role] >= ROLE_RANK[minimumRole];
}

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
 * One table as the floor sees it: is anyone sitting there, what have they
 * ordered, and may they order more.
 *
 * `locked` is service state, not configuration — `enabled` is what takes a
 * table out of the room altogether. A locked table refuses new orders, which
 * is what makes it useful while a bill is being settled, and settling the bill
 * releases it. Both backends aggregate their own rows; this decides what the
 * result means, so the two cannot disagree about when a table is free.
 */
export function tableOverviewView(row, orders = [], fallbackTable = "") {
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
    total: Math.round(open.reduce((sum, order) => sum + Math.round(order.total * 100), 0)) / 100,
    since: open.length ? open.map((order) => order.createdAt).sort()[0] : null
  };
}

export function auditView(row) {
  return {
    id: row.id, at: row.at, role: row.role, ip: row.ip, method: row.method,
    route: row.route, status: row.status, detail: parseJson(row.detail_json, {})
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

export function now() {
  return new Date().toISOString();
}

export function uuid() {
  return crypto.randomUUID();
}

export function bool(value, fallback = true) {
  if (value === undefined) return fallback ? 1 : 0;
  return value ? 1 : 0;
}

export function priceToCents(value) {
  const cents = Math.round(Number(value) * 100);
  if (!Number.isFinite(cents) || cents < 0) throw new Error("Price must be a positive number");
  return cents;
}

export function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

/** Caps a client-supplied limit the same way on both backends. */
export function boundedLimit(limit, fallback = 100, max = 500) {
  return Math.min(Number(limit) || fallback, max);
}

export function mapProduct(row, media = []) {
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

export function normalizeProduct(input, current = {}) {
  const names = input.names || {};
  const details = input.details || {};
  const appearance = input.appearance || {};
  const kind = input.kind || current.kind || "food";
  const printStation = input.printStation || current.print_station || (kind === "drink" ? "bar" : kind === "sushi" ? "sushi" : "kitchen");
  if (!PRODUCT_KINDS.has(kind)) throw new Error("Unsupported product kind");
  if (!PRINT_STATIONS.has(printStation)) throw new Error("Unsupported print station");

  const product = {
    id: String(input.id || current.id || uuid()),
    sku: String(input.sku || current.sku || "").trim(),
    kind,
    category: String(input.category || current.category || "OTHER").trim().replace(/\s+/g, " ").toUpperCase(),
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
    art: String(appearance.art ?? current.art ?? "linear-gradient(135deg,#2d3a35,#121416 78%)"),
    pattern: String(appearance.pattern ?? current.pattern ?? "lines"),
    modifiersJson: JSON.stringify(Array.isArray(input.modifiers) ? input.modifiers : parseJson(current.modifiers_json, [])),
    available: bool(input.available, current.available === undefined ? true : Boolean(current.available)),
    published: bool(input.published, current.published === undefined ? true : Boolean(current.published)),
    sortOrder: Number(input.sortOrder ?? current.sort_order ?? 0),
    printStation
  };

  if (!product.sku) product.sku = `ITEM-${product.id.slice(0, 8).toUpperCase()}`;
  if (!product.nameZh && !product.nameDe && !product.nameEn) throw new Error("At least one product name is required");
  return product;
}

export function orderView(row, itemRows = []) {
  if (!row) return null;
  return {
    id: row.id,
    no: row.order_no,
    clientRequestId: row.client_request_id,
    table: row.table_no,
    status: row.status,
    note: row.note,
    total: row.total_cents / 100,
    items: itemRows.map((item) => ({
      id: item.product_id,
      name: item.product_name,
      qty: item.quantity,
      unitPrice: item.unit_price_cents / 100,
      printStation: item.print_station,
      modifiers: parseJson(item.modifiers_json, []).map((modifier) => ({ ...modifier, price: modifier.priceCents / 100 }))
    })),
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

export function printerView(row) {
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

export function normalizePrinter(input, current = null) {
  const printer = {
    id: String(input.id || current?.id || uuid()),
    name: String(input.name ?? current?.name ?? "").trim(),
    transport: String(input.transport ?? current?.transport ?? "lan"),
    address: String(input.address ?? current?.address ?? "").trim(),
    port: input.port === null ? null : Number(input.port ?? current?.port ?? 9100),
    role: String(input.role ?? current?.role ?? "front"),
    enabled: bool(input.enabled, current ? Boolean(current.enabled) : true),
    capabilities: JSON.stringify(input.capabilities ?? parseJson(current?.capabilities_json, {}))
  };
  if (!printer.name || !printer.address) throw new Error("Printer name and address are required");
  if (!PRINTER_TRANSPORTS.has(printer.transport)) throw new Error("Unsupported printer transport");
  if (!PRINT_STATIONS.has(printer.role)) throw new Error("Unsupported printer role");
  if (printer.port !== null && (!Number.isInteger(printer.port) || printer.port < 1 || printer.port > 65535)) throw new Error("Printer port must be between 1 and 65535");
  return printer;
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

export function resolveModifiers(productRow, requested = []) {
  const groups = parseJson(productRow.modifiers_json, []);
  const options = new Map(groups.flatMap((group) => group.options.map((option) => [option.id, { ...option, groupId: group.id, selection: group.selection }])));
  const selected = [];
  const selectedGroups = new Map();
  for (const request of Array.isArray(requested) ? requested : []) {
    const option = options.get(String(request.id));
    if (!option) throw new Error(`Modifier ${request.id} is not available for ${productRow.sku}`);
    const count = (selectedGroups.get(option.groupId) || 0) + 1;
    if (option.selection === "single" && count > 1) throw new Error(`Only one modifier is allowed for ${option.groupId}`);
    if (selected.some((item) => item.id === option.id)) throw new Error(`Duplicate modifier ${option.id}`);
    selectedGroups.set(option.groupId, count);
    selected.push({ id: option.id, name: option.names.zh, names: option.names, priceCents: Number(option.priceCents) || 0 });
  }
  return selected;
}

/** The ids of the products an order command refers to, so a driver can fetch
 *  them in whatever way it has before the rules run over the rows. */
export function orderProductIds(input) {
  return (Array.isArray(input.items) ? input.items : []).map((item) => String(item.id));
}

/**
 * Turns an order command plus the product rows it names into the exact rows to
 * write: one order, its items, and one print job per station. Validation and
 * money happen here, so a synchronous transaction and a D1 batch write the same
 * thing.
 */
export function planOrder(input, productRows) {
  const clientRequestId = String(input.clientRequestId || uuid());
  const table = String(input.table || "").trim();
  if (!table) throw new Error("Order requires a table number");
  if (!Array.isArray(input.items) || !input.items.length) throw new Error("Order requires at least one item");

  const resolved = input.items.map((item) => {
    const product = productRows.get(String(item.id));
    const quantity = Number(item.qty);
    if (!product || !product.published || !product.available) throw new Error(`Product ${item.id} is unavailable`);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error("Invalid item quantity");
    const modifiers = resolveModifiers(product, item.modifiers);
    const modifierTotalCents = modifiers.reduce((sum, modifier) => sum + modifier.priceCents, 0);
    return { product, quantity, modifiers, unitPriceCents: product.price_cents + modifierTotalCents };
  });

  const totalCents = resolved.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  const id = uuid();
  const timestamp = now();
  const orderNo = `${timestamp.slice(2, 10).replaceAll("-", "")}-${id.slice(0, 5).toUpperCase()}`;
  const note = String(input.note || "").trim();

  const items = [];
  const stations = new Map();
  for (const { product, quantity, modifiers, unitPriceCents } of resolved) {
    const productName = product.name_zh || product.name_de || product.name_en;
    items.push({
      id: uuid(),
      orderId: id,
      productId: product.id,
      productName,
      quantity,
      unitPriceCents,
      printStation: product.print_station,
      modifiersJson: JSON.stringify(modifiers)
    });
    const stationItems = stations.get(product.print_station) || [];
    stationItems.push({
      sku: product.sku,
      name: productName,
      names: { zh: product.name_zh, de: product.name_de, en: product.name_en },
      quantity,
      modifiers: modifiers.map((modifier) => ({ name: modifier.name, names: modifier.names, price: modifier.priceCents / 100 }))
    });
    stations.set(product.print_station, stationItems);
  }

  const printJobs = [...stations].map(([station, stationItems]) => ({
    id: uuid(),
    orderId: id,
    printerRole: station,
    payloadJson: JSON.stringify({ orderNo, table, note: String(input.note || ""), items: stationItems })
  }));

  return {
    clientRequestId,
    order: { id, orderNo, clientRequestId, table, note, totalCents, timestamp },
    items,
    printJobs
  };
}

export function printJobView(row) {
  if (!row) return null;
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

/** Backoff for a print job that failed, shared so both backends give up and
 *  retry on the same schedule. */
export function planPrintFailure(attemptsSoFar, maxAttempts = 5) {
  const attempts = Number(attemptsSoFar || 0) + 1;
  const status = attempts >= maxAttempts ? "failed" : "retry-wait";
  const nextAttemptAt = status === "failed" ? null : new Date(Date.now() + Math.min(300_000, 2_000 * 2 ** Math.min(attempts, 7))).toISOString();
  return { status, nextAttemptAt };
}

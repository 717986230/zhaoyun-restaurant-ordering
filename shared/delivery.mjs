/**
 * Orders from the delivery platforms: Lieferando (Just Eat Takeaway, JET
 * Connect) and foodora (Delivery Hero, the POS plugin of its Integration
 * Middleware).
 *
 * Each platform pushes a new order to a webhook of ours and expects to be
 * told what became of it — accepted (and for when), rejected (and why),
 * ready. What differs between them is the shape of the JSON and how each
 * side proves who it is; that is all an adapter here knows. Everything after
 * — the kitchen tickets, the floor, the reports — sees one shape, the
 * `DeliveryOrder` below, whichever platform it came from.
 *
 * The platforms' partner documentation is only open to accounts they have
 * approved, so the field names are read tolerantly (both the PascalCase and
 * camelCase each has used) and the outbound calls sit in one function per
 * platform (`outboundRequest`), with the base address configurable — the one
 * place to adjust once the restaurant's partner account shows the exact
 * contract.
 *
 * Nothing here may import `node:` anything, so it runs unchanged on Workers.
 */

export const DELIVERY_PROVIDERS = {
  lieferando: { name: "Lieferando", prefix: "LF", defaultApiBase: "https://uk-partnerapi.just-eat.io" },
  foodora: { name: "foodora", prefix: "FD", defaultApiBase: "https://integration-middleware.eu.restaurant-partners.com" }
};
export const DELIVERY_PROVIDER_IDS = Object.keys(DELIVERY_PROVIDERS);

export const DELIVERY_STATUSES = ["new", "accepted", "ready", "completed", "rejected", "cancelled"];
/** What the floor still has to do something about. */
export const OPEN_DELIVERY_STATUSES = ["new", "accepted", "ready"];
/** The reasons a platform understands for turning an order down. */
export const REJECT_REASONS = ["TOO_BUSY", "CLOSED", "ITEM_UNAVAILABLE", "OUTSIDE_DELIVERY_AREA", "OTHER"];
/** Days after an order that the customer's name, phone and address are kept. */
export const DELIVERY_RETENTION_DAYS = 30;

const TRANSITIONS = {
  new: ["accepted", "rejected", "cancelled"],
  accepted: ["ready", "completed", "cancelled"],
  ready: ["completed", "cancelled"],
  completed: [],
  rejected: [],
  cancelled: []
};

export function deliveryError(message, code, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export function assertDeliveryTransition(from, to) {
  if (!TRANSITIONS[from]?.includes(to)) throw deliveryError(`A ${from} order cannot become ${to}`, "BAD_TRANSITION", 409);
}

/**
 * The platforms' secrets, from the host's environment (the Node server's, or
 * the Worker's secrets — the same names): what each proves itself with on our
 * webhook, and what we sign in to theirs with. Unset, a platform is not connected.
 */
export function deliveryConfig(env = {}) {
  return {
    lieferando: { webhookSecret: env.LIEFERANDO_WEBHOOK_SECRET || "", apiKey: env.LIEFERANDO_API_KEY || "", apiBase: env.LIEFERANDO_API_BASE || "" },
    foodora: { webhookSecret: env.FOODORA_WEBHOOK_SECRET || "", username: env.FOODORA_USERNAME || "", password: env.FOODORA_PASSWORD || "", apiBase: env.FOODORA_API_BASE || "" }
  };
}

// ——— The owner's switches, per platform (app_settings "delivery").

export const DELIVERY_SETTING_DEFAULTS = {
  lieferando: { enabled: false, autoAccept: false, prepMinutes: 20, storeId: "" },
  foodora: { enabled: false, autoAccept: false, prepMinutes: 20, storeId: "" }
};

export function normalizeDeliverySettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Delivery settings must be an object");
  const result = {};
  for (const id of DELIVERY_PROVIDER_IDS) {
    const input = { ...DELIVERY_SETTING_DEFAULTS[id], ...(value[id] ?? {}) };
    if (typeof input.enabled !== "boolean" || typeof input.autoAccept !== "boolean") throw new Error(`${DELIVERY_PROVIDERS[id].name}: switches are on or off`);
    const prep = Number(input.prepMinutes);
    if (!Number.isInteger(prep) || prep < 5 || prep > 180) throw new Error(`${DELIVERY_PROVIDERS[id].name}: preparation time is 5 to 180 minutes`);
    const storeId = String(input.storeId ?? "").trim();
    if (storeId.length > 64) throw new Error(`${DELIVERY_PROVIDERS[id].name}: the store id is at most 64 characters`);
    result[id] = { enabled: input.enabled, autoAccept: input.autoAccept, prepMinutes: prep, storeId };
  }
  return result;
}

// ——— Reading what a platform sent.

/** The first of `keys` that `object` has, whatever case the platform wrote it in. */
function pick(object, ...keys) {
  if (!object || typeof object !== "object") return undefined;
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null) return object[key];
    const other = key[0] === key[0].toUpperCase() ? key[0].toLowerCase() + key.slice(1) : key[0].toUpperCase() + key.slice(1);
    if (object[other] !== undefined && object[other] !== null) return object[other];
  }
  return undefined;
}

/** Euros as the platforms write them — 10.5, "10.50", "10,50" — in cents. */
export function toCents(value) {
  if (value === undefined || value === null || value === "") return 0;
  const number = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function text(value, max) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function quantityOf(value) {
  const quantity = Math.round(Number(value ?? 1));
  return Number.isFinite(quantity) && quantity > 0 ? Math.min(quantity, 999) : 1;
}

function isoOrNull(value) {
  if (!value) return null;
  const time = Date.parse(String(value));
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function addressLine(address) {
  if (!address) return "";
  if (typeof address === "string") return text(address, 300);
  const street = [pick(address, "Street", "street"), pick(address, "Number", "number")].filter(Boolean).join(" ");
  const lines = pick(address, "Lines", "lines");
  return text([
    street || (Array.isArray(lines) ? lines.join(", ") : ""),
    [pick(address, "PostalCode", "postcode", "postalCode", "zipCode"), pick(address, "City", "city")].filter(Boolean).join(" "),
    pick(address, "Floor", "floor") ? `Stock ${pick(address, "Floor", "floor")}` : "",
    pick(address, "DeliveryInstructions", "deliveryInstructions", "notes") ?? ""
  ].filter(Boolean).join(", "), 300);
}

function lineOptions(list, read) {
  return (Array.isArray(list) ? list : []).slice(0, 50).map(read).filter((option) => option.name);
}

/** JET Connect's order (Lieferando). */
function readLieferando(payload) {
  const fulfilment = pick(payload, "Fulfilment") ?? {};
  const customer = pick(payload, "Customer") ?? {};
  const method = String(pick(fulfilment, "Method") ?? pick(payload, "ServiceType") ?? "Delivery").toLowerCase();
  const payment = pick(payload, "Payment") ?? {};
  const paymentLines = pick(payment, "Lines");
  const notes = pick(payload, "CustomerNotes", "Notes", "NoteToRestaurant");
  return {
    externalId: text(pick(payload, "OrderId", "Id"), 128),
    reference: text(pick(payload, "FriendlyOrderReference", "OrderReference", "OrderNumber") ?? pick(payload, "OrderId", "Id"), 32),
    type: method.startsWith("coll") || method.startsWith("pick") ? "pickup" : "delivery",
    placedAt: isoOrNull(pick(payload, "PlacedDate", "CreatedAt")),
    dueAt: isoOrNull(pick(fulfilment, "DueDate", "CustomerDueDate") ?? pick(payload, "DueDate")),
    customerName: text(pick(customer, "Name", "FirstName"), 80),
    customerPhone: text(pick(customer, "PhoneNumber", "DisplayPhoneNumber"), 40),
    address: addressLine(pick(fulfilment, "Address") ?? pick(customer, "Address")),
    notes: text(typeof notes === "object" ? Object.values(notes ?? {}).filter((value) => typeof value === "string").join(" · ") : notes, 500),
    items: (pick(payload, "Items") ?? []).slice(0, 100).map((item) => ({
      sku: text(pick(item, "Reference", "Plu", "RemoteCode"), 64),
      name: text(pick(item, "Name", "Description"), 120),
      quantity: quantityOf(pick(item, "Quantity")),
      unitCents: toCents(pick(item, "UnitPrice")),
      options: lineOptions(pick(item, "Items", "Options", "Modifiers"), (option) => ({
        name: text(pick(option, "Name", "Description"), 120),
        quantity: quantityOf(pick(option, "Quantity")),
        unitCents: toCents(pick(option, "UnitPrice"))
      })),
      note: text(pick(item, "Note", "Comment"), 200)
    })),
    totalCents: toCents(pick(payload, "TotalPrice", "Total")),
    deliveryFeeCents: toCents(pick(payload, "DeliveryCost") ?? pick(fulfilment, "DeliveryCost")),
    paidOnline: Array.isArray(paymentLines) ? paymentLines.every((line) => String(pick(line, "Type") ?? "").toLowerCase() !== "cash") : pick(payment, "Paid") !== false,
    test: Boolean(pick(payload, "IsTest", "Test"))
  };
}

/** The Integration Middleware's order (foodora). */
function readFoodora(payload) {
  const customer = pick(payload, "customer") ?? {};
  const delivery = pick(payload, "delivery") ?? {};
  const pickup = pick(payload, "pickup") ?? {};
  const expedition = String(pick(payload, "expeditionType") ?? "delivery").toLowerCase();
  const price = pick(payload, "price") ?? {};
  const payment = pick(payload, "payment") ?? {};
  const fees = pick(price, "deliveryFees");
  const readTopping = (topping) => ({
    name: text(pick(topping, "name"), 120),
    quantity: quantityOf(pick(topping, "quantity")),
    unitCents: toCents(pick(topping, "price"))
  });
  return {
    externalId: text(pick(payload, "token", "id"), 128),
    reference: text(pick(payload, "code", "shortCode", "token"), 32),
    type: expedition === "pickup" ? "pickup" : "delivery",
    placedAt: isoOrNull(pick(payload, "createdAt")),
    dueAt: isoOrNull(expedition === "pickup" ? pick(pickup, "pickupTime") : pick(delivery, "riderPickupTime", "expectedDeliveryTime")),
    customerName: text([pick(customer, "firstName"), pick(customer, "lastName")].filter(Boolean).join(" "), 80),
    customerPhone: text(pick(customer, "mobilePhone", "phone"), 40),
    address: expedition === "pickup" ? "" : addressLine(pick(delivery, "address")),
    notes: text(pick(pick(payload, "comments") ?? {}, "customerComment") ?? pick(payload, "comment"), 500),
    items: (pick(payload, "products") ?? []).slice(0, 100).map((product) => ({
      sku: text(pick(product, "remoteCode", "id"), 64),
      name: text(pick(product, "name"), 120),
      quantity: quantityOf(pick(product, "quantity")),
      unitCents: toCents(pick(product, "unitPrice", "paidPrice")),
      options: lineOptions((pick(product, "selectedToppings") ?? []).flatMap((topping) => [topping, ...(pick(topping, "children") ?? [])]), readTopping),
      note: text(pick(product, "comment"), 200)
    })),
    totalCents: toCents(pick(price, "grandTotal", "totalGross")),
    deliveryFeeCents: Array.isArray(fees) ? fees.reduce((sum, fee) => sum + toCents(pick(fee, "value")), 0) : toCents(fees),
    paidOnline: String(pick(payment, "status") ?? "paid").toLowerCase() === "paid",
    test: Boolean(pick(payload, "test"))
  };
}

const READERS = { lieferando: readLieferando, foodora: readFoodora };

/**
 * A platform's order as ours. Refuses one without an id or without a dish:
 * nothing the kitchen could cook, and nothing the platform could be told about.
 */
export function readDeliveryOrder(provider, payload) {
  const read = READERS[provider];
  if (!read) throw deliveryError("Unknown delivery platform", "UNKNOWN_PROVIDER", 404);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw deliveryError("The order is not JSON", "INVALID");
  const order = read(payload);
  if (!order.externalId) throw deliveryError("The order has no id", "INVALID");
  order.items = order.items.filter((item) => item.name || item.sku);
  if (!order.items.length) throw deliveryError("The order has no items", "INVALID");
  if (!order.totalCents) {
    order.totalCents = order.items.reduce((sum, item) => sum + item.quantity * (item.unitCents + item.options.reduce((total, option) => total + option.quantity * option.unitCents, 0)), 0) + order.deliveryFeeCents;
  }
  return { provider, ...order };
}

/**
 * The kitchen tickets for an order: one per station, the station and the
 * names from our own dish where the platform's line names one of our SKUs
 * (the PLU the owner types into the platform's menu), the platform's name and
 * the kitchen otherwise.
 */
export function deliveryTickets(order, productsBySku) {
  const provider = DELIVERY_PROVIDERS[order.provider];
  const stations = new Map();
  for (const item of order.items) {
    const product = item.sku ? productsBySku.get(item.sku.toUpperCase()) : null;
    const station = product?.print_station ?? "kitchen";
    const lines = stations.get(station) ?? [];
    lines.push({
      sku: product?.sku ?? item.sku,
      name: product ? (product.name_zh || product.name_de || item.name) : item.name,
      names: product ? { zh: product.name_zh, de: product.name_de, en: product.name_en } : { zh: item.name, de: item.name, en: item.name },
      quantity: item.quantity,
      modifiers: [
        ...item.options.map((option) => ({ name: option.quantity > 1 ? `${option.quantity}× ${option.name}` : option.name })),
        ...(item.note ? [{ name: item.note }] : [])
      ]
    });
    stations.set(station, lines);
  }
  const label = `${provider.name} #${order.reference}`;
  return [...stations].map(([station, items]) => ({
    station,
    payload: {
      kind: "order",
      orderNo: order.reference,
      table: label,
      note: order.notes,
      items,
      delivery: { provider: order.provider, name: provider.name, reference: order.reference, type: order.type, dueAt: order.dueAt, customerName: order.customerName }
    }
  }));
}

export function deliveryOrderView(row) {
  return {
    id: row.id,
    provider: row.provider,
    providerName: DELIVERY_PROVIDERS[row.provider]?.name ?? row.provider,
    externalId: row.external_id,
    reference: row.reference,
    status: row.status,
    type: row.type,
    placedAt: row.placed_at,
    dueAt: row.due_at,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    address: row.address,
    notes: row.notes,
    items: JSON.parse(row.items_json || "[]"),
    totalCents: row.total_cents,
    deliveryFeeCents: row.delivery_fee_cents,
    paidOnline: Boolean(row.paid_online),
    test: Boolean(row.test),
    prepMinutes: row.prep_minutes,
    rejectReason: row.reject_reason || null,
    sync: { status: row.sync_status, error: row.sync_error || null, at: row.synced_at || null },
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// ——— Who is calling: each platform proves it with the secret it was given.

function base64UrlBytes(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

/** A JWT signed with the shared secret (HS256 or HS512), unexpired. */
async function verifyJwt(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  let header;
  let claims;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlBytes(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(base64UrlBytes(parts[1])));
  } catch {
    return false;
  }
  const hash = { HS256: "SHA-256", HS512: "SHA-512" }[header?.alg];
  if (!hash) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${parts[0]}.${parts[1]}`)));
  if (!sameBytes(signature, base64UrlBytes(parts[2]))) return false;
  return !(typeof claims?.exp === "number" && claims.exp * 1000 < Date.now());
}

/**
 * Whether a webhook call comes from the platform: its secret as a bearer
 * token or in `x-webhook-secret`, or a JWT signed with it (how the
 * Integration Middleware signs its calls).
 */
export async function webhookAuthentic(headers, secret) {
  if (!secret) return false;
  const bearer = String(headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const given = bearer || String(headers.get("x-webhook-secret") ?? headers.get("x-api-key") ?? "").trim();
  if (!given) return false;
  const encoder = new TextEncoder();
  if (sameBytes(encoder.encode(given), encoder.encode(secret))) return true;
  return verifyJwt(given, secret);
}

/** A signed JWT, for the tests and the simulator to call the webhook as the platform would. */
export async function signJwt(claims, secret, alg = "HS512") {
  const encode = (value) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const head = `${encode({ alg, typ: "JWT" })}.${encode(claims)}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: alg === "HS256" ? "SHA-256" : "SHA-512" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(head)));
  return `${head}.${btoa(String.fromCharCode(...signature)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

// ——— Telling the platform.

/**
 * The HTTP request that tells the platform what became of an order, or null
 * when there is nothing to tell (a test order, a platform not connected).
 * `action` is accept, reject or ready; `credentials` what the host holds for
 * that platform ({ apiBase, apiKey } for Lieferando, { apiBase, accessToken }
 * for foodora once signed in).
 */
export function outboundRequest(order, action, credentials, { prepMinutes = 20, reason = "OTHER" } = {}) {
  const base = String(credentials.apiBase || DELIVERY_PROVIDERS[order.provider].defaultApiBase).replace(/\/+$/, "");
  const readyAt = new Date(Date.now() + prepMinutes * 60_000).toISOString();
  if (order.provider === "lieferando") {
    if (!credentials.apiKey) return null;
    const headers = { authorization: `JE-API-KEY ${credentials.apiKey}`, "content-type": "application/json" };
    const id = encodeURIComponent(order.externalId);
    if (action === "accept") return { method: "PUT", url: `${base}/orders/${id}/accept`, headers, body: { TimeAcceptedFor: readyAt } };
    if (action === "reject") return { method: "PUT", url: `${base}/orders/${id}/reject`, headers, body: { Message: reason } };
    if (action === "ready") return order.type === "pickup" ? { method: "POST", url: `${base}/orders/${id}/readyforcollection`, headers, body: {} } : null;
    return null;
  }
  if (order.provider === "foodora") {
    if (!credentials.accessToken) return null;
    const headers = { authorization: `Bearer ${credentials.accessToken}`, "content-type": "application/json" };
    const url = `${base}/v2/order/status/${encodeURIComponent(order.externalId)}`;
    if (action === "accept") return { method: "POST", url, headers, body: { status: "order_accepted", acceptanceTime: readyAt } };
    if (action === "reject") return { method: "POST", url, headers, body: { status: "order_rejected", reason } };
    if (action === "ready") return { method: "POST", url, headers, body: { status: "order_prepared" } };
    return null;
  }
  return null;
}

/** foodora's sign-in: the plugin's user and password for a bearer token. */
export function foodoraLoginRequest(credentials) {
  if (!credentials.username || !credentials.password) return null;
  const base = String(credentials.apiBase || DELIVERY_PROVIDERS.foodora.defaultApiBase).replace(/\/+$/, "");
  return {
    method: "POST",
    url: `${base}/v2/login`,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: credentials.username, password: credentials.password, grant_type: "client_credentials" }).toString()
  };
}

/**
 * A made-up order in the platform's own shape, for the owner to see the
 * whole path — ticket, floor, accept, report — before the platform is live.
 */
export function sampleOrder(provider, products = []) {
  const stamp = Date.now().toString(36).toUpperCase();
  const dishes = products.slice(0, 2);
  const lines = dishes.length ? dishes : [{ sku: "R1", name_de: "Ramen mit Gemüse", price_cents: 1250 }];
  if (provider === "foodora") {
    return {
      token: `test-${stamp}`,
      code: `T${stamp.slice(-4)}`,
      expeditionType: "delivery",
      test: true,
      createdAt: new Date().toISOString(),
      customer: { firstName: "Test", lastName: "Kunde", mobilePhone: "+43 660 0000000" },
      delivery: { address: { street: "Teststraße", number: "1", postcode: "1010", city: "Wien" }, riderPickupTime: new Date(Date.now() + 25 * 60_000).toISOString() },
      comments: { customerComment: "Bitte klingeln" },
      products: lines.map((dish, index) => ({ remoteCode: dish.sku, name: dish.name_de ?? dish.sku, quantity: String(index + 1), unitPrice: (dish.price_cents / 100).toFixed(2), selectedToppings: index ? [] : [{ name: "Extra scharf", price: "0.00", quantity: 1 }] })),
      price: { grandTotal: (lines.reduce((sum, dish, index) => sum + dish.price_cents * (index + 1), 0) / 100 + 2.9).toFixed(2), deliveryFees: [{ name: "Liefergebühr", value: 2.9 }] },
      payment: { status: "paid", type: "card" }
    };
  }
  return {
    OrderId: `test-${stamp}`,
    FriendlyOrderReference: stamp.slice(-6),
    IsTest: true,
    PlacedDate: new Date().toISOString(),
    Fulfilment: { Method: "Collection", DueDate: new Date(Date.now() + 30 * 60_000).toISOString() },
    Customer: { Name: "Test Kunde", PhoneNumber: "+43 660 0000000" },
    Notes: "Ohne Koriander",
    Items: lines.map((dish, index) => ({ Reference: dish.sku, Name: dish.name_de ?? dish.sku, Quantity: index + 1, UnitPrice: dish.price_cents / 100, Items: [] })),
    TotalPrice: lines.reduce((sum, dish, index) => sum + dish.price_cents * (index + 1), 0) / 100,
    Payment: { Lines: [{ Type: "card", Value: 0, Paid: true }] }
  };
}

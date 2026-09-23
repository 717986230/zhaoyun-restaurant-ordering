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

import { DEFAULT_TIME_ZONE, isOnSchedule, normalizeSchedule, normalizeTimeZone } from "../src/schedule.js";

export const ORDER_STATUSES = new Set(["new", "preparing", "ready", "completed", "cancelled"]);
export const REQUEST_STATUSES = new Set(["open", "acknowledged", "completed", "cancelled"]);
export const PRODUCT_KINDS = new Set(["food", "drink", "sushi"]);
export const PRINT_STATIONS = new Set(["kitchen", "bar", "sushi", "front"]);
export const PRINTER_TRANSPORTS = new Set(["lan", "bluetooth", "usb"]);
// The colour hexes themselves live in packages/domain/src/themes.ts, next to
// the guest app that renders them; the backend only ever needs to know which
// ids are valid to store.
export const MENU_THEME_IDS = new Set(["jade", "teal", "terracotta"]);
export const DEFAULT_MENU_THEME = "jade";

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

/**
 * One password, on the door of the admin console.
 *
 * A shared token is the right credential for a tablet bolted to a wall and
 * configured once. It is the wrong one for a person with a phone: nobody
 * types 32 random characters to fix a price, and handing one out means
 * handing out the only one there is. So the console has a password instead —
 * set by whoever opens it first, kept as a PBKDF2 hash in the restaurant's
 * own database, and exchanged at sign-in for a session token presented in
 * the same `x-admin-token` header every route already reads.
 *
 * `ADMIN_TOKEN` keeps working where it is configured. It is not the way in
 * any more, but it is the way back in: a deployment whose password has been
 * forgotten is recovered with it rather than rebuilt.
 *
 * PBKDF2 through WebCrypto because it is the one password hash both runtimes
 * have — `node:crypto`'s scrypt is not on Workers, and a second
 * implementation of a password hash is how the two quietly stop agreeing.
 *
 * 100,000 iterations, because that is the most Cloudflare Workers will run:
 * deployed WebCrypto refuses anything higher with "iteration counts above
 * 100000 are not supported", while local `wrangler dev` does not enforce the
 * cap, so a higher number passes every test and fails only in production.
 * server/tests/password.test.mjs holds the constant to it for that reason.
 *
 * That is below OWASP's 600,000 for PBKDF2-HMAC-SHA256. What makes up for it
 * here is that guessing online is throttled to five failures per address per
 * five minutes, and guessing offline needs the database first. Each stored
 * hash records its own iteration count, so raising this later re-hashes on
 * the next password change without invalidating anything.
 */
export const PASSWORD_ITERATIONS = 100_000;
/** The ceiling deployed Workers put on PBKDF2. Not a setting — a fact about
 *  the runtime, stated once so the test can hold PASSWORD_ITERATIONS to it. */
export const WORKERS_PBKDF2_MAX_ITERATIONS = 100_000;
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PASSWORD_MIN = 6;

function base64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function unbase64(value) {
  return Uint8Array.from(atob(String(value)), (character) => character.charCodeAt(0));
}

export function assertPassword(value) {
  const password = String(value ?? "");
  if (password.length < PASSWORD_MIN) throw new Error(`Password must be at least ${PASSWORD_MIN} characters`);
  return password;
}

export async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16)), iterations = PASSWORD_ITERATIONS) {
  const saltBytes = typeof salt === "string" ? unbase64(salt) : salt;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations }, key, 256);
  return { hash: base64(bits), salt: base64(saltBytes), iterations };
}

/**
 * Compares every byte whatever happens, so a wrong digest takes as long to
 * reject as a right one takes to accept. Both sides here are base64 of a
 * fixed-width digest, so returning early on a length mismatch leaks nothing
 * that is secret — the same shape `tokenMatches` uses in the Worker.
 */
export function constantTimeEquals(left, right) {
  const encoder = new TextEncoder();
  const a = encoder.encode(String(left ?? ""));
  const b = encoder.encode(String(right ?? ""));
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

export async function verifyPassword(password, stored) {
  if (!stored?.hash || !stored?.salt) return false;
  const { hash } = await hashPassword(password, stored.salt, Number(stored.iterations) || PASSWORD_ITERATIONS);
  return constantTimeEquals(hash, stored.hash);
}

/** The token a sign-in hands back. Only its SHA-256 is stored, so a stolen
 *  database still holds nothing that can be replayed as a credential. */
export function newSessionToken() {
  return base64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashSessionToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(token)));
  return base64(digest);
}

/** What the console asks before it draws anything: is there a password yet,
 *  or is this the first person through the door. */
export function adminGateView(row) {
  return { configured: Boolean(row?.password_hash) };
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

/** Clamps a combo's bundled quantities the same way on both backends; what a
 *  dish id actually refers to is checked where the product rows are at hand. */
export function normalizeBundleItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && String(item.productId ?? "").trim())
    .map((item) => ({ productId: String(item.productId).trim(), quantity: Math.max(1, Math.min(99, Number(item.quantity) || 1)) }));
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
    bundleItems: parseJson(row.bundle_items_json, []),
    available: Boolean(row.available),
    published: Boolean(row.published),
    sortOrder: row.sort_order,
    printStation: row.print_station,
    media: media.map((item) => ({
      id: item.id,
      type: item.type,
      url: item.url,
      posterUrl: item.poster_url,
      sortOrder: item.sort_order,
      credit: item.credit ?? null
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
    bundleItemsJson: JSON.stringify(input.bundleItems === undefined ? parseJson(current.bundle_items_json, []) : normalizeBundleItems(input.bundleItems)),
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

export function normalizeMenuTheme(value, fallback = DEFAULT_MENU_THEME) {
  const theme = String(value ?? fallback);
  if (!MENU_THEME_IDS.has(theme)) throw new Error("Unsupported menu theme");
  return theme;
}

/**
 * The languages a guest can switch the menu into, in the order their flags
 * appear. Every dish already carries all three names; this only decides
 * which flags the menu offers. English and German by default, because the
 * restaurant is in Austria and most guests read one of those two — Chinese
 * is one switch away in 连接设置 for a restaurant that wants it.
 */
export const MENU_LANGUAGES = ["zh", "en", "de"];
export const DEFAULT_MENU_LANGUAGES = ["en", "de"];

/** A list to store: known languages only, at least one, in flag order. */
export function normalizeMenuLanguages(value) {
  if (!Array.isArray(value)) throw new Error("Menu languages must be a list");
  const unknown = value.filter((language) => !MENU_LANGUAGES.includes(language));
  if (unknown.length) throw new Error(`Unsupported menu language: ${unknown.join(", ")}`);
  const chosen = MENU_LANGUAGES.filter((language) => value.includes(language));
  if (!chosen.length) throw new Error("The menu needs at least one language");
  return chosen;
}

/** What is stored, read back leniently: anything unreadable is the default,
 *  never an empty menu with no language to show it in. */
export function parseMenuLanguages(stored) {
  try {
    return normalizeMenuLanguages(JSON.parse(stored));
  } catch {
    return [...DEFAULT_MENU_LANGUAGES];
  }
}

export const COLOR_SCHEMES = ["dark", "light"];

function flag(label) {
  return (value) => {
    if (typeof value !== "boolean") throw new Error(`${label} must be true or false`);
    return value;
  };
}

/** Trimmed text of a bounded length; `label` names it in the error. */
function boundedText(label, max) {
  return (value) => {
    const text = String(value ?? "").trim().replace(/\s+/g, " ");
    if (!text) throw new Error(`${label} must not be empty`);
    if (text.length > max) throw new Error(`${label} must be at most ${max} characters`);
    return text;
  };
}

/** Trimmed text that may be empty (meaning "use the default"). */
function optionalText(label, max) {
  return (value) => {
    const text = String(value ?? "").trim().replace(/\s+/g, " ");
    if (text.length > max) throw new Error(`${label} must be at most ${max} characters`);
    return text;
  };
}

export const MAX_FEATURED_PRODUCTS = 40;

/**
 * The promotions page's designs. One list, read by both backends and — via
 * src/contracts.js — by the request schema; the names and previews live in
 * packages/domain/src/featured.ts, and a parity test holds the two together.
 * A new design is an id here, an entry there and a CSS block in styles.css.
 */
export const FEATURED_TEMPLATES = ["gallery", "spotlight", "editorial", "tasting", "framed", "poster", "carousel", "bento", "minimal", "monochrome"];
export const DEFAULT_FEATURED_TEMPLATE = "gallery";

/** The dishes on the promotions page, in the order the owner put them; no repeats. */
function normalizeFeaturedIds(value) {
  if (!Array.isArray(value)) throw new Error("Featured products must be a list");
  const ids = [];
  for (const item of value) {
    const id = String(item ?? "").trim();
    if (!id || id.length > 64) throw new Error("Featured product ids must be 1 to 64 characters");
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length > MAX_FEATURED_PRODUCTS) throw new Error(`At most ${MAX_FEATURED_PRODUCTS} featured products`);
  return ids;
}

/**
 * Every setting that lives in `app_settings`, one entry each: the field name
 * the API uses, the key it is stored under, its default, and how an incoming
 * value is checked. Adding a setting is adding a line here — the table is a
 * key/value one precisely so that a new setting needs no migration.
 *
 * Values are stored as JSON, and read back leniently: a stored value that no
 * longer passes its check is the default, never an error on the guest menu.
 */
export const APP_SETTINGS = {
  menuLanguages: { key: "menu_languages", fallback: () => [...DEFAULT_MENU_LANGUAGES], normalize: normalizeMenuLanguages },
  // The name on the admin console, the browser tab and the printed table card.
  restaurantName: { key: "restaurant_name", fallback: () => "赵云", normalize: boundedText("Restaurant name", 40) },
  // The heading of the guest menu.
  menuTitle: { key: "menu_title", fallback: () => "La Carte", normalize: boundedText("Menu title", 24) },
  // What a guest sees before they touch the sun/moon; their own pick wins.
  menuDefaultScheme: {
    key: "menu_default_scheme",
    fallback: () => "dark",
    normalize: (value) => {
      if (!COLOR_SCHEMES.includes(value)) throw new Error("Default scheme must be dark or light");
      return value;
    }
  },
  showTableNumber: { key: "show_table_number", fallback: () => true, normalize: flag("showTableNumber") },
  // Orders, table billing and printers in the admin console. Off while the
  // menu is view-only: those sections would have nothing to show.
  showOrdering: { key: "admin_show_ordering", fallback: () => false, normalize: flag("showOrdering") },
  // The promotions page: set menus and dishes the restaurant wants seen first.
  // Off until the owner switches it on; an empty title means the menu's own
  // wording ("精选推荐" / "Empfehlungen" / "Signature").
  featuredEnabled: { key: "featured_enabled", fallback: () => false, normalize: flag("featuredEnabled") },
  featuredTitle: { key: "featured_title", fallback: () => "", normalize: optionalText("Featured title", 32) },
  featuredProductIds: { key: "featured_products", fallback: () => [], normalize: normalizeFeaturedIds },
  // The restaurant's clock, which the pages' hours below follow.
  timeZone: { key: "time_zone", fallback: () => DEFAULT_TIME_ZONE, normalize: normalizeTimeZone },
  // When the promotions page and the set menus page are on the menu, each as
  // a whole — "Mon–Fri 11:00–14:30" for a lunch offer; null is always. The
  // rules are src/schedule.js. Outside them the page and its tab are gone.
  featuredSchedule: { key: "featured_schedule", fallback: () => null, normalize: normalizeSchedule },
  setsSchedule: { key: "sets_schedule", fallback: () => null, normalize: normalizeSchedule },
  featuredTemplate: {
    key: "featured_template",
    fallback: () => DEFAULT_FEATURED_TEMPLATE,
    normalize: (value) => {
      if (!FEATURED_TEMPLATES.includes(value)) throw new Error("Unknown promotions template");
      return value;
    }
  }
};

function readAppSetting(definition, stored) {
  if (stored === undefined || stored === null) return definition.fallback();
  try {
    return definition.normalize(JSON.parse(stored));
  } catch {
    return definition.fallback();
  }
}

/**
 * Checks everything in a save before anything is written, so one bad field
 * does not leave the others half-applied. Returns the menu style to store (or
 * undefined) and the `app_settings` rows to upsert.
 */
export function normalizeSettingsInput(input) {
  const menuTheme = input.menuTheme === undefined ? undefined : normalizeMenuTheme(input.menuTheme);
  const rows = [];
  for (const [field, definition] of Object.entries(APP_SETTINGS)) {
    if (input[field] === undefined) continue;
    rows.push([definition.key, JSON.stringify(definition.normalize(input[field]))]);
  }
  return { menuTheme, rows };
}

/** `appValues` maps `app_settings` keys to their stored JSON. */
export function settingsView(row, appValues = {}) {
  const view = { menuTheme: row ? row.menu_theme : DEFAULT_MENU_THEME };
  for (const [field, definition] of Object.entries(APP_SETTINGS)) {
    view[field] = readAppSetting(definition, appValues[definition.key]);
  }
  return view;
}

/** The part of the settings the guest menu reads; served with the catalogue. */
export function menuSettingsView(settings) {
  return {
    title: settings.menuTitle,
    restaurantName: settings.restaurantName,
    defaultScheme: settings.menuDefaultScheme,
    showTableNumber: settings.showTableNumber,
    timeZone: settings.timeZone,
    setsSchedule: settings.setsSchedule,
    // Only when switched on: a guest has no use for a list of ids otherwise.
    featured: settings.featuredEnabled
      ? { title: settings.featuredTitle, productIds: settings.featuredProductIds, template: settings.featuredTemplate, schedule: settings.featuredSchedule }
      : null
  };
}

/**
 * What "copy this dish" saves: everything the owner typed, under names that
 * say it is a copy, with a code of its own and — until someone has looked at
 * it — kept off the menu, so a half-edited twin never reaches a guest.
 */
export function duplicateInput(product) {
  const mark = { zh: "（副本）", de: " (Kopie)", en: " (copy)" };
  const names = Object.fromEntries(Object.entries(product.names).map(([language, name]) => [language, name ? `${name}${mark[language] ?? " (copy)"}` : name]));
  return {
    kind: product.kind,
    category: product.category,
    names,
    description: product.description,
    price: product.price,
    vatPercent: product.vatPercent,
    allergens: product.allergens,
    details: product.details,
    appearance: product.appearance,
    modifiers: product.modifiers,
    bundleItems: product.bundleItems,
    available: product.available,
    published: false,
    sortOrder: product.sortOrder,
    printStation: product.printStation
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
/**
 * A set menu (a product that packages others) is served only in the set
 * menus page's hours; ordinary dishes have none. Checked for an order sent
 * from a menu left open past them as much as for anyone.
 */
export function assertSetServed(productRow, { timeZone = DEFAULT_TIME_ZONE, setsSchedule = null, at = new Date() } = {}) {
  if (!parseJson(productRow.bundle_items_json, []).length) return;
  if (!isOnSchedule(setsSchedule, at, timeZone)) throw new Error(`Product ${productRow.id} is not served at this time`);
}

export function orderProductIds(input) {
  return (Array.isArray(input.items) ? input.items : []).map((item) => String(item.id));
}

/**
 * Turns an order command plus the product rows it names into the exact rows to
 * write: one order, its items, and one print job per station. Validation and
 * money happen here, so a synchronous transaction and a D1 batch write the same
 * thing.
 */
export function planOrder(input, productRows, hours = {}) {
  const clientRequestId = String(input.clientRequestId || uuid());
  const table = String(input.table || "").trim();
  if (!table) throw new Error("Order requires a table number");
  if (!Array.isArray(input.items) || !input.items.length) throw new Error("Order requires at least one item");

  const resolved = input.items.map((item) => {
    const product = productRows.get(String(item.id));
    const quantity = Number(item.qty);
    if (!product || !product.published || !product.available) throw new Error(`Product ${item.id} is unavailable`);
    assertSetServed(product, hours);
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
      const lineCents = row.unit_price_cents * row.quantity;
      const vatPercent = row.vat_percent;
      // Guests read the bill: keep the localized names next to the snapshot name.
      const product = productsById.get(row.product_id);
      items.push({
        orderNo: order.order_no,
        name: row.product_name,
        names: product ? { zh: product.name_zh, de: product.name_de, en: product.name_en } : undefined,
        qty: row.quantity,
        unitPrice: row.unit_price_cents / 100,
        lineTotal: lineCents / 100,
        vatPercent,
        modifiers: parseJson(row.modifiers_json, []).map((modifier) => ({ name: modifier.name, names: modifier.names }))
      });
      groups.set(vatPercent, (groups.get(vatPercent) || 0) + lineCents);
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

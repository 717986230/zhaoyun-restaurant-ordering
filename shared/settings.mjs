/**
 * The restaurant's settings: theme, languages, the promotions page, the
 * navigation, categories, and everything else the owner switches. What is
 * stored, how input is checked, and the part the guest menu reads.
 *
 * Nothing here may import `node:` anything, so it runs unchanged on Workers.
 */

import { DEFAULT_TIME_ZONE, normalizeSchedule, normalizeTimeZone } from "../src/schedule.js";
import { GUEST_ORDERING_DEFAULTS, normalizeGuestOrdering, orderingMenuView } from "./ordering.mjs";
import { LOYALTY_DEFAULTS, normalizeLoyalty } from "./customer.mjs";
import { normalizeReservationSettings } from "./reservations.mjs";
import { normalizeDeliverySettings } from "./delivery.mjs";

// The colour hexes themselves live in packages/domain/src/themes.ts, next to
// the guest app that renders them; the backend only ever needs to know which
// ids are valid to store.
export const MENU_THEME_IDS = new Set(["jade", "teal", "terracotta", "spring-festival", "valentine", "easter", "back-to-school", "mid-autumn", "national-day", "christmas", "halloween"]);
export const DEFAULT_MENU_THEME = "jade";

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

export const MAX_NAV_PINNED = 3;

/**
 * The tabs the owner puts first, second and third on the guest menu:
 * "__sets__", "__featured__", "ALLE" or a category. At most three, no
 * repeats; one that is not on the menu is skipped there, never an error.
 */
function normalizeNavPinned(value) {
  if (!Array.isArray(value)) throw new Error("Pinned tabs must be a list");
  // Counted as sent, as the request schema counts them, so both backends agree.
  if (value.length > MAX_NAV_PINNED) throw new Error(`At most ${MAX_NAV_PINNED} pinned tabs`);
  const tabs = [];
  for (const item of value) {
    const tab = String(item ?? "").trim();
    if (!tab) continue;
    if (tab.length > 64) throw new Error("A pinned tab is at most 64 characters");
    if (!tabs.includes(tab)) tabs.push(tab);
  }
  return tabs;
}

export const MAX_NAV_LABELS = 80;
export const MAX_NAV_LABEL_LENGTH = 24;

/**
 * The names the owner gives the guest menu's tabs, per language: "全部" /
 * "Alle" / "All" under "ALLE", the set menus page under "__sets__", and
 * each category under its own code ("RAMEN" -> 拉面 / Ramen / Ramen). A
 * language left out keeps the menu's own wording, or the category's code.
 */
function normalizeNavLabels(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Tab names must be given per tab");
  const entries = Object.entries(value);
  if (entries.length > MAX_NAV_LABELS) throw new Error(`At most ${MAX_NAV_LABELS} tabs can be named`);
  const labels = {};
  for (const [rawTab, names] of entries) {
    const tab = String(rawTab).trim();
    if (!tab || tab.length > 64) throw new Error("A tab is 1 to 64 characters");
    if (!names || typeof names !== "object" || Array.isArray(names)) throw new Error("A tab's names must be given per language");
    const clean = {};
    for (const [language, name] of Object.entries(names)) {
      if (!MENU_LANGUAGES.includes(language)) throw new Error("Tab names are in zh, en or de");
      const text = String(name ?? "").trim().replace(/\s+/g, " ");
      if (text.length > MAX_NAV_LABEL_LENGTH) throw new Error(`A tab name is at most ${MAX_NAV_LABEL_LENGTH} characters`);
      if (text) clean[language] = text;
    }
    if (Object.keys(clean).length) labels[tab] = clean;
  }
  return labels;
}

/** A category as dishes store it: trimmed, single-spaced, upper case. */
export function normalizeCategoryName(value) {
  const category = String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  if (!category || category.length > 64 || !/^[A-Z0-9][A-Z0-9 _-]*$/.test(category)) {
    throw new Error("A category is 1 to 64 letters, digits, spaces, - or _");
  }
  // The "all" tab's id; a category of that name would share its tab.
  if (category === "ALLE") throw new Error("ALLE is the all-dishes tab, not a category");
  return category;
}

/**
 * What renaming a category does to the settings that name it: its place
 * among the owner's first tabs, and its names, move with it. Renamed onto a
 * category that already has names, that one's names stay — two categories
 * made one.
 */
export function renamedCategorySettings(settings, from, to) {
  const navPinned = [...new Set(settings.navPinned.map((tab) => (tab === from ? to : tab)))];
  const navLabels = { ...settings.navLabels };
  if (navLabels[from]) {
    if (!navLabels[to]) navLabels[to] = navLabels[from];
    delete navLabels[from];
  }
  return { navPinned, navLabels };
}

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
/** An Austrian VAT number: ATU and eight digits, or none. */
function normalizeUid(value) {
  const uid = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (uid && !/^ATU\d{8}$/.test(uid)) throw new Error("A VAT number (UID) is ATU and eight digits");
  return uid;
}

function normalizeCashRegisterId(value) {
  const id = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(id)) throw new Error("A register id is letters, digits, - or _");
  return id;
}

export const DEFAULT_FLOOR_TABLES = 20;
export const MAX_FLOOR_TABLES = 200;

export const APP_SETTINGS = {
  menuLanguages: { key: "menu_languages", fallback: () => [...DEFAULT_MENU_LANGUAGES], normalize: normalizeMenuLanguages },
  // The name on the admin console, the browser tab and the printed table card.
  restaurantName: { key: "restaurant_name", fallback: () => "赵云", normalize: boundedText("Restaurant name", 40) },
  // Who issues the receipts, as the receipt has to say (§ 132a BAO): the
  // business's legal name and address, and its VAT number (UID) when it has
  // one. Empty name: the restaurant's name.
  companyName: { key: "company_name", fallback: () => "", normalize: optionalText("Company name", 80) },
  companyAddress: { key: "company_address", fallback: () => "", normalize: optionalText("Company address", 160) },
  companyUid: { key: "company_uid", fallback: () => "", normalize: normalizeUid },
  // The discount a takeaway gets at the POS, in percent (0: none).
  takeawayDiscountPercent: {
    key: "takeaway_discount_percent",
    fallback: () => 0,
    normalize: (value) => {
      const percent = Number(value);
      if (!Number.isInteger(percent) || percent < 0 || percent > 50) throw new Error("The takeaway discount is 0 to 50 percent");
      return percent;
    }
  },
  // How many tables the floor shows by number (1 to this) before any is set up
  // one by one: a waiter opens table 7 with a tap, not by typing it.
  floorTables: {
    key: "floor_tables",
    fallback: () => DEFAULT_FLOOR_TABLES,
    normalize: (value) => {
      const count = Number(value);
      if (!Number.isInteger(count) || count < 0 || count > MAX_FLOOR_TABLES) throw new Error(`The floor has 0 to ${MAX_FLOOR_TABLES} tables`);
      return count;
    }
  },
  // The register's id (Kassen-ID) printed on each receipt; unique per business.
  cashRegisterId: { key: "cash_register_id", fallback: () => "KASSE-1", normalize: normalizeCashRegisterId },
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
  // Which tabs come first, second and third on the guest menu (packages/domain/src/navigation.ts).
  navPinned: { key: "nav_pinned", fallback: () => [], normalize: normalizeNavPinned },
  // What the tabs are called, per language (normalizeNavLabels).
  navLabels: { key: "nav_labels", fallback: () => ({}), normalize: normalizeNavLabels },
  // Guests' own accounts on the menu: sign in, keep favourites. Pickup and
  // points need them too, so either of those switches them on as well.
  customerAccounts: { key: "customer_accounts", fallback: () => false, normalize: flag("customerAccounts") },
  // Ordering from the menu straight to the kitchen, and its limits (shared/ordering.mjs).
  guestOrdering: { key: "guest_ordering", fallback: () => ({ ...GUEST_ORDERING_DEFAULTS, hours: [] }), normalize: (value) => normalizeGuestOrdering(value) },
  // Points for what guests pay, and the rewards they buy with them (shared/customer.mjs).
  loyalty: { key: "loyalty", fallback: () => ({ ...LOYALTY_DEFAULTS, rewards: [] }), normalize: (value) => normalizeLoyalty(value) },
  // Guests booking a table online, and the rules they book under (shared/reservations.mjs).
  reservations: { key: "reservations", fallback: () => normalizeReservationSettings({}), normalize: normalizeReservationSettings },
  // The delivery platforms: which are on, whether their orders go to the kitchen unasked, and how long one takes (shared/delivery.mjs).
  delivery: { key: "delivery", fallback: () => normalizeDeliverySettings({}), normalize: normalizeDeliverySettings },
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

/** Whether guests can have accounts: switched on, or needed by pickup, points or booking a table. */
export function customerAccountsOn(settings) {
  const ordering = settings.guestOrdering;
  return Boolean(settings.customerAccounts || settings.loyalty?.enabled || (ordering?.enabled && ordering.pickup) || settings.reservations?.enabled);
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
    navPinned: settings.navPinned,
    navLabels: settings.navLabels,
    // Guests' accounts, ordering and points: each only when switched on.
    accounts: customerAccountsOn(settings),
    ordering: orderingMenuView(settings.guestOrdering),
    // Whether the menu links to the booking page.
    reservations: Boolean(settings.reservations?.enabled),
    // A new account brings these points, once (shared/http.mjs, register); said only when it does.
    ...(customerAccountsOn(settings) && settings.reservations?.signupPoints ? { signupPoints: settings.reservations.signupPoints } : {}),
    loyalty: settings.loyalty?.enabled
      ? { pointsPerEuro: settings.loyalty.pointsPerEuro, rewards: settings.loyalty.rewards, maxRewardsPerOrder: settings.loyalty.maxRewardsPerOrder }
      : null,
    // Only when switched on: a guest has no use for a list of ids otherwise.
    featured: settings.featuredEnabled
      ? { title: settings.featuredTitle, productIds: settings.featuredProductIds, template: settings.featuredTemplate, schedule: settings.featuredSchedule }
      : null
  };
}

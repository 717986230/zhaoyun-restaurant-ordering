/**
 * The catalogue's rules: what a dish is (its kind, VAT rate, options and, for
 * a set menu, what is in it), how one is read from and written to a row, and
 * how a set's price divides over the VAT rates of its dishes.
 *
 * Nothing here may import `node:` anything, so it runs unchanged on Workers.
 */

import { DEFAULT_TIME_ZONE, isOnSchedule } from "../src/schedule.js";
import { normalizeAllergens } from "../src/allergens.js";
import { bool, parseJson, priceToCents, uuid } from "./core.mjs";
import { PRINT_STATIONS } from "./printing.mjs";

export const PRODUCT_KINDS = new Set(["food", "drink", "sushi"]);

/**
 * The Austrian rates a restaurant charges (§ 10 UStG): 10% for food, 20% for
 * drinks — soft drinks included — and 13% for the few things in between. The
 * owner sets each dish; these are only what a new one starts with. A set menu
 * has no rate of its own: it is split over the rates of what is in it (see
 * vatSplit). Confirm the rates with a tax advisor.
 */
export const VAT_PERCENTS = [10, 13, 20];
export const DEFAULT_VAT_PERCENT = { food: 10, sushi: 10, drink: 20 };

export function normalizeVatPercent(value) {
  const percent = Number(value);
  if (!VAT_PERCENTS.includes(percent)) throw new Error("VAT is 10, 13 or 20 percent");
  return percent;
}

/** Clamps a combo's bundled quantities the same way on both backends; what a
 *  dish id actually refers to is checked where the product rows are at hand. */
export function normalizeBundleItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && String(item.productId ?? "").trim())
    .map((item) => ({ productId: String(item.productId).trim(), quantity: Math.max(1, Math.min(99, Number(item.quantity) || 1)) }));
}

/** A product for the API. `stock` is its daily limit and today's portions (shared/stock.mjs, stockView), when read. */
export function mapProduct(row, media = [], stock = null) {
  return {
    id: row.id,
    sku: row.sku,
    kind: row.kind,
    category: row.category,
    names: { zh: row.name_zh, de: row.name_de, en: row.name_en },
    description: row.description,
    price: row.price_cents / 100,
    vatPercent: row.vat_percent,
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
    // Only for a dish that has a limit: the rest are as many as ordered, and say nothing.
    ...(stock && (stock.dailyLimit !== null || stock.leftToday !== null) ? { dailyLimit: stock.dailyLimit, leftToday: stock.leftToday } : {}),
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
    vatPercent: normalizeVatPercent(input.vatPercent ?? current.vat_percent ?? DEFAULT_VAT_PERCENT[kind]),
    allergensJson: JSON.stringify(normalizeAllergens(Array.isArray(input.allergens) ? input.allergens : parseJson(current.allergens_json, []))),
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

/**
 * A set menu (a product that packages others) is served only in the set
 * menus page's hours; ordinary dishes have none. Checked for an order sent
 * from a menu left open past them as much as for anyone.
 */
export function assertSetServed(productRow, { timeZone = DEFAULT_TIME_ZONE, setsSchedule = null, at = new Date() } = {}) {
  if (!parseJson(productRow.bundle_items_json, []).length) return;
  if (!isOnSchedule(setsSchedule, at, timeZone)) throw new Error(`Product ${productRow.id} is not served at this time`);
}

/** The dishes inside the set menus among these rows, which vatSplit needs to hand. */
export function bundleComponentIds(rows) {
  return [...new Set([...rows].flatMap((row) => parseJson(row.bundle_items_json, []).map((part) => String(part.productId))))];
}

/**
 * How one unit of an order line divides over the VAT rates, in cents that add
 * up to its price exactly. A dish is its own rate. A set menu is the rates of
 * the dishes in it, in proportion to their own menu prices — a set of ramen
 * and a soft drink is partly 10% and partly 20%, whatever the set says. A set
 * whose dishes are gone, or all free, keeps its own rate.
 *
 * Kept on the order line when it is written, so a later change of price or
 * rate never rewrites what an old order was.
 */
export function vatSplit(productRow, rowsById, unitPriceCents) {
  const own = [{ percent: productRow.vat_percent, cents: unitPriceCents }];
  const weights = new Map();
  for (const part of parseJson(productRow.bundle_items_json, [])) {
    const row = rowsById.get(String(part.productId));
    if (row) weights.set(row.vat_percent, (weights.get(row.vat_percent) || 0) + row.price_cents * part.quantity);
  }
  const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  if (!total || unitPriceCents <= 0) return own;
  const shares = [...weights].sort(([left], [right]) => left - right).map(([percent, weight]) => {
    const exact = (unitPriceCents * weight) / total;
    return { percent, cents: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  // Largest remainder: the cents rounding took off go back to the shares that lost most.
  let left = unitPriceCents - shares.reduce((sum, share) => sum + share.cents, 0);
  for (const share of [...shares].sort((a, b) => b.rest - a.rest)) {
    if (left <= 0) break;
    share.cents += 1;
    left -= 1;
  }
  return shares.filter((share) => share.cents > 0).map(({ percent, cents }) => ({ percent, cents }));
}

/** The rate an order line is filed under: its largest share. */
export function mainVatPercent(split) {
  return split.reduce((main, part) => (part.cents > main.cents ? part : main)).percent;
}

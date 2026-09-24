export type ProductKind = "food" | "drink" | "sushi";
export type VatPercent = 10 | 13 | 20;
export type PrintStation = "kitchen" | "bar" | "sushi" | "front";
export type OrderStatus = "pending-sync" | "sync-failed" | "new" | "preparing" | "ready" | "completed" | "cancelled";

export interface ProductMedia {
  id?: string;
  type: "image" | "video";
  url: string;
  posterUrl?: string | null;
  sortOrder?: number;
  /** Who took it and under which licence, for a photo that is not the restaurant's own. */
  credit?: string | null;
}

export interface ModifierOption {
  id: string;
  names: { zh: string; de: string; en: string };
  priceCents: number;
}

export interface ModifierGroup {
  id: string;
  names: { zh: string; de: string; en: string };
  selection: "single" | "multi";
  options: ModifierOption[];
}

export interface SelectedModifier {
  id: string;
  name: string;
  priceCents: number;
}

/** One dish a 套餐 (combo) bundles in, and how many of it come with the set. */
export interface BundleItem {
  productId: string;
  quantity: number;
}

export interface Product {
  id: string;
  sku: string;
  kind: ProductKind;
  category: string;
  names: { zh: string; de: string; en: string };
  description: string;
  priceCents: number;
  vatPercent: VatPercent;
  allergens: string[];
  details: { time: string; people: string; level: string; ingredients: string };
  appearance: { art: string; pattern: string };
  media: ProductMedia[];
  modifiers?: ModifierGroup[];
  /** Present on a combo: the existing dishes it packages, by id. A combo is
   *  otherwise an ordinary product — its own name, price and photo. */
  bundleItems?: BundleItem[];
  available: boolean;
  published: boolean;
  printStation: PrintStation;
}

export interface CartLine {
  productId: string;
  quantity: number;
  modifiers?: SelectedModifier[];
}

export interface OrderLine extends CartLine {
  name?: string;
}

export interface Order {
  id: string;
  clientRequestId: string;
  no: string;
  table: string;
  status: OrderStatus;
  note: string;
  items: OrderLine[];
  totalCents: number;
  createdAt: string;
}

export interface ServiceRequest {
  id: string;
  table: string;
  /** Resolved to a display name at render time; never stored localized. */
  serviceType: string;
  status: "open" | "acknowledged" | "completed" | "cancelled";
  createdAt: string;
  pendingSync?: boolean;
}

export type PrinterTransport = "lan" | "bluetooth" | "usb";
export type PrinterLanguage = "zh" | "de" | "en";
export type PrinterEncoding = "utf8" | "gb18030" | "shift_jis" | "cp437";

export interface PrinterProfile {
  id: string;
  name: string;
  transport: PrinterTransport;
  address: string;
  port: number | null;
  role: PrintStation;
  enabled: boolean;
  capabilities?: Record<string, unknown> & { printLanguage?: PrinterLanguage; encoding?: PrinterEncoding };
}

export interface DiscoveredPrinter {
  name: string;
  transport: PrinterTransport;
  address: string;
  port?: number | null;
}

const transitions: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  "pending-sync": ["new", "sync-failed"],
  "sync-failed": ["pending-sync", "cancelled"],
  new: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["completed", "cancelled"],
  completed: [],
  cancelled: []
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return transitions[from].includes(to);
}

export function nextOperationalStatus(status: OrderStatus): OrderStatus | null {
  const next: Partial<Record<OrderStatus, OrderStatus>> = {
    new: "preparing",
    preparing: "ready",
    ready: "completed"
  };
  return next[status] ?? null;
}

export function summarizeCart(lines: readonly CartLine[], products: readonly Product[]) {
  const productsById = new Map(products.map((product) => [product.id, product]));
  return lines.reduce((summary, line) => {
    const product = productsById.get(line.productId);
    if (!product) return summary;
    return {
      count: summary.count + line.quantity,
      totalCents: summary.totalCents + (product.priceCents + (line.modifiers || []).reduce((sum, modifier) => sum + modifier.priceCents, 0)) * line.quantity
    };
  }, { count: 0, totalCents: 0 });
}

export function formatEuro(cents: number): string {
  return `EUR ${(cents / 100).toFixed(2)}`;
}

export { services } from "./seed.js";
export type { ServiceId } from "./seed.js";
export { deconstruct, ingredients, ingredientTerms } from "./ingredients.js";
export type { Deconstruction, DishPart, IngredientEntry } from "./ingredients.js";
export { DEFAULT_MENU_THEME, MENU_THEME_IDS, MENU_THEMES, themeGarland, themePattern } from "./themes.js";
export { DEFAULT_FEATURED_TEMPLATE, FEATURED_TEMPLATE_IDS, FEATURED_TEMPLATES } from "./featured.js";
export type { FeaturedTemplate, FeaturedTemplateId } from "./featured.js";
export type { MenuTheme, MenuThemeId } from "./themes.js";
export { DEFAULT_MENU_LANGUAGES, LANGUAGE_INFO, MENU_LANGUAGES, resolveMenuLanguage } from "./languages.js";
export type { MenuLanguage } from "./languages.js";
export { NAV_ALL, NAV_FEATURED, NAV_PINNED_MAX, NAV_SETS, orderNavTabs } from "./navigation.js";

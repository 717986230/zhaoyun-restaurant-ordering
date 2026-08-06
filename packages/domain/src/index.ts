export type ProductKind = "food" | "drink" | "sushi";
export type PrintStation = "kitchen" | "bar" | "sushi" | "front";
export type OrderStatus = "pending-sync" | "sync-failed" | "new" | "preparing" | "ready" | "completed" | "cancelled";

export interface ProductMedia {
  id?: string;
  type: "image" | "video";
  url: string;
  posterUrl?: string | null;
  sortOrder?: number;
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

export interface Product {
  id: string;
  sku: string;
  kind: ProductKind;
  category: string;
  names: { zh: string; de: string; en: string };
  description: string;
  priceCents: number;
  allergens: string[];
  details: { time: string; people: string; level: string; ingredients: string };
  appearance: { art: string; pattern: string };
  media: ProductMedia[];
  modifiers?: ModifierGroup[];
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
  serviceType: string;
  label: string;
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

export { dishes as seedDishes, orderStatuses as legacyOrderStatusLabels, services } from "./seed.js";

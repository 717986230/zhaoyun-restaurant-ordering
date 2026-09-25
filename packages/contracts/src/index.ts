import type { FeaturedTemplateId } from "@zhaoyun/domain";

/**
 * Types for the wire format. The request shapes are validated at runtime by
 * `src/contracts.js`, which both the server and these types describe; the
 * parity test in `test/parity.test.ts` fails if the two drift apart.
 */

export type OrderStatus = "new" | "preparing" | "ready" | "completed" | "cancelled";
export type ServiceStatus = "open" | "acknowledged" | "completed" | "cancelled";

export interface CreateOrderCommand {
  clientRequestId: string;
  table: string;
  note: string;
  items: Array<{
    id: string;
    qty: number;
    modifiers?: Array<{ id: string }>;
  }>;
}

export interface CreateServiceRequestCommand {
  table: string;
  type: string;
}

/** ISO weekdays it starts on (1 = Monday) and "HH:MM" to "HH:MM". */
export interface ApiSchedule {
  days: number[];
  from: string;
  to: string;
}

export interface ApiCatalogProduct {
  id: string;
  sku: string;
  kind: "food" | "drink" | "sushi";
  category: string;
  names: { zh: string; de: string; en: string };
  description: string;
  price: number;
  vatPercent?: VatPercent;
  allergens: string[];
  details: { time: string; people: string; level: string; ingredients: string };
  appearance: { art: string; pattern: string };
  modifiers?: Array<{
    id: string;
    names: { zh: string; de: string; en: string };
    selection: "single" | "multi";
    options: Array<{ id: string; names: { zh: string; de: string; en: string }; priceCents: number }>;
  }>;
  bundleItems?: Array<{ productId: string; quantity: number }>;
  media?: Array<{ id?: string; type: "image" | "video"; url: string; posterUrl?: string | null; sortOrder?: number; credit?: string | null }>;
  available?: boolean;
  published?: boolean;
  printStation?: "kitchen" | "bar" | "sushi" | "front";
}

export interface ApiOrder {
  id: string;
  clientRequestId: string;
  no: string;
  table: string;
  status: OrderStatus;
  note: string;
  total: number;
  items: Array<{ id: string; name?: string; qty: number; unitPrice?: number; vatPercent?: VatPercent; printStation?: PrintStationName; modifiers?: Array<{ id: string; name: string; price: number }> }>;
  createdAt: string;
  updatedAt?: string;
  billedAt?: string | null;
}

export type PrintStationName = "kitchen" | "bar" | "sushi" | "front";

/** Austrian gastronomy rates; menu prices are gross. */
export type VatPercent = 10 | 13 | 20;

export interface ApiBill {
  table: string;
  orderNos: string[];
  orderIds: string[];
  items: Array<{
    /** The order line, for the register to pay (part of) it. */
    orderItemId: string;
    orderNo: string;
    name: string;
    names?: { zh: string; de: string; en: string };
    /** What is still to pay of the line. */
    qty: number;
    unitPrice: number;
    lineTotal: number;
    vatPercent: VatPercent;
    /** A set menu over more than one rate: how its line divides. */
    vatSplit?: Array<{ percent: VatPercent; amount: number }>;
    modifiers?: Array<{ name: string }>;
  }>;
  vatBreakdown: Array<{ percent: VatPercent; gross: number; net: number; vat: number }>;
  total: number;
  issuedAt: string;
  /** Always false: the fiscal receipt still has to come from the register. */
  fiscalReceipt: false;
  printJobId?: string;
}

export type PaymentType = "cash" | "card" | "voucher";

/** A receipt of the register (shared/register.mjs). Amounts in cents. */
export interface ApiReceipt {
  id: string;
  receiptNo: number;
  cashRegisterId: string;
  type: "sale" | "storno";
  table: string | null;
  lines: Array<{
    kind: "item" | "voucher";
    orderItemId?: string;
    code?: string;
    name: string;
    modifiers?: string[];
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
    vatSplit: Array<{ percent: number; cents: number }>;
  }>;
  vat: Array<{ percent: number; grossCents: number; netCents: number; vatCents: number }>;
  totalCents: number;
  payments: Array<{ type: PaymentType; amountCents: number; tenderedCents?: number; changeCents?: number; voucherCode?: string }>;
  refersTo: string | null;
  refersToNo: number | null;
  reason: string | null;
  /** The storno that cancelled this receipt, if one did. */
  cancelledBy: string | null;
  /** "unsigned" until the register signs (fiskaly). */
  fiscalStatus: "unsigned" | "signed" | "failed";
  staffRole: string;
  createdAt: string;
}

export interface CheckoutCommand {
  clientRequestId?: string;
  table?: string;
  items?: Array<{ orderItemId: string; quantity: number }>;
  vouchers?: Array<{ amount: number }>;
  payments: Array<{ type: PaymentType; amount: number; tendered?: number; voucherCode?: string }>;
}

export interface ApiVoucher { code: string; valueCents: number; balanceCents: number; voided: boolean; createdAt: string }

export interface ApiClosingTotals {
  sales: number;
  stornos: number;
  firstReceiptNo: number | null;
  lastReceiptNo: number | null;
  grossCents: number;
  vat: Array<{ percent: number; grossCents: number; netCents: number; vatCents: number }>;
  payments: Record<PaymentType, number>;
  vouchersSoldCents: number;
  cashCents: number;
}

export interface ApiClosing { id: string; closingNo: number; totals: ApiClosingTotals; createdAt: string }

/** One entry of the journal (DEP 131), chained to the one before by its hash. */
export interface ApiJournalEntry { seq: number; at: string; kind: string; ref: string | null; payload: unknown; prevHash: string; hash: string }
export interface ApiJournalExport { entries: ApiJournalEntry[]; verification: { ok: boolean; brokenAt: number | null; reason: "chain" | "content" | null } }

export interface ApiServiceRequest {
  id: string;
  table: string;
  type: string;
  status: ServiceStatus;
  createdAt: string;
  updatedAt: string;
}

export type MenuThemeId =
  | "jade" | "teal" | "terracotta"
  | "spring-festival" | "valentine" | "easter" | "back-to-school"
  | "mid-autumn" | "national-day" | "christmas" | "halloween";

/** The languages a guest can switch the menu into, in flag order. */
export type MenuLanguage = "zh" | "en" | "de";

export type ColorScheme = "dark" | "light";

export interface ApiSettings {
  menuTheme: MenuThemeId;
  /** Which of the three the menu offers; at least one. */
  menuLanguages: MenuLanguage[];
  /** On the admin console, the browser tab and the printed table cards. */
  restaurantName: string;
  /** The heading of the guest menu. */
  menuTitle: string;
  /** What a guest sees before touching the sun/moon; their own pick wins. */
  menuDefaultScheme: ColorScheme;
  showTableNumber: boolean;
  /** Orders, table billing and printers in the admin console; off while the
   *  menu is view-only. */
  showOrdering: boolean;
  /** The promotions page: on or off, its heading (empty: the menu's own
   *  wording), and its dishes in the order shown. */
  featuredEnabled: boolean;
  featuredTitle: string;
  featuredProductIds: string[];
  featuredTemplate: FeaturedTemplateId;
  /** The restaurant's clock ("Europe/Vienna"), which the pages' hours follow. */
  timeZone: string;
  /** When the promotions page and the set menus page are on; null: always. */
  featuredSchedule: ApiSchedule | null;
  setsSchedule: ApiSchedule | null;
  /** The guest menu's first three tabs, in order: "__sets__", "__featured__",
   *  "ALLE" or a category. The rest follow in their usual order. */
  navPinned: string[];
  /** The owner's own names for the tabs ("ALLE", "__sets__", a category), per
   *  menu language; a missing name keeps the menu's own wording. */
  navLabels: NavLabels;
  /** Who issues the receipts (§ 132a BAO); an empty name is the restaurant's. */
  companyName: string;
  companyAddress: string;
  /** ATU and eight digits, or empty. */
  companyUid: string;
  /** The register's id printed on each receipt. */
  cashRegisterId: string;
}

/** Tab → language → the name the guest sees. */
export type NavLabels = Record<string, Partial<Record<MenuLanguage, string>>>;

/** The part of the settings the guest menu reads, served with the catalogue. */
export interface ApiMenuSettings {
  title: string;
  restaurantName: string;
  defaultScheme: ColorScheme;
  showTableNumber: boolean;
  /** The restaurant's clock; absent from a server older than page hours. */
  timeZone?: string;
  /** When the set menus page is on; null or absent: always. */
  setsSchedule?: ApiSchedule | null;
  /** The tabs the owner put first to third; absent from an older server. */
  navPinned?: string[];
  /** The owner's names for the tabs; absent from an older server. */
  navLabels?: NavLabels;
  /** The promotions page, when the owner switched it on. An empty title means
   *  the menu's own wording for it. */
  featured?: { title: string; productIds: string[]; template: FeaturedTemplateId; schedule?: ApiSchedule | null } | null;
}

export type PrintJobStatus = "queued" | "claimed" | "printing" | "printed" | "retry-wait" | "failed";

export interface ApiPrintJob {
  id: string;
  orderId: string | null;
  printerRole: PrintStationName;
  status: PrintJobStatus;
  attempts: number;
  error: string | null;
  nextAttemptAt: string | null;
  payload: {
    orderNo?: string;
    table?: string;
    note?: string;
    items?: Array<{ sku?: string; name?: string; quantity?: number }>;
  };
  createdAt: string;
  updatedAt: string;
}

// Aliases kept for the admin console, which names them this way.
export type ApiOrderStatus = OrderStatus;
export type ApiServiceRequestStatus = ServiceStatus;

export interface RealtimeEnvelope<T = unknown> {
  type: "connected" | "catalog.changed" | "order.changed" | "service.changed" | "print.queued" | "bill.settled";
  payload?: T;
  at: string;
}

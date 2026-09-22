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
  media?: Array<{ id?: string; type: "image" | "video"; url: string; posterUrl?: string | null; sortOrder?: number }>;
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
    orderNo: string;
    name: string;
    names?: { zh: string; de: string; en: string };
    qty: number;
    unitPrice: number;
    lineTotal: number;
    vatPercent: VatPercent;
    modifiers?: Array<{ name: string }>;
  }>;
  vatBreakdown: Array<{ percent: VatPercent; gross: number; net: number; vat: number }>;
  total: number;
  issuedAt: string;
  /** Always false: the fiscal receipt still has to come from the register. */
  fiscalReceipt: false;
  printJobId?: string;
}

export interface ApiServiceRequest {
  id: string;
  table: string;
  type: string;
  status: ServiceStatus;
  createdAt: string;
  updatedAt: string;
}

export type MenuThemeId = "jade" | "teal" | "terracotta";

export interface ApiSettings {
  menuTheme: MenuThemeId;
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

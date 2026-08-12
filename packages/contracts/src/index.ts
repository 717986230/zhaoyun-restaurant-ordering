import { Static, Type } from "@sinclair/typebox";

export const OrderStatusSchema = Type.Union([
  Type.Literal("new"), Type.Literal("preparing"), Type.Literal("ready"),
  Type.Literal("completed"), Type.Literal("cancelled")
]);

export const CreateOrderSchema = Type.Object({
  clientRequestId: Type.String({ minLength: 8, maxLength: 128 }),
  table: Type.String({ minLength: 1, maxLength: 32 }),
  note: Type.String({ maxLength: 500 }),
  items: Type.Array(Type.Object({
    id: Type.String({ minLength: 1 }),
    qty: Type.Integer({ minimum: 1, maximum: 99 }),
    modifiers: Type.Optional(Type.Array(Type.Object({
      id: Type.String({ minLength: 1, maxLength: 64 })
    }), { maxItems: 32 }))
  }), { minItems: 1, maxItems: 100 })
});

export const CreateServiceRequestSchema = Type.Object({
  table: Type.String({ minLength: 1, maxLength: 32 }),
  type: Type.String({ minLength: 1, maxLength: 64 })
});

export type CreateOrderCommand = Static<typeof CreateOrderSchema>;
export type CreateServiceRequestCommand = Static<typeof CreateServiceRequestSchema>;

export interface ApiCatalogProduct {
  id: string;
  sku: string;
  kind: "food" | "drink" | "sushi";
  category: string;
  names: { zh: string; de: string; en: string };
  description: string;
  price: number;
  allergens: string[];
  details: { time: string; people: string; level: string; ingredients: string };
  appearance: { art: string; pattern: string };
  modifiers?: Array<{
    id: string;
    names: { zh: string; de: string; en: string };
    selection: "single" | "multi";
    options: Array<{ id: string; names: { zh: string; de: string; en: string }; priceCents: number }>;
  }>;
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
  status: Static<typeof OrderStatusSchema>;
  note: string;
  total: number;
  items: Array<{ id: string; name?: string; qty: number; unitPrice?: number; printStation?: PrintStationName; modifiers?: Array<{ id: string; name: string; price: number }> }>;
  createdAt: string;
  updatedAt?: string;
}

export type PrintStationName = "kitchen" | "bar" | "sushi" | "front";

export interface ApiServiceRequest {
  id: string;
  table: string;
  type: string;
  status: "open" | "acknowledged" | "completed" | "cancelled";
  createdAt: string;
  updatedAt: string;
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

export interface RealtimeEnvelope<T = unknown> {
  type: "connected" | "catalog.changed" | "order.changed" | "service.changed" | "print.queued";
  payload?: T;
  at: string;
}

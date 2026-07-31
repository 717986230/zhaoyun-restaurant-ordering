import { Type } from "@sinclair/typebox";

const IdParams = Type.Object({ id: Type.String({ minLength: 1, maxLength: 128 }) });
const LimitQuery = Type.Object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 })) });
const Names = Type.Object({
  zh: Type.String({ maxLength: 160 }),
  de: Type.String({ maxLength: 160 }),
  en: Type.String({ maxLength: 160 })
});
const Details = Type.Object({
  ingredients: Type.String({ maxLength: 1000 }),
  time: Type.String({ maxLength: 64 }),
  people: Type.String({ maxLength: 64 }),
  level: Type.String({ maxLength: 64 })
});

export const ProductBody = Type.Object({
  sku: Type.String({ maxLength: 64 }),
  kind: Type.Union([Type.Literal("food"), Type.Literal("drink"), Type.Literal("sushi")]),
  category: Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9_-]+$" }),
  names: Names,
  description: Type.Optional(Type.String({ maxLength: 2000 })),
  price: Type.Number({ minimum: 0, maximum: 100000 }),
  details: Type.Optional(Details),
  allergens: Type.Optional(Type.Array(Type.String({ maxLength: 8 }), { maxItems: 32 })),
  printStation: Type.Union([Type.Literal("kitchen"), Type.Literal("bar"), Type.Literal("sushi"), Type.Literal("front")]),
  available: Type.Optional(Type.Boolean()),
  published: Type.Optional(Type.Boolean()),
  sortOrder: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
  appearance: Type.Optional(Type.Object({
    art: Type.String({ maxLength: 400 }),
    pattern: Type.String({ maxLength: 32 })
  }))
});

export const PrinterBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
  transport: Type.Union([Type.Literal("lan"), Type.Literal("bluetooth"), Type.Literal("usb")]),
  address: Type.String({ minLength: 1, maxLength: 255 }),
  port: Type.Union([Type.Integer({ minimum: 1, maximum: 65535 }), Type.Null()]),
  role: Type.Union([Type.Literal("kitchen"), Type.Literal("bar"), Type.Literal("sushi"), Type.Literal("front")]),
  enabled: Type.Boolean(),
  capabilities: Type.Optional(Type.Record(Type.String({ maxLength: 80 }), Type.Unknown()))
});

export const CreateOrderBody = Type.Object({
  clientRequestId: Type.String({ minLength: 8, maxLength: 128 }),
  table: Type.String({ minLength: 1, maxLength: 32 }),
  note: Type.String({ maxLength: 500 }),
  items: Type.Array(Type.Object({
    id: Type.String({ minLength: 1, maxLength: 128 }),
    qty: Type.Integer({ minimum: 1, maximum: 99 })
  }), { minItems: 1, maxItems: 100 })
});

export const ServiceRequestBody = Type.Object({
  table: Type.String({ minLength: 1, maxLength: 32 }),
  type: Type.String({ minLength: 1, maxLength: 64 })
});

export const OrderStatusBody = Type.Object({
  status: Type.Union([Type.Literal("new"), Type.Literal("preparing"), Type.Literal("ready"), Type.Literal("completed"), Type.Literal("cancelled")])
});

export const ServiceStatusBody = Type.Object({
  status: Type.Union([Type.Literal("open"), Type.Literal("acknowledged"), Type.Literal("completed"), Type.Literal("cancelled")])
});

export const PrintJobsQuery = Type.Object({
  status: Type.Optional(Type.Union([Type.Literal("queued"), Type.Literal("claimed"), Type.Literal("printing"), Type.Literal("printed"), Type.Literal("retry-wait"), Type.Literal("failed")])),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500 }))
});

export { IdParams, LimitQuery };

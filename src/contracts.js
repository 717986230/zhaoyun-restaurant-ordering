import { Type } from "@sinclair/typebox";
import { ALLERGEN_CODES } from "./allergens.js";
import { FEATURED_TEMPLATES } from "../shared/rules.mjs";

/**
 * The wire contract, defined once.
 *
 * The Fastify server validates against these and the browser clients derive
 * their request types from them. It lives in plain JavaScript because the
 * server runs straight from source with `node server/index.mjs` — a build step
 * between a restaurant and its ordering API is one more thing to get wrong.
 */

// A table number is at most 8 characters everywhere: the registry, the guard
// and the kiosk link all agree, so the schema must not promise more.
const TableNo = Type.String({ minLength: 1, maxLength: 8 });
const ProductId = Type.String({ minLength: 1, maxLength: 128 });

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

const ModifierOption = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 64 }),
  names: Names,
  priceCents: Type.Integer({ minimum: 0, maximum: 100000 })
});

const ModifierGroup = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 64 }),
  names: Names,
  selection: Type.Union([Type.Literal("single"), Type.Literal("multi")]),
  options: Type.Array(ModifierOption, { maxItems: 32 })
});

const BundleItem = Type.Object({
  productId: ProductId,
  quantity: Type.Integer({ minimum: 1, maximum: 99 })
});

export const ORDER_STATUSES = ["new", "preparing", "ready", "completed", "cancelled"];
export const SERVICE_STATUSES = ["open", "acknowledged", "completed", "cancelled"];
export const PRINT_STATIONS = ["kitchen", "bar", "sushi", "front"];
export const PRINT_JOB_STATUSES = ["queued", "claimed", "printing", "printed", "retry-wait", "failed"];
export const VAT_PERCENTS = [10, 13, 20];
// The colour hexes for each id live in packages/domain/src/themes.ts, next to
// the guest app that renders them; the wire contract only needs the ids.
export const MENU_THEMES = ["jade", "teal", "terracotta"];

const literals = (values) => Type.Union(values.map((value) => Type.Literal(value)));

export const OrderStatusSchema = literals(ORDER_STATUSES);
export const ServiceStatusSchema = literals(SERVICE_STATUSES);
export const PrintStationSchema = literals(PRINT_STATIONS);

export const CreateOrderBody = Type.Object({
  clientRequestId: Type.String({ minLength: 8, maxLength: 128 }),
  table: TableNo,
  note: Type.String({ maxLength: 500 }),
  items: Type.Array(Type.Object({
    id: ProductId,
    qty: Type.Integer({ minimum: 1, maximum: 99 }),
    modifiers: Type.Optional(Type.Array(Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }) }), { maxItems: 32 }))
  }), { minItems: 1, maxItems: 100 })
});

export const ServiceRequestBody = Type.Object({
  table: TableNo,
  type: Type.String({ minLength: 1, maxLength: 64 })
});

export const OrderStatusBody = Type.Object({ status: OrderStatusSchema });
export const ServiceStatusBody = Type.Object({ status: ServiceStatusSchema });

// When a page is on the menu; src/schedule.js has the rules and checks them
// again (a from/to pattern here, the rest there), null is "always".
const Clock = Type.String({ pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" });
const Schedule = Type.Object({
  days: Type.Array(Type.Integer({ minimum: 1, maximum: 7 }), { minItems: 1, maxItems: 7 }),
  from: Clock,
  to: Clock
});

export const ProductBody = Type.Object({
  sku: Type.String({ maxLength: 64 }),
  kind: Type.Union([Type.Literal("food"), Type.Literal("drink"), Type.Literal("sushi")]),
  // Seven seeded categories contain a space (HOT POT, MAIN DISHES, WINE APERITIF …).
  // Without one here the seed goes in through the database layer and then 45 of the
  // 111 products cannot be saved again from the admin console.
  category: Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9][A-Za-z0-9 _-]*$" }),
  names: Names,
  description: Type.Optional(Type.String({ maxLength: 2000 })),
  price: Type.Number({ minimum: 0, maximum: 100000 }),
  details: Type.Optional(Details),
  allergens: Type.Optional(Type.Array(literals(ALLERGEN_CODES), { maxItems: ALLERGEN_CODES.length })),
  vatPercent: Type.Optional(literals(VAT_PERCENTS)),
  printStation: PrintStationSchema,
  available: Type.Optional(Type.Boolean()),
  published: Type.Optional(Type.Boolean()),
  sortOrder: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
  appearance: Type.Optional(Type.Object({
    art: Type.String({ maxLength: 400 }),
    pattern: Type.String({ maxLength: 32 })
  })),
  modifiers: Type.Optional(Type.Array(ModifierGroup, { maxItems: 16 })),
  // A combo: the existing dishes it packages, so it is otherwise a normal
  // product with its own name, price and photo, not a distinct product kind.
  bundleItems: Type.Optional(Type.Array(BundleItem, { maxItems: 32 }))
});

// The languages a menu can offer, in flag order; shared/rules.mjs holds the
// same list, and parity.test.ts holds the two to each other.
export const MENU_LANGUAGES = ["zh", "en", "de"];

export const COLOR_SCHEMES = ["dark", "light"];

// Any subset may be saved; an empty body is a mistake, not a save. The text
// limits are the ones shared/rules.mjs enforces after trimming, stated here too
// so an oversized value is a 400 at the edge.
export const SettingsBody = Type.Object({
  menuTheme: Type.Optional(literals(MENU_THEMES)),
  menuLanguages: Type.Optional(Type.Array(literals(MENU_LANGUAGES), { minItems: 1, maxItems: MENU_LANGUAGES.length, uniqueItems: true })),
  restaurantName: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
  menuTitle: Type.Optional(Type.String({ minLength: 1, maxLength: 24 })),
  menuDefaultScheme: Type.Optional(literals(COLOR_SCHEMES)),
  showTableNumber: Type.Optional(Type.Boolean()),
  showOrdering: Type.Optional(Type.Boolean()),
  featuredEnabled: Type.Optional(Type.Boolean()),
  featuredTitle: Type.Optional(Type.String({ maxLength: 32 })),
  featuredProductIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 40 })),
  featuredTemplate: Type.Optional(literals(FEATURED_TEMPLATES)),
  // An IANA zone ("Europe/Vienna"); which ones exist is Intl's to say.
  timeZone: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  // The promotions and set menus pages' hours; null: always on.
  featuredSchedule: Type.Optional(Type.Union([Schedule, Type.Null()])),
  setsSchedule: Type.Optional(Type.Union([Schedule, Type.Null()])),
  // The guest menu's second and third tabs; the set menus are always first.
  navPinned: Type.Optional(Type.Array(Type.String({ maxLength: 64 }), { maxItems: 3 }))
}, { minProperties: 1, additionalProperties: false });

// The console's password gate. The floor is the one `assertPassword` enforces
// — stated twice on purpose, so a too-short password is refused at the edge
// with a 400 rather than turning into a 500 further in. There is no username:
// there is one console and one password on it.
const Password = Type.String({ minLength: 6, maxLength: 200 });

export const SignInBody = Type.Object({
  password: Password
});

// `currentPassword` is absent the first time, when there is nothing to prove,
// and required afterwards — a rule the database enforces, because only it
// knows whether a password is already set.
export const SetPasswordBody = Type.Object({
  password: Password,
  currentPassword: Type.Optional(Password)
});

export const PrinterBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
  transport: Type.Union([Type.Literal("lan"), Type.Literal("bluetooth"), Type.Literal("usb")]),
  address: Type.String({ minLength: 1, maxLength: 255 }),
  port: Type.Union([Type.Integer({ minimum: 1, maximum: 65535 }), Type.Null()]),
  role: PrintStationSchema,
  enabled: Type.Boolean(),
  capabilities: Type.Optional(Type.Record(Type.String({ maxLength: 80 }), Type.Unknown()))
});

export const TableLockBody = Type.Object({
  locked: Type.Boolean()
});

export const TableBody = Type.Object({
  table: TableNo,
  label: Type.Optional(Type.String({ maxLength: 64 })),
  enabled: Type.Optional(Type.Boolean()),
  rotateToken: Type.Optional(Type.Boolean())
});

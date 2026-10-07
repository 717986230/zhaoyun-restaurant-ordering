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

/** How a guest's own order came in: at their table, or to pick up (shared/ordering.mjs). */
export type GuestChannel = "dine-in" | "pickup";
export type GuestPayment = "in-store" | "online";

/** A guest's own order from the menu (POST /api/guest/orders). A reward is a dish bought with points. */
export interface GuestOrderCommand {
  clientRequestId: string;
  channel: GuestChannel;
  /** The table, for an order at it; a pickup names none. */
  table?: string;
  note: string;
  payment?: GuestPayment;
  items: Array<{
    id: string;
    qty: number;
    modifiers?: Array<{ id: string }>;
    reward?: boolean;
  }>;
}

/** Why a guest's order was refused, for the menu to say what to do. */
export type GuestOrderRefusal =
  | "ORDERING_OFF" | "ORDERING_CLOSED" | "TABLE_NOT_OPEN" | "TABLE_LOCKED" | "TOO_SOON" | "ORDER_TOO_LARGE"
  | "SIGN_IN_REQUIRED" | "TOO_MANY_PICKUPS" | "NOT_ENOUGH_POINTS" | "PAYMENT_UNAVAILABLE" | "BAD_CHANNEL" | "SOLD_OUT";

/** A guest's own account (shared/customer.mjs). */
/** `emailVerified`: the address, as it is now, was proved by a code (shared/email-verify.mjs). */
/** A guest's account. Signed up by mobile number: `phone` is set, and `email` holds the same number (how they sign in). */
export interface ApiCustomer { id: string; email: string; name: string; points: number; createdAt: string; emailVerified?: boolean; phone?: string }
export interface CustomerSession { token: string; expiresInMs: number; customer: ApiCustomer }
export interface CustomerRegisterCommand { email: string; name?: string; password: string }
/** Every change is made against the password in force. */
export interface CustomerUpdateCommand { currentPassword: string; name?: string; password?: string }
export type PointsReason = "earn" | "reverse" | "redeem" | "refund" | "adjust";
/**
 * The booking membership's own lines among the adjustments: the first visit's
 * bonus, a missed booking's cost, and that given back.
 */
export type PointsKind = "welcome" | "no_show" | "no_show_back";
export interface ApiPointsEntry { id: string; delta: number; reason: PointsReason; ref: string | null; note: string; createdAt: string; kind?: PointsKind }
/** A member's code scanned at the counter: the guest, and whether this visit gave the first visit's bonus. */
export interface ApiMemberVisit { customer: ApiCustomer; granted: boolean; welcomePoints: number; minPoints: number }
/**
 * Everything the restaurant keeps about one guest's account, as they may ask
 * for it (GDPR Art. 15 and 20): machine-readable, in one file.
 */
export interface CustomerDataExport {
  format: "zhaoyun-customer-export/1";
  exportedAt: string;
  restaurant: { name: string; company: string; address: string };
  account: ApiCustomer & { updatedAt: string };
  favorites: string[];
  points: ApiPointsEntry[];
  orders: ApiOrder[];
}

/** Ordering from the menu and its limits, as the owner sets them. */
export interface ApiGuestOrdering {
  enabled: boolean;
  dineIn: boolean;
  pickup: boolean;
  /** When guests may order; empty: whenever it is switched on. */
  hours: ApiSchedule[];
  /** Only at a table a waiter opened (开台). */
  requireOpenTable: boolean;
  /** An open table closes for ordering after this long, paid or not. */
  tableSessionHours: number;
  maxItems: number;
  maxOrderCents: number;
  /** One order per table (per guest, for pickup) this often. */
  minIntervalSeconds: number;
  /** Pickups a guest may have waiting at once. */
  maxOpenPickups: number;
}

/** Points for what guests pay, and the dishes they buy with them. */
export interface ApiLoyalty {
  enabled: boolean;
  pointsPerEuro: number;
  rewards: Array<{ productId: string; points: number }>;
  maxRewardsPerOrder: number;
}

/** A table open for its guests' phones (开台). */
export interface ApiTableSession { table: string; openedAt: string; expiresAt: string; staffName: string | null }

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
  /** 每日限量 (shared/stock.mjs): the portions each day starts with, and what is left today; null for no limit. */
  dailyLimit?: number | null;
  leftToday?: number | null;
}

export interface ApiOrder {
  id: string;
  clientRequestId: string;
  no: string;
  table: string;
  status: OrderStatus;
  note: string;
  total: number;
  items: Array<{ id: string; name?: string; qty: number; /** How much of the line receipts paid for, and was voided. */ paid?: number; voided?: number; unitPrice?: number; vatPercent?: VatPercent; printStation?: PrintStationName; modifiers?: Array<{ id: string; name: string; names?: { zh: string; de: string; en: string }; price: number }> }>;
  createdAt: string;
  updatedAt?: string;
  billedAt?: string | null;
  /** The waiter who took it on a POS; absent for a guest's own order. */
  staffName?: string;
  /** A takeaway's pickup number. */
  pickupNo?: number;
  /** A guest's own order from the menu: at the table or for pickup. */
  channel?: GuestChannel;
  /** The points its rewards took. */
  pointsSpent?: number;
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
    kind: "item" | "voucher" | "discount";
    names?: { zh: string; de: string; en: string };
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
  /** `tipCents`: Trinkgeld paid with it, beside the amount and not in the total. */
  payments: Array<{ type: PaymentType; amountCents: number; tenderedCents?: number; changeCents?: number; voucherCode?: string; tipCents?: number }>;
  refersTo: string | null;
  refersToNo: number | null;
  reason: string | null;
  /** The storno that cancelled this receipt, if one did. */
  cancelledBy: string | null;
  /** "unsigned" until the register signs (fiskaly). */
  fiscalStatus: "unsigned" | "signed" | "failed";
  staffRole: string;
  /** The waiter who took it, on the POS. */
  staffId?: string | null;
  staffName?: string | null;
  createdAt: string;
}

export interface CheckoutCommand {
  clientRequestId?: string;
  table?: string;
  /** Off the dishes, per VAT rate: a takeaway's pickup discount, say. */
  discountPercent?: number;
  items?: Array<{ orderItemId: string; quantity: number }>;
  vouchers?: Array<{ amount: number }>;
  payments: Array<{ type: PaymentType; amount: number; tendered?: number; voucherCode?: string; tip?: number }>;
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
  discountCents?: number;
  cashCents: number;
  /** Trinkgeld per way paid: the staff's, not in the takings (absent on closings from before tips). */
  tips?: { cash: number; card: number };
  tipsCents?: number;
}

export interface ApiClosing { id: string; closingNo: number; totals: ApiClosingTotals; createdAt: string }

/** Sales over the manager's days (shared/reports.mjs): from the receipts, in the restaurant's time zone. */
export interface ApiSalesReport {
  from: string;
  to: string;
  timeZone: string;
  totals: ApiClosingTotals & { receipts: number; averageCents: number };
  days: Array<{ date: string; receipts: number; grossCents: number }>;
  hours: Array<{ hour: number; receipts: number; grossCents: number }>;
  items: Array<{ name: string; names: { zh: string; de: string; en: string } | null; quantity: number; grossCents: number }>;
  staff: Array<{ name: string; receipts: number; grossCents: number; tipsCents?: number }>;
  /** The delivery platforms' orders over the same days: not in the receipts, the platform collects the money. */
  delivery?: ApiDeliveryTotals[];
}

/** One entry of the journal (DEP 131), chained to the one before by its hash. */
export interface ApiJournalEntry { seq: number; at: string; kind: string; ref: string | null; payload: unknown; prevHash: string; hash: string }
export interface ApiJournalExport { entries: ApiJournalEntry[]; verification: { ok: boolean; brokenAt: number | null; reason: "chain" | "content" | null } }

/** The POS (shared/pos.mjs). */
/** The restaurant's account (shared/account.mjs): what the owner registers and signs in with. */
export interface ApiAccount { id: string; login: string; name: string; createdAt: string }
export interface AccountSession { token: string; expiresInMs: number; account: ApiAccount }
export interface RegisterCommand { login: string; name?: string; password: string }
/** Every change is made against the password in force. */
export interface AccountUpdateCommand { currentPassword: string; login?: string; name?: string; password?: string }

export interface PosStaff { id: string; name: string; role: "staff" | "manager"; active?: boolean }
export interface PosDevice { id: string; name: string; createdAt: string; lastSeenAt: string | null }
/** A table open on a device, locked to it until closed or left alone. */
export interface PosClaim { table: string; deviceId: string; staffId: string | null; staffName: string | null; expiresAt: string }
/** A waiter as the manager watches the floor (GET /api/admin/staff/activity). */
export interface PosStaffActivity extends PosStaff {
  online: boolean;
  /** The devices they are signed in on now. */
  devices: string[];
  /** The tables they have open now. */
  tables: string[];
  /** Since their last settlement: what they took, the cash they hold included. */
  shift: ApiClosingTotals & { receipts: number; voids: PosVoidTotals; handInCents?: number };
}

/** What a waiter voided since their last settlement (退菜). */
export interface PosVoidTotals { count: number; cents: number }
/** Dishes taken off a bill after they went to the kitchen. */
export interface PosVoid { id: string; orderItemId: string; quantity: number; amountCents: number; reason: string; staffName: string | null; createdAt: string }
/** The cash drawer (shared/drawer.mjs): what should be in it, and once counted what was. */
export interface PosDrawerTotals {
  floatCents: number;
  receipts: number;
  firstReceiptNo: number | null;
  lastReceiptNo: number | null;
  cashSalesCents: number;
  /** Paid out of the till to the staff: they came in on the card terminal. */
  cardTipsCents: number;
  /** Kept by the staff, never in the drawer: shown for the record. */
  cashTipsCents: number;
  inCents: number;
  outCents: number;
  expectedCents: number;
  countedCents?: number;
  /** Over when positive, short when negative. */
  differenceCents?: number;
}
export interface PosDrawerMovement { id: string; kind: "in" | "out"; amountCents: number; reason: string; staffName: string | null; createdAt: string }
export interface PosDrawer {
  id: string;
  open: boolean;
  openedAt: string;
  openedBy: string | null;
  closedAt: string | null;
  closedBy: string | null;
  note: string | null;
  /** Cents of each note or coin → how many, when counted that way. */
  counts: Record<string, number> | null;
  totals: PosDrawerTotals;
  movements: PosDrawerMovement[];
}
export interface DrawerCloseCommand { counts?: Record<string, number>; amount?: number; note?: string }

/** `handInCents`: the cash they took less the card tips they keep back (absent on settlements from before tips). */
export interface PosSettlement { id: string; staffId: string; staffName: string; totals: ApiClosingTotals & { receipts: number; voids?: PosVoidTotals; handInCents?: number }; createdAt: string }

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
  /** The discount a takeaway gets at the POS, percent. */
  takeawayDiscountPercent: number;
  /** Tables the floor shows by number, 1 to this. */
  floorTables: number;
  /** Guests' own accounts on the menu (favourites); pickup and points need them too. */
  customerAccounts: boolean;
  guestOrdering: ApiGuestOrdering;
  loyalty: ApiLoyalty;
  /** Online table bookings and their rules (shared/reservations.mjs). */
  reservations: ApiReservationSettings;
  /** The delivery platforms: which are on, and how their orders come in (shared/delivery.mjs). */
  delivery: ApiDeliverySettings;
}

/** Lieferando (Just Eat Takeaway) and foodora (Delivery Hero). */
export type DeliveryProvider = "lieferando" | "foodora";
export type DeliveryStatus = "new" | "accepted" | "ready" | "completed" | "rejected" | "cancelled";
export type DeliveryRejectReason = "TOO_BUSY" | "CLOSED" | "ITEM_UNAVAILABLE" | "OUTSIDE_DELIVERY_AREA" | "OTHER";
/** One platform's switches. */
export interface ApiDeliveryPlatformSettings {
  enabled: boolean;
  /** To the kitchen on arrival, without anyone saying yes. */
  autoAccept: boolean;
  /** Minutes an order takes, told to the platform on accepting. */
  prepMinutes: number;
  /** The restaurant's id at the platform, for the owner's reference. */
  storeId: string;
}
export type ApiDeliverySettings = Record<DeliveryProvider, ApiDeliveryPlatformSettings>;
/** A platform as the console sees it: its switches, and whether this deployment holds its secrets (never the secrets). */
export interface ApiDeliveryPlatform extends ApiDeliveryPlatformSettings {
  id: DeliveryProvider;
  name: string;
  webhook: boolean;
  api: boolean;
  ordersPath: string;
  eventsPath: string;
}
export interface ApiDeliveryLine {
  sku: string;
  name: string;
  quantity: number;
  unitCents: number;
  options: Array<{ name: string; quantity: number; unitCents: number }>;
  note: string;
}
/** An order from a delivery platform (shared/delivery.mjs, deliveryOrderView). */
export interface ApiDeliveryOrder {
  id: string;
  provider: DeliveryProvider;
  providerName: string;
  externalId: string;
  reference: string;
  status: DeliveryStatus;
  type: "delivery" | "pickup";
  placedAt: string | null;
  dueAt: string | null;
  customerName: string;
  customerPhone: string;
  address: string;
  notes: string;
  items: ApiDeliveryLine[];
  totalCents: number;
  deliveryFeeCents: number;
  paidOnline: boolean;
  test: boolean;
  prepMinutes: number | null;
  rejectReason: string | null;
  /** The kitchen's view only: when the floor told the platform it would be ready. */
  readyBy?: string | null;
  /** A new order's dishes the kitchen is out of, by hand or by today's count (POS floor only). */
  shortages?: Array<{ sku: string; name: string; wanted: number; left: number }>;
  /** What the platform said to our answer: sent, failed, or nothing to send (not connected, a test order). */
  sync: { status: "none" | "sent" | "failed"; error: string | null; at: string | null };
  createdAt: string;
  updatedAt: string;
}
/** Per platform, over some days: orders cooked and their money, and those turned down or cancelled. */
export interface ApiDeliveryTotals { provider: DeliveryProvider; name: string; orders: number; grossCents: number; rejected: number; cancelled: number }

/** The owner's rules for online bookings. */
export interface ApiReservationSettings {
  enabled: boolean;
  /** When bookings are taken: per period, the first and the last time a table is booked for. */
  hours: ApiSchedule[];
  /** Times offered every 15, 30 or 60 minutes. */
  intervalMinutes: 15 | 30 | 60;
  /** How long a booking holds its seats. */
  durationMinutes: number;
  /** Guests seated at once from bookings, at most. */
  capacity: number;
  /** The largest party booked online; a larger one calls. */
  maxParty: number;
  /** How long before the time a booking must be made online, minutes. */
  leadMinutes: number;
  /** How many days ahead bookings open. */
  daysAhead: number;
  /** Confirmed at once; off: pending until the floor confirms. */
  autoConfirm: boolean;
  /** Days the restaurant takes no bookings (YYYY-MM-DD). */
  closedDates: string[];
  /** Shown to guests on the booking page. */
  note: string;
  /** The tables guests pick from online, with their seats; empty: the floor seats them. */
  tables: ApiBookableTable[];
  /** Per guest (account or phone number): bookings still to come at once, and on one day. */
  maxActivePerGuest: number;
  maxPerDayPerGuest: number;
  /** No-shows in 180 days before a guest must call instead; 0: never. */
  noShowLimit: number;
  /** Booking for members: the points a guest needs to book online (0: anyone signed in). */
  minPoints: number;
  /** Points for a guest's first paid visit, once per account. */
  welcomePoints: number;
  /** Points a missed booking costs. */
  noShowPoints: number;
  /** Minutes past its time before a booking not checked in counts as missed; 0: only the floor marks it. */
  noShowAfterMinutes: number;
}

export interface ApiBookableTable { table: string; seats: number }

export type ReservationStatus = "pending" | "confirmed" | "seated" | "completed" | "cancelled" | "declined" | "no_show";

/** A booking as the floor sees it. The day and time are the restaurant's. */
export interface ApiReservation {
  id: string;
  /** Six letters and digits, for the phone. */
  reference: string;
  date: string;
  time: string;
  party: number;
  name: string;
  phone: string;
  email: string;
  notes: string;
  status: ReservationStatus;
  table: string | null;
  source: "online" | "staff";
  language: MenuLanguage | null;
  /** The guest account it was made from, its email, and that guest's no-shows in 180 days. */
  customerId: string | null;
  accountEmail?: string | null;
  guestNoShows?: number;
  createdAt: string;
  updatedAt: string;
}

/** A booking as the guest holding its link sees it. */
export type ApiGuestReservation = Omit<ApiReservation, "source" | "customerId" | "accountEmail" | "guestNoShows"> & { cancellable?: boolean };

/** What the booking page reads before a guest picks anything. */
export interface ApiBookingInfo {
  enabled: boolean;
  /** The menu's languages, in its flag order: the booking page offers the same (absent from an older server). */
  languages?: MenuLanguage[];
  /** Whether a guest proves their email by a code before booking: only where mail goes out. */
  emailVerification?: boolean;
  restaurantName: string;
  timeZone: string;
  maxParty: number;
  /** The restaurant's today, and the last day that can be booked. */
  today: string;
  lastDate: string;
  /** Weekdays with any hours, 1 = Monday. */
  days: number[];
  closedDates: string[];
  durationMinutes: number;
  note: string;
  /** The guest picks their table (absent from an older server: they do not). */
  seatSelection?: boolean;
  tables?: ApiBookableTable[];
  /** Booking needs a guest account; the limits per guest. */
  signInRequired?: boolean;
  maxActivePerGuest?: number;
  maxPerDayPerGuest?: number;
  /** Booking for members: the points it needs, what the first visit brings, what a missed booking costs. */
  minPoints?: number;
  welcomePoints?: number;
  noShowPoints?: number;
}

export interface ApiReservationSlot { time: string; available: boolean }
/** A bookable table at one time: free and big enough for the party, or not. */
export interface ApiTableChoice { table: string; seats: number; available: boolean }

export interface ReservationCommand {
  date: string;
  time: string;
  party: number;
  name: string;
  /** A mobile number or an email: either will do. */
  phone?: string;
  email?: string;
  notes?: string;
  language?: MenuLanguage;
  /** The table the guest picked, where the restaurant lets them. */
  table?: string;
}

export interface StaffReservationCommand extends Omit<ReservationCommand, "phone" | "language"> {
  phone?: string;
  table?: string;
}

export type ReservationUpdateCommand = Partial<Omit<StaffReservationCommand, "table">> & { status?: ReservationStatus; table?: string };

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
  /** Guests can have accounts (favourites, pickup, points); absent from an older server. */
  accounts?: boolean;
  /** Ordering from the menu, when the owner switched it on. */
  ordering?: Pick<ApiGuestOrdering, "dineIn" | "pickup" | "hours" | "maxItems" | "maxOrderCents" | "requireOpenTable"> | null;
  /** The points programme, when it is on. */
  loyalty?: Omit<ApiLoyalty, "enabled"> | null;
  /** Guests can book a table online; absent from an older server. */
  reservations?: boolean;
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

/**
 * What the live channel (/ws) says: a signal, never data (shared/live.mjs).
 * `connected` comes first on every (re)connection — a cue to fetch, since
 * anything may have changed while the socket was away.
 */
/** A print bridge in the restaurant, as it last checked in. */
export interface ApiPrintBridge { id: string; name: string; version: string; lastSeenAt: string }
/** A printer a bridge found on the shop's network, not set up yet; `escpos` when it answers like a receipt printer. */
export interface ApiDiscoveredPrinter { address: string; port: number; escpos: boolean; bridgeId: string; seenAt: string }
/** Tickets not printed yet, and those given up on. */
export interface ApiPrintQueue { waiting: number; failed: number }

export interface RealtimeEnvelope {
  type: "connected" | "catalog.changed" | "floor.changed" | "print.queued";
  table?: string;
  at: string;
}

/** Mail (shared/mail.mjs): whether it goes out, how, and from whom. */
export interface ApiMailStatus { configured: boolean; provider: "brevo" | "outbox" | null; sender: string | null }

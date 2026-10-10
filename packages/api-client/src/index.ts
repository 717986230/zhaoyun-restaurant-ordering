import type { ApiMailStatus, ApiMemberVisit, ApiAppIcons, ApiToday, AppIconFiles, IconApp,
  ApiBill, ApiCatalogProduct, ApiMenuSettings, ApiDiscoveredPrinter, ApiOrder, ApiPrintBridge, ApiPrintJob, ApiPrintQueue, ApiServiceRequest, ApiSettings, CreateOrderCommand,
  CreateServiceRequestCommand, MenuLanguage, MenuThemeId, PrintJobStatus, RealtimeEnvelope, VatPercent,
  ApiReceipt, CheckoutCommand, ApiVoucher, ApiClosingTotals, ApiClosing, ApiSalesReport, ApiJournalExport, PosStaff, PosStaffActivity, PosVoid, PosDevice, PosClaim, PosSettlement, PosDrawer, PosDrawerMovement, DrawerCloseCommand,
  AccountSession, AccountUpdateCommand, ApiAccount, RegisterCommand,
  ApiCustomer, ApiGuestOrdering, CustomerDataExport, ApiLoyalty, ApiPointsEntry, ApiTableSession, CustomerRegisterCommand, CustomerSession, CustomerUpdateCommand, GuestOrderCommand,
  ApiDeliveryOrder, ApiDeliveryPlatform, ApiDeliveryTotals, DeliveryProvider, DeliveryRejectReason, DeliveryStatus,
  ApiBookingInfo, ApiGuestReservation, ApiReservation, ApiReservationSettings, ApiReservationSlot, ApiTableChoice, ReservationCommand, ReservationUpdateCommand, StaffReservationCommand
} from "@zhaoyun/contracts";
import type { BundleItem, ModifierGroup, PrinterProfile, Product } from "@zhaoyun/domain";
import { DEFAULT_FEATURED_TEMPLATE, DEFAULT_MENU_LANGUAGES, DEFAULT_MENU_THEME } from "@zhaoyun/domain";

/**
 * A product as the server sends it, as the apps work with it. One function
 * for both apps: the admin console kept a copy that dropped `bundleItems`,
 * so a set opened for editing looked empty and saving it emptied it.
 */
export function toProduct(product: ApiCatalogProduct): Product {
  return {
    id: String(product.id),
    sku: product.sku,
    kind: product.kind,
    category: product.category,
    names: product.names,
    description: product.description,
    priceCents: Math.round(product.price * 100),
    vatPercent: product.vatPercent ?? (product.kind === "drink" ? 20 : 10),
    allergens: product.allergens,
    details: product.details,
    appearance: product.appearance,
    modifiers: product.modifiers ?? [],
    bundleItems: product.bundleItems ?? [],
    media: (product.media ?? []).map((media) => ({ ...media })),
    available: product.available ?? true,
    published: product.published ?? true,
    printStation: product.printStation ?? (product.kind === "drink" ? "bar" : product.kind === "sushi" ? "sushi" : "kitchen"),
    dailyLimit: product.dailyLimit ?? null,
    leftToday: product.leftToday ?? null
  };
}

/**
 * Settings as the console works with them: every field there, whatever the
 * server sent. A console is deployed a moment before or after its server,
 * and one newer than the server it talks to would otherwise meet a setting
 * the server has never heard of as `undefined` — and a settings page that
 * lists it would not render. The defaults are the servers' own
 * (shared/settings.mjs, APP_SETTINGS).
 */
export function withSettingDefaults(settings: Partial<ApiSettings>): ApiSettings {
  return {
    menuTheme: DEFAULT_MENU_THEME,
    menuLanguages: [...DEFAULT_MENU_LANGUAGES],
    restaurantName: "",
    menuTitle: "La Carte",
    menuDefaultScheme: "dark",
    showTableNumber: true,
    showOrdering: false,
    featuredEnabled: false,
    featuredTitle: "",
    featuredProductIds: [],
    cartSuggestions: { enabled: true, productIds: [] },
    featuredTemplate: DEFAULT_FEATURED_TEMPLATE,
    timeZone: "Europe/Vienna",
    featuredSchedule: null,
    setsSchedule: null,
    navPinned: [],
    navLabels: {},
    reviewUrl: "",
    companyName: "",
    companyAddress: "",
    companyUid: "",
    cashRegisterId: "KASSE-1",
    takeawayDiscountPercent: 0,
    floorTables: 20,
    customerAccounts: false,
    guestOrdering: { ...GUEST_ORDERING_DEFAULTS, hours: [] },
    loyalty: { ...LOYALTY_DEFAULTS, rewards: [] },
    reservations: { ...RESERVATION_DEFAULTS, hours: RESERVATION_DEFAULTS.hours.map((range) => ({ ...range, days: [...range.days] })), closedDates: [], tables: [] },
    delivery: { lieferando: { ...DELIVERY_PLATFORM_DEFAULTS }, foodora: { ...DELIVERY_PLATFORM_DEFAULTS } },
    ...Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined))
  } as ApiSettings;
}

/** The servers' own defaults (shared/ordering.mjs, shared/customer.mjs). */
export const GUEST_ORDERING_DEFAULTS: ApiGuestOrdering = {
  enabled: false, dineIn: true, pickup: false, hours: [], requireOpenTable: true, tableSessionHours: 4,
  maxItems: 30, maxOrderCents: 30_000, minIntervalSeconds: 60, maxOpenPickups: 2
};
export const LOYALTY_DEFAULTS: ApiLoyalty = { enabled: false, pointsPerEuro: 1, rewards: [], maxRewardsPerOrder: 1 };
/** shared/reservations.mjs, RESERVATION_DEFAULTS. */
export const RESERVATION_DEFAULTS: ApiReservationSettings = {
  enabled: false,
  hours: [{ days: [1, 2, 3, 4, 5, 6, 7], from: "11:30", to: "14:00" }, { days: [1, 2, 3, 4, 5, 6, 7], from: "17:30", to: "21:00" }],
  intervalMinutes: 30, durationMinutes: 120, capacity: 40, maxParty: 8, leadMinutes: 60, daysAhead: 60, autoConfirm: true, closedDates: [], note: "", tables: [],
  maxActivePerGuest: 2, maxPerDayPerGuest: 1, noShowLimit: 2,
  minPoints: 0, welcomePoints: 0, signupPoints: 20, bookingPoints: 5, noShowPoints: 5, noShowAfterMinutes: 30
};

/** shared/delivery.mjs, DELIVERY_SETTING_DEFAULTS (the same for each platform). */
export const DELIVERY_PLATFORM_DEFAULTS = { enabled: false, autoAccept: false, prepMinutes: 20, storeId: "" };

/** The delivery platforms' orders over some days, and what each brought in. */
export interface DeliveryList { from: string; to: string; totals: ApiDeliveryTotals[]; orders: ApiDeliveryOrder[] }
/** What the floor does with a platform's order; resend tells the platform the last step again. */
export type DeliveryAction = "accept" | "reject" | "ready" | "complete" | "resend";

/** The floor's list of bookings over some days. */
export interface ReservationList { reservations: ApiReservation[]; today: string; from: string; to: string; capacity: number; durationMinutes: number }

/** A guest in the console's list, and their points' history. */
export interface CustomerDetail { customer: ApiCustomer; points: ApiPointsEntry[] }

export interface RestaurantApiOptions {
  baseUrl: () => string;
  /** Extra headers evaluated per request, e.g. the current table token. */
  headers?: () => Record<string, string>;
  /** Query parameters for the realtime socket, e.g. the table it subscribes to. */
  socketParams?: () => Record<string, string>;
  fetch?: typeof globalThis.fetch;
}

export interface AdminProductInput {
  sku: string;
  kind: "food" | "drink" | "sushi";
  category: string;
  names: { zh: string; de: string; en: string };
  description: string;
  price: number;
  details: { ingredients: string; time: string; people: string; level: string };
  allergens: string[];
  vatPercent?: VatPercent;
  printStation: "kitchen" | "bar" | "sushi" | "front";
  available: boolean;
  published: boolean;
  modifiers?: ModifierGroup[];
  bundleItems?: BundleItem[];
}

export type StaffRole = "manager" | "staff" | "kitchen";

export interface AuditEntry {
  id: string;
  at: string;
  role: StaffRole;
  ip: string;
  method: string;
  route: string;
  status: number;
  detail: Record<string, unknown>;
}

export interface RestaurantTable {
  table: string;
  label: string;
  token: string;
  enabled: boolean;
  /** Service state: a locked table refuses new orders until it is settled. */
  locked: boolean;
  lockedAt: string | null;
}

/**
 * One table as the floor sees it. No entry token: that is the manager's, and
 * this is served to every staff role.
 */
export interface TableOverview {
  table: string;
  label: string;
  enabled: boolean;
  locked: boolean;
  lockedAt: string | null;
  registered: boolean;
  state: "free" | "seated" | "locked";
  orders: ApiOrder[];
  total: number;
  since: string | null;
  /** Open on a POS right now, and by whom. */
  openOn?: { staffId: string | null; staffName: string | null } | null;
  /** Open for its guests to order from their phones (开台), until then; null when not. */
  orderingUntil?: string | null;
}

export interface AdminStorage {
  baseUrl: string;
  token: string;
}

export class ApiError extends Error {
  readonly status: number;
  /** What the refusal was, when the server says (a guest's order, a guest's account). */
  readonly code: string | undefined;
  /** For a pause (429): how many seconds. */
  readonly retryAfter: number | undefined;
  /** The whole refusal as the server wrote it: a dish sold out says which (`sku`) and how many are left (`left`). */
  readonly details: Record<string, unknown>;

  constructor(message: string, status: number, code?: string, retryAfter?: number, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.details = details;
  }
}

/**
 * Reads a response that is supposed to be this API answering.
 *
 * A body that does not parse as JSON is not an answer from this API, whatever
 * status it arrives with: a hotel router's login page, a proxy's error page and
 * a dev server's `index.html` are all served as 200 text/html. Treating those
 * as an empty object produced a call that looked successful and whose every
 * field was `undefined`, which the console then rendered — and a list that is
 * `undefined` rather than empty takes the whole screen down.
 *
 * The restaurant's network is exactly where this happens, so it fails as a
 * request failure and the callers' existing error handling takes it from there.
 */
async function parseJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.text();
  let payload: { error?: string; code?: string } = {};
  if (body) {
    try {
      payload = JSON.parse(body) as { error?: string; code?: string };
    } catch {
      throw new ApiError(`Request failed (${response.status})`, response.status);
    }
  }
  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after")) || undefined;
    throw new ApiError(payload.error || `Request failed (${response.status})`, response.status, payload.code, retryAfter, payload as Record<string, unknown>);
  }
  return payload as T;
}

/**
 * A socket on the live channel (/ws) that keeps itself open: it reconnects
 * with a growing pause (1 s up to 30 s) and says whether it is open, so a
 * screen can poll more often while it is not. Returns the way to close it.
 */
export function openLive(
  baseUrl: string,
  query: Record<string, string>,
  onEvent: (event: RealtimeEnvelope) => void,
  onStatus?: (open: boolean) => void
): () => void {
  const base = baseUrl.replace(/^http/, "ws");
  if (!/^wss?:\/\//.test(base) || typeof WebSocket === "undefined") return () => undefined;
  const search = new URLSearchParams(query).toString();
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let pause = 1000;
  let stopped = false;
  const open = () => {
    socket = new WebSocket(`${base}/ws${search ? `?${search}` : ""}`);
    socket.addEventListener("open", () => { pause = 1000; onStatus?.(true); });
    socket.addEventListener("message", (event) => {
      try { onEvent(JSON.parse(String(event.data)) as RealtimeEnvelope); } catch { /* Not an event. */ }
    });
    socket.addEventListener("close", () => {
      onStatus?.(false);
      if (stopped) return;
      retry = setTimeout(open, pause);
      pause = Math.min(pause * 2, 30_000);
    });
  };
  open();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    socket?.close();
  };
}

export class AdminApi {
  get storage(): AdminStorage {
    const built = import.meta.env?.VITE_API_BASE?.replace(/\/+$/, "");
    const fallback = location.port === "5173" ? "http://127.0.0.1:8787" : built || location.origin;
    return {
      baseUrl: localStorage.getItem("zy_api_base") || fallback,
      token: sessionStorage.getItem("zy_admin_token") || ""
    };
  }

  configure(storage: AdminStorage): void {
    localStorage.setItem("zy_api_base", storage.baseUrl.replace(/\/+$/, ""));
    sessionStorage.setItem("zy_admin_token", storage.token);
    // The table this device orders for is not set from here. The customer app
    // owns it, validates the format and holds the matching table token; a second
    // writer to the same key would only produce a table the server refuses.
  }

  /** The session token replaces the one in the header for every later call;
   *  it is the same header, so nothing else about this client changes. */
  remember(token: string): void {
    sessionStorage.setItem("zy_admin_token", token);
  }

  forget(): void {
    sessionStorage.removeItem("zy_admin_token");
  }

  /** Open on purpose: one bit, which the console needs to choose between
   *  registering the restaurant's account and signing in to it. */
  accountStatus(): Promise<{ registered: boolean }> { return this.#request("/api/account"); }
  register(command: RegisterCommand): Promise<AccountSession> {
    return this.#request("/api/account/register", { method: "POST", body: JSON.stringify(command) });
  }
  signIn(login: string, password: string): Promise<AccountSession> {
    return this.#request("/api/account/sign-in", { method: "POST", body: JSON.stringify({ login, password }) });
  }
  /** A new password ends every session and answers with a fresh one for this device. */
  updateAccount(command: AccountUpdateCommand): Promise<{ account: ApiAccount; token?: string; expiresInMs?: number }> {
    return this.#request("/api/account", { method: "PUT", body: JSON.stringify(command) });
  }
  signOut(): Promise<void> { return this.#request("/api/account/sign-out", { method: "POST" }); }
  /** With ADMIN_TOKEN in the header: a forgotten password set anew (and the account name, if given). */
  recoverAccount(command: { login?: string; password: string }): Promise<{ account: ApiAccount }> {
    return this.#request("/api/account/recover", { method: "POST", body: JSON.stringify(command) });
  }

  mediaUrl(path: string): string { return `${this.storage.baseUrl}${path}`; }
  health(): Promise<{ ok: boolean }> { return this.#request("/api/health"); }
  /** Whether the guests' email codes go out, and a test email to the owner (shared/mail.mjs). */
  mailStatus(): Promise<ApiMailStatus> { return this.#request("/api/admin/mail"); }
  sendTestMail(to: string, language?: string): Promise<{ sent: boolean }> { return this.#request("/api/admin/mail/test", { method: "POST", body: JSON.stringify({ to, ...(language ? { language } : {}) }) }); }
  products(): Promise<{ products: ApiCatalogProduct[] }> { return this.#request("/api/admin/products"); }
  createProduct(product: AdminProductInput): Promise<{ product: ApiCatalogProduct }> { return this.#request("/api/admin/products", { method: "POST", body: JSON.stringify(product) }); }
  updateProduct(id: string, product: AdminProductInput): Promise<{ product: ApiCatalogProduct }> { return this.#request(`/api/admin/products/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(product) }); }
  deleteProduct(id: string): Promise<void> { return this.#request(`/api/admin/products/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  /** 每日限量: a dish's portions each day, today's, or both; null for no limit. */
  setProductStock(id: string, stock: { dailyLimit?: number | null; leftToday?: number | null }): Promise<{ product: ApiCatalogProduct }> {
    return this.#request(`/api/admin/products/${encodeURIComponent(id)}/stock`, { method: "PUT", body: JSON.stringify(stock) });
  }
  /** A new, unpublished copy of a dish, photos and all. */
  duplicateProduct(id: string): Promise<{ product: ApiCatalogProduct }> { return this.#request(`/api/admin/products/${encodeURIComponent(id)}/duplicate`, { method: "POST" }); }
  /** Moves every dish of one category to another, new or existing, and
   *  carries the category's tab settings along. */
  renameCategory(from: string, to: string): Promise<{ renamed: number; category: string; settings: ApiSettings }> { return this.#request("/api/admin/categories/rename", { method: "POST", body: JSON.stringify({ from, to }) }); }
  /** Every dish of a category at one VAT rate; set menus keep their split. */
  setCategoryVat(category: string, vatPercent: VatPercent): Promise<{ updated: number; category: string; vatPercent: VatPercent }> { return this.#request("/api/admin/categories/vat", { method: "POST", body: JSON.stringify({ category, vatPercent }) }); }
  session(): Promise<{ role: StaffRole; account?: ApiAccount }> { return this.#request("/api/admin/session"); }
  audit(limit = 100): Promise<{ entries: AuditEntry[] }> { return this.#request(`/api/admin/audit?limit=${limit}`); }
  orders(limit = 100): Promise<{ orders: ApiOrder[] }> { return this.#request(`/api/orders?limit=${limit}`); }
  updateOrderStatus(id: string, status: ApiOrder["status"]): Promise<{ order: ApiOrder }> { return this.#request(`/api/orders/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); }
  serviceRequests(limit = 100): Promise<{ requests: ApiServiceRequest[] }> { return this.#request(`/api/service-requests?limit=${limit}`); }
  updateServiceRequestStatus(id: string, status: ApiServiceRequest["status"]): Promise<{ request: ApiServiceRequest }> { return this.#request(`/api/service-requests/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); }
  printJobs(status: PrintJobStatus = "failed", limit = 50): Promise<{ jobs: ApiPrintJob[] }> { return this.#request(`/api/admin/print-jobs?status=${status}&limit=${limit}`); }
  bill(table: string): Promise<{ bill: ApiBill }> { return this.#request(`/api/admin/tables/${encodeURIComponent(table)}/bill`); }
  // The POS's waiters and devices, kept by the manager.
  staffList(): Promise<{ staff: PosStaff[] }> { return this.#request("/api/admin/staff"); }
  saveStaff(input: { name?: string; role?: PosStaff["role"]; pin?: string; active?: boolean }, id?: string): Promise<{ staff: PosStaff }> {
    return this.#request(id ? `/api/admin/staff/${encodeURIComponent(id)}` : "/api/admin/staff", { method: id ? "PUT" : "POST", body: JSON.stringify(input) });
  }
  /** Each waiter now: signed in where, which tables open, the shift so far. */
  staffActivity(): Promise<{ staff: PosStaffActivity[] }> { return this.#request("/api/admin/staff/activity"); }
  posDevices(): Promise<{ devices: PosDevice[] }> { return this.#request("/api/admin/pos-devices"); }
  unpairDevice(id: string): Promise<void> { return this.#request(`/api/admin/pos-devices/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  /** An interim bill on the front printer; it marks nothing paid. */
  printBill(table: string): Promise<{ bill: ApiBill }> { return this.#request(`/api/admin/tables/${encodeURIComponent(table)}/bill/print`, { method: "POST" }); }
  tables(): Promise<{ tables: RestaurantTable[] }> { return this.#request("/api/admin/tables"); }
  openTables(): Promise<{ tables: string[] }> { return this.#request("/api/admin/tables/open"); }
  tableOverview(): Promise<{ tables: TableOverview[] }> { return this.#request("/api/admin/tables/overview"); }
  setTableLock(table: string, locked: boolean): Promise<{ table: RestaurantTable }> {
    return this.#request(`/api/admin/tables/${encodeURIComponent(table)}/lock`, { method: "POST", body: JSON.stringify({ locked }) });
  }
  /** Tables 1 to count set up at once, each with its own code; those already there keep theirs. */
  registerNumberedTables(count: number): Promise<{ tables: RestaurantTable[]; created: number }> { return this.#request("/api/admin/tables/numbered", { method: "POST", body: JSON.stringify({ count }) }); }
  saveTable(input: { table: string; label?: string; enabled?: boolean; rotateToken?: boolean }): Promise<{ table: RestaurantTable }> { return this.#request("/api/admin/tables", { method: "POST", body: JSON.stringify(input) }); }
  /** Another number or label for a table; its card keeps the same code. */
  renameTable(table: string, input: { table?: string; label?: string }): Promise<{ table: RestaurantTable }> {
    return this.#request(`/api/admin/tables/${encodeURIComponent(table)}`, { method: "PATCH", body: JSON.stringify(input) });
  }
  deleteTable(table: string): Promise<void> { return this.#request(`/api/admin/tables/${encodeURIComponent(table)}`, { method: "DELETE" }); }
  printers(): Promise<{ printers: PrinterProfile[]; bridges?: ApiPrintBridge[]; queue?: ApiPrintQueue; discovered?: ApiDiscoveredPrinter[] }> { return this.#request("/api/admin/printers"); }
  deletePrinter(id: string): Promise<void> { return this.#request(`/api/admin/printers/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  /** A test page through the print bridge, on that printer. */
  testPrinter(id: string): Promise<{ jobId: string }> { return this.#request(`/api/admin/printers/${encodeURIComponent(id)}/test`, { method: "POST" }); }
  /** Pairs a print bridge like a POS device; its token is shown once. */
  pairDevice(name: string): Promise<{ device: PosDevice; token: string }> { return this.#request("/api/admin/pos-devices", { method: "POST", body: JSON.stringify({ name }) }); }
  createPrinter(profile: Omit<PrinterProfile, "id">): Promise<{ printer: PrinterProfile }> { return this.#request("/api/admin/printers", { method: "POST", body: JSON.stringify(profile) }); }
  updatePrinter(id: string, profile: Omit<PrinterProfile, "id">): Promise<{ printer: PrinterProfile }> { return this.#request(`/api/admin/printers/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(profile) }); }
  retryPrintJob(id: string): Promise<{ ok: boolean; id: string }> { return this.#request(`/api/admin/print-jobs/${encodeURIComponent(id)}/retry`, { method: "POST" }); }
  settings(): Promise<ApiSettings> { return this.#request<Partial<ApiSettings>>("/api/admin/settings").then(withSettingDefaults); }
  /** Either setting may be saved alone; the one left out keeps its value. */
  updateSettings(settings: Partial<ApiSettings>): Promise<ApiSettings> { return this.#request<Partial<ApiSettings>>("/api/admin/settings", { method: "PUT", body: JSON.stringify(settings) }).then(withSettingDefaults); }

  /** Open a table for its guests' phones (开台), or close it. */
  setTableOrdering(table: string, open: boolean): Promise<{ session: ApiTableSession | null }> {
    return this.#request(`/api/admin/tables/${encodeURIComponent(table)}/ordering`, { method: "POST", body: JSON.stringify({ open }) });
  }
  // Guests' accounts, the manager's side.
  customers(query = "", limit = 50): Promise<{ customers: ApiCustomer[] }> { return this.#request(`/api/admin/customers?q=${encodeURIComponent(query)}&limit=${limit}`); }
  customer(id: string): Promise<CustomerDetail> { return this.#request(`/api/admin/customers/${encodeURIComponent(id)}`); }
  /** Points changed by hand, always with a reason; the balance never goes below zero. */
  adjustPoints(id: string, delta: number, note: string): Promise<{ customer: ApiCustomer }> {
    return this.#request(`/api/admin/customers/${encodeURIComponent(id)}/points`, { method: "POST", body: JSON.stringify({ delta, note }) });
  }
  /** A new password for a guest who forgot theirs; their sessions end. */
  resetCustomerPassword(id: string, password: string): Promise<{ customer: ApiCustomer }> {
    return this.#request(`/api/admin/customers/${encodeURIComponent(id)}/password`, { method: "POST", body: JSON.stringify({ password }) });
  }
  deleteCustomer(id: string): Promise<void> { return this.#request(`/api/admin/customers/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  /** Sales from `from` to `to` (YYYY-MM-DD, both included, the restaurant's days). */
  /** 今日概况: today's sales, best sellers, seated tables and bookings. */
  today(): Promise<{ today: ApiToday }> { return this.#request("/api/admin/today"); }
  salesReport(from: string, to: string): Promise<{ report: ApiSalesReport }> {
    return this.#request(`/api/admin/reports/sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  }
  /** A guest's data, for a request that reached the restaurant by e-mail or at the counter. */
  exportCustomer(id: string): Promise<CustomerDataExport> { return this.#request(`/api/admin/customers/${encodeURIComponent(id)}/export`); }
  // Table bookings: the floor's list, one taken by phone, a change, an erasure.
  /** Bookings from `from` to `to`; `q` finds one by number, name, phone or email; `status` one status or "active". */
  reservations(from = "", to = "", filter: { q?: string; status?: string } = {}): Promise<ReservationList> {
    return this.#request(`/api/admin/reservations?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&q=${encodeURIComponent(filter.q ?? "")}&status=${encodeURIComponent(filter.status ?? "")}`);
  }
  createReservation(command: StaffReservationCommand): Promise<{ reservation: ApiReservation }> {
    return this.#request("/api/admin/reservations", { method: "POST", body: JSON.stringify(command) });
  }
  updateReservation(id: string, command: ReservationUpdateCommand): Promise<{ reservation: ApiReservation }> {
    return this.#request(`/api/admin/reservations/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(command) });
  }
  deleteReservation(id: string): Promise<void> { return this.#request(`/api/admin/reservations/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  deliveryOrders(from: string, to: string, filter: { provider?: DeliveryProvider | ""; status?: DeliveryStatus | "" } = {}): Promise<DeliveryList> {
    return this.#request(`/api/admin/delivery/orders?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&provider=${encodeURIComponent(filter.provider ?? "")}&status=${encodeURIComponent(filter.status ?? "")}`);
  }
  deliveryAction(id: string, action: DeliveryAction, options: { prepMinutes?: number; reason?: DeliveryRejectReason } = {}): Promise<{ order: ApiDeliveryOrder }> {
    return this.#request(`/api/admin/delivery/orders/${encodeURIComponent(id)}/${action}`, { method: "POST", body: JSON.stringify(options) });
  }
  deliveryPlatforms(): Promise<{ providers: ApiDeliveryPlatform[] }> { return this.#request("/api/admin/delivery/status"); }
  /** What the kitchen cooks from the platforms, soonest due first (the kitchen screen may read it too). */
  deliveryKitchen(): Promise<{ orders: ApiDeliveryOrder[] }> { return this.#request("/api/admin/delivery/kitchen"); }
  /** A made-up order in the platform's own shape, through the whole path; a test order counts for nothing. */
  deliveryTestOrder(provider: DeliveryProvider): Promise<{ order: ApiDeliveryOrder }> {
    return this.#request(`/api/admin/delivery/test/${provider}`, { method: "POST" });
  }

  /** The console's live channel: every change on the floor and in the menu. */
  live(onEvent: (event: RealtimeEnvelope) => void, onStatus?: (open: boolean) => void): () => void {
    return openLive(this.storage.baseUrl, { role: "staff" }, onEvent, onStatus);
  }

  /** The installed apps' icons: the owner's own, or null for the built one. */
  appIcons(): Promise<{ icons: ApiAppIcons }> { return this.#request("/api/admin/app-icons"); }
  saveAppIcon(app: IconApp, files: AppIconFiles): Promise<{ icons: ApiAppIcons }> {
    const form = new FormData();
    for (const [field, blob] of Object.entries(files)) form.append(field, blob, `${field}.png`);
    return this.#request(`/api/admin/app-icons/${app}`, { method: "PUT", body: form });
  }
  resetAppIcon(app: IconApp): Promise<{ icons: ApiAppIcons }> { return this.#request(`/api/admin/app-icons/${app}`, { method: "DELETE" }); }

  async uploadMedia(id: string, file: File): Promise<{ product: ApiCatalogProduct }> {
    const form = new FormData();
    form.append("file", file);
    return this.#request(`/api/admin/products/${encodeURIComponent(id)}/media`, { method: "POST", body: form });
  }

  async #request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set("x-admin-token", this.storage.token);
    if (options.body && !(options.body instanceof FormData)) headers.set("content-type", "application/json");
    const response = await fetch(`${this.storage.baseUrl}${path}`, { ...options, headers });
    if (response.status === 204) return undefined as T;
    return parseJsonResponse<T>(response);
  }
}

/**
 * The POS (apps/pos-web). A device is paired once with the manager's password
 * and keeps its device token; a waiter signs in on it with a PIN for a session
 * token. Both travel with every call: the device token says where, the
 * session token who.
 */
export class PosApi {
  get baseUrl(): string {
    const built = import.meta.env?.VITE_API_BASE?.replace(/\/+$/, "");
    const fallback = location.port === "5173" ? "http://127.0.0.1:8787" : built || location.origin;
    return localStorage.getItem("zy_api_base") || fallback;
  }
  get deviceToken(): string { return localStorage.getItem("zy_pos_device") || ""; }
  get session(): { token: string; staff: PosStaff } | null {
    try { return JSON.parse(localStorage.getItem("zy_pos_session") || "null"); } catch { return null; }
  }

  async #request<T>(path: string, options: RequestInit = {}, token = this.session?.token ?? ""): Promise<T> {
    const headers = new Headers(options.headers);
    if (options.body) headers.set("content-type", "application/json");
    if (token) headers.set("x-admin-token", token);
    if (this.deviceToken) headers.set("x-device-token", this.deviceToken);
    const response = await fetch(`${this.baseUrl}${path}`, { ...options, headers });
    if (response.status === 204) return undefined as T;
    return parseJsonResponse<T>(response);
  }

  /** Pairs this device, with the manager's password: done once per device. */
  async pair(baseUrl: string, login: string, password: string, name: string): Promise<PosDevice> {
    if (baseUrl) localStorage.setItem("zy_api_base", baseUrl.replace(/\/+$/, ""));
    const { token: account } = await this.#request<AccountSession>("/api/account/sign-in", { method: "POST", body: JSON.stringify({ login, password }) }, "");
    try {
      const { device, token } = await this.#request<{ device: PosDevice; token: string }>("/api/admin/pos-devices", { method: "POST", body: JSON.stringify({ name }) }, account);
      localStorage.setItem("zy_pos_device", token);
      return device;
    } finally {
      // The account's session was for pairing only; the device keeps its own token.
      await this.#request("/api/account/sign-out", { method: "POST" }, account).catch(() => undefined);
    }
  }
  unpair(): void {
    localStorage.removeItem("zy_pos_device");
    localStorage.removeItem("zy_pos_session");
  }

  staff(): Promise<{ staff: PosStaff[] }> { return this.#request("/api/pos/staff", {}, ""); }
  async signIn(staffId: string, pin: string): Promise<PosStaff> {
    const { token, staff } = await this.#request<{ token: string; staff: PosStaff }>("/api/pos/sign-in", { method: "POST", body: JSON.stringify({ staffId, pin }) }, "");
    localStorage.setItem("zy_pos_session", JSON.stringify({ token, staff }));
    return staff;
  }
  async signOut(): Promise<void> {
    try { await this.#request("/api/pos/sign-out", { method: "POST" }); } finally { localStorage.removeItem("zy_pos_session"); }
  }

  /** Every published dish, the sold-out ones too (marked), so they can be switched back on. */
  catalog(): Promise<{ products: ApiCatalogProduct[] }> { return this.#request("/api/pos/catalog"); }
  /** 每日限量: a dish's portions each day, today's, or both; null for no limit. */
  setStock(productId: string, stock: { dailyLimit?: number | null; leftToday?: number | null }): Promise<{ product: ApiCatalogProduct }> {
    return this.#request(`/api/pos/products/${encodeURIComponent(productId)}/stock`, { method: "PUT", body: JSON.stringify(stock) });
  }
  /** 沽清: sold out, or back on. The guests' menus follow at once. */
  setAvailable(productId: string, available: boolean): Promise<{ product: ApiCatalogProduct }> {
    return this.#request(`/api/pos/products/${encodeURIComponent(productId)}/availability`, { method: "PUT", body: JSON.stringify({ available }) });
  }
  /** 退菜: dishes sent to the kitchen taken off the bill, with a reason; the kitchen gets a void ticket. */
  voidItem(table: string, orderItemId: string, quantity: number, reason: string): Promise<{ void: PosVoid }> {
    return this.#request(`/api/pos/tables/${encodeURIComponent(table)}/void`, { method: "POST", body: JSON.stringify({ orderItemId, quantity, reason }) });
  }
  floor(): Promise<{ tables: TableOverview[]; claims: PosClaim[]; deviceId: string; requests?: ApiServiceRequest[]; reservations?: ApiReservation[]; delivery?: ApiDeliveryOrder[]; takeawayDiscountPercent: number }> { return this.#request("/api/pos/floor"); }
  deliveryAction(id: string, action: DeliveryAction, options: { prepMinutes?: number; reason?: DeliveryRejectReason } = {}): Promise<{ order: ApiDeliveryOrder }> {
    return this.#request(`/api/admin/delivery/orders/${encodeURIComponent(id)}/${action}`, { method: "POST", body: JSON.stringify(options) });
  }
  /** A booking seated, finished or marked as never come, or given its table. */
  updateReservation(id: string, command: ReservationUpdateCommand): Promise<{ reservation: ApiReservation }> {
    return this.#request(`/api/admin/reservations/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(command) });
  }
  /** A member's code scanned at the counter: their first visit's bonus, if they never had it. */
  memberVisit(customerId: string): Promise<ApiMemberVisit> {
    return this.#request(`/api/admin/members/${encodeURIComponent(customerId)}/visit`, { method: "POST", body: "{}" });
  }
  /** The tickets the print bridge gave up on, for the waiter to see and send again. */
  /** A guest's call dealt with: off every waiter's floor. */
  finishServiceRequest(id: string): Promise<{ request: ApiServiceRequest }> {
    return this.#request(`/api/service-requests/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify({ status: "completed" }) });
  }
  failedPrints(): Promise<{ jobs: ApiPrintJob[] }> { return this.#request("/api/admin/print-jobs?status=failed&limit=20"); }
  retryPrint(id: string): Promise<{ ok: boolean; id: string }> { return this.#request(`/api/admin/print-jobs/${encodeURIComponent(id)}/retry`, { method: "POST" }); }
  /** The POS's live channel: every change on the floor, whoever made it. */
  live(onEvent: (event: RealtimeEnvelope) => void, onStatus?: (open: boolean) => void): () => void {
    return openLive(this.baseUrl, { role: "staff" }, onEvent, onStatus);
  }
  /** Open a table for its guests' phones (开台), or close it. */
  setTableOrdering(table: string, open: boolean): Promise<{ session: ApiTableSession | null }> {
    return this.#request(`/api/admin/tables/${encodeURIComponent(table)}/ordering`, { method: "POST", body: JSON.stringify({ open }) });
  }
  claim(table: string): Promise<{ claim: PosClaim }> { return this.#request(`/api/pos/tables/${encodeURIComponent(table)}/claim`, { method: "POST" }); }
  release(table: string, force = false): Promise<void> { return this.#request(`/api/pos/tables/${encodeURIComponent(table)}/claim${force ? "?force=1" : ""}`, { method: "DELETE" }); }
  order(command: CreateOrderCommand): Promise<{ order: ApiOrder }> { return this.#request("/api/pos/orders", { method: "POST", body: JSON.stringify(command) }); }
  takeaway(): Promise<{ table: string; pickupNo: number; claim: PosClaim }> { return this.#request("/api/pos/takeaway", { method: "POST" }); }
  move(from: string, to: string): Promise<{ from: string; to: string; moved: number }> { return this.#request(`/api/pos/tables/${encodeURIComponent(from)}/move`, { method: "POST", body: JSON.stringify({ to }) }); }
  bill(table: string): Promise<{ bill: ApiBill }> { return this.#request(`/api/admin/tables/${encodeURIComponent(table)}/bill`); }
  printBill(table: string): Promise<{ bill: ApiBill }> { return this.#request(`/api/admin/tables/${encodeURIComponent(table)}/bill/print`, { method: "POST" }); }
  checkout(command: CheckoutCommand): Promise<{ receipt: ApiReceipt }> { return this.#request("/api/admin/checkout", { method: "POST", body: JSON.stringify(command) }); }
  receipts(limit = 50): Promise<{ receipts: ApiReceipt[] }> { return this.#request(`/api/admin/receipts?limit=${limit}`); }
  stornoReceipt(id: string, reason: string): Promise<{ receipt: ApiReceipt }> { return this.#request(`/api/admin/receipts/${encodeURIComponent(id)}/storno`, { method: "POST", body: JSON.stringify({ reason }) }); }
  /** The receipt on the front printer again, marked as a copy (Belegkopie). */
  reprintReceipt(id: string): Promise<void> { return this.#request(`/api/admin/receipts/${encodeURIComponent(id)}/print`, { method: "POST" }); }
  voucher(code: string): Promise<{ voucher: ApiVoucher }> { return this.#request(`/api/admin/vouchers/${encodeURIComponent(code)}`); }
  settlement(staffId?: string): Promise<{ totals: PosSettlement["totals"] }> { return this.#request(`/api/pos/settlement${staffId ? `?staffId=${encodeURIComponent(staffId)}` : ""}`); }
  settle(staffId?: string): Promise<{ settlement: PosSettlement }> { return this.#request("/api/pos/settlement", { method: "POST", body: JSON.stringify(staffId ? { staffId } : {}) }); }
  drawer(): Promise<{ drawer: PosDrawer | null }> { return this.#request("/api/pos/drawer"); }
  openDrawer(float: number): Promise<{ drawer: PosDrawer }> { return this.#request("/api/pos/drawer/open", { method: "POST", body: JSON.stringify({ float }) }); }
  moveCash(kind: "in" | "out", amount: number, reason: string): Promise<{ movement: PosDrawerMovement }> { return this.#request("/api/pos/drawer/movements", { method: "POST", body: JSON.stringify({ kind, amount, reason }) }); }
  closeDrawer(command: DrawerCloseCommand): Promise<{ drawer: PosDrawer }> { return this.#request("/api/pos/drawer/close", { method: "POST", body: JSON.stringify(command) }); }
  drawers(limit = 20): Promise<{ drawers: PosDrawer[] }> { return this.#request(`/api/pos/drawers?limit=${limit}`); }
  settlements(limit = 30): Promise<{ settlements: PosSettlement[] }> { return this.#request(`/api/pos/settlements?limit=${limit}`); }
  closingPreview(): Promise<{ totals: ApiClosingTotals }> { return this.#request("/api/admin/day-closings/preview"); }
  closeDay(): Promise<{ closing: ApiClosing }> { return this.#request("/api/admin/day-closings", { method: "POST" }); }
  closings(limit = 30): Promise<{ closings: ApiClosing[] }> { return this.#request(`/api/admin/day-closings?limit=${limit}`); }
  journal(from: string, to: string): Promise<ApiJournalExport> { return this.#request(`/api/admin/journal?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`); }
}

export class RestaurantApi {
  readonly #baseUrl: () => string;
  readonly #headers: () => Record<string, string>;
  readonly #socketParams: () => Record<string, string>;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: RestaurantApiOptions) {
    this.#baseUrl = options.baseUrl;
    this.#headers = options.headers ?? (() => ({}));
    this.#socketParams = options.socketParams ?? (() => ({}));
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  mediaUrl(path: string): string {
    return `${this.#baseUrl()}${path}`;
  }

  catalog(): Promise<{ products: ApiCatalogProduct[]; theme?: MenuThemeId; languages?: MenuLanguage[]; menu?: ApiMenuSettings }> {
    return this.#request("/api/catalog");
  }

  createOrder(command: CreateOrderCommand): Promise<{ order: ApiOrder }> {
    return this.#request("/api/orders", { method: "POST", body: JSON.stringify(command) });
  }

  /** A guest's own order: at the table (with its card's token) or for pickup (signed in). */
  placeOrder(command: GuestOrderCommand): Promise<{ order: ApiOrder }> {
    return this.#request("/api/guest/orders", { method: "POST", body: JSON.stringify(command) });
  }

  /** Whether this table may order yet (a waiter opened it), with its card's token. */
  tableOrdering(table: string): Promise<{ table: string; open: boolean }> {
    return this.#request(`/api/guest/tables/${encodeURIComponent(table)}`);
  }

  /** The orders this phone placed, by the ids it made up for them; no account needed. */
  trackOrders(clientRequestIds: string[]): Promise<{ orders: ApiOrder[] }> {
    return this.#request(`/api/guest/orders?ids=${clientRequestIds.map(encodeURIComponent).join(",")}`);
  }

  // A guest's own account: the session token travels in the headers the app gives (x-customer-token).
  registerCustomer(command: CustomerRegisterCommand): Promise<CustomerSession> {
    return this.#request("/api/customer/register", { method: "POST", body: JSON.stringify(command) });
  }
  signInCustomer(email: string, password: string): Promise<CustomerSession> {
    return this.#request("/api/customer/sign-in", { method: "POST", body: JSON.stringify({ email, password }) });
  }
  signOutCustomer(): Promise<void> { return this.#request("/api/customer/sign-out", { method: "POST" }); }
  customer(): Promise<{ customer: ApiCustomer; favorites: string[] }> { return this.#request("/api/customer"); }
  /** A new password answers with a fresh session: every other one has ended. */
  updateCustomer(command: CustomerUpdateCommand): Promise<{ customer: ApiCustomer; token?: string }> {
    return this.#request("/api/customer", { method: "PUT", body: JSON.stringify(command) });
  }
  deleteCustomer(password: string): Promise<void> { return this.#request("/api/customer/delete", { method: "POST", body: JSON.stringify({ password }) }); }
  setFavorite(productId: string, on: boolean): Promise<{ favorites: string[] }> {
    return this.#request(`/api/customer/favorites/${encodeURIComponent(productId)}`, { method: on ? "PUT" : "DELETE" });
  }
  customerPoints(): Promise<{ entries: ApiPointsEntry[] }> { return this.#request("/api/customer/points"); }
  customerOrders(): Promise<{ orders: ApiOrder[] }> { return this.#request("/api/customer/orders"); }
  /** Everything kept about this guest's account, to download. */
  exportCustomerData(): Promise<CustomerDataExport> { return this.#request("/api/customer/export"); }

  /** `repeated` when the same call was already waiting: nothing new was sent. */
  createServiceRequest(command: CreateServiceRequestCommand): Promise<{ request: { id: string }; repeated?: boolean }> {
    return this.#request("/api/service-requests", { method: "POST", body: JSON.stringify(command) });
  }

  // Booking a table. A guest's own booking opens with its id and the token their phone was given.
  bookingInfo(): Promise<{ booking: ApiBookingInfo }> { return this.#request("/api/reservations/availability"); }
  /** The day's times; with `time`, where the guest picks a table, the tables then too. */
  availability(date: string, party: number, time = ""): Promise<{ booking: ApiBookingInfo; date: string; party: number | null; slots: ApiReservationSlot[]; time?: string; tables?: ApiTableChoice[] }> {
    return this.#request(`/api/reservations/availability?date=${encodeURIComponent(date)}&party=${party}${time ? `&time=${encodeURIComponent(time)}` : ""}`);
  }
  book(command: ReservationCommand): Promise<{ reservation: ApiGuestReservation; token: string }> {
    return this.#request("/api/reservations", { method: "POST", body: JSON.stringify(command) });
  }
  reservation(id: string, token: string): Promise<{ reservation: ApiGuestReservation }> {
    return this.#request(`/api/reservations/${encodeURIComponent(id)}`, { headers: { "x-reservation-token": token } });
  }
  /** The signed-in guest's own bookings. */
  myReservations(): Promise<{ reservations: ApiGuestReservation[] }> { return this.#request("/api/customer/reservations"); }
  /** A code to the signed-in guest's email; they type it back to book (shared/email-verify.mjs). */
  requestEmailCode(language?: string): Promise<{ sentTo: string; retryAfter: number }> { return this.#request("/api/customer/email-code", { method: "POST", body: JSON.stringify(language ? { language } : {}) }); }
  verifyEmail(code: string): Promise<{ customer: ApiCustomer }> { return this.#request("/api/customer/email-verify", { method: "POST", body: JSON.stringify({ code }) }); }
  cancelReservation(id: string, token: string): Promise<{ reservation: ApiGuestReservation }> {
    return this.#request(`/api/reservations/${encodeURIComponent(id)}/cancel`, { method: "POST", headers: { "x-reservation-token": token } });
  }

  connect(onMessage: (message: RealtimeEnvelope) => void): () => void {
    return openLive(this.#baseUrl(), this.#socketParams(), onMessage);
  }

  async #request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    if (options.body) headers.set("content-type", "application/json");
    for (const [name, value] of Object.entries(this.#headers())) {
      if (value) headers.set(name, value);
    }
    const response = await this.#fetch(`${this.#baseUrl()}${path}`, { ...options, headers });
    if (response.status === 204) return undefined as T;
    return parseJsonResponse<T>(response);
  }
}

/**
 * Errors on a guest's phone, a waiter's tablet or the console, sent to the
 * server's log (POST /api/client-errors) so they are seen at all: a crash on
 * a phone is otherwise known only to whoever was holding it. A handful per
 * page load at most, the page's path without its query (a table card's code
 * lives there), and never anything typed in.
 */
export function reportClientErrors(app: "menu" | "admin" | "pos", apiBase: () => string): (error: unknown) => void {
  const MAX_REPORTS = 5;
  let sent = 0;
  const seen = new Set<string>();
  const report = (error: unknown) => {
    if (sent >= MAX_REPORTS) return;
    const message = String((error as { message?: unknown })?.message ?? error ?? "").slice(0, 500);
    if (!message || seen.has(message)) return;
    seen.add(message);
    sent += 1;
    const body = JSON.stringify({
      app,
      message,
      stack: String((error as { stack?: unknown })?.stack ?? "").slice(0, 4000),
      path: location.pathname.slice(0, 200)
    });
    try {
      void fetch(`${apiBase()}/api/client-errors`, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
    } catch { /* The report is best effort; the page carries on. */ }
  };
  window.addEventListener("error", (event) => report(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => report(event.reason));
  return report;
}

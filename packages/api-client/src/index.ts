import type {
  ApiBill, ApiCatalogProduct, ApiMenuSettings, ApiOrder, ApiPrintJob, ApiServiceRequest, ApiSettings, CreateOrderCommand,
  CreateServiceRequestCommand, MenuLanguage, MenuThemeId, PrintJobStatus, RealtimeEnvelope, VatPercent,
  ApiReceipt, CheckoutCommand, ApiVoucher, ApiClosingTotals, ApiClosing, ApiJournalExport, PosStaff, PosStaffActivity, PosDevice, PosClaim, PosSettlement,
  AccountSession, AccountUpdateCommand, ApiAccount, RegisterCommand
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
    printStation: product.printStation ?? (product.kind === "drink" ? "bar" : product.kind === "sushi" ? "sushi" : "kitchen")
  };
}

/**
 * Settings as the console works with them: every field there, whatever the
 * server sent. A console is deployed a moment before or after its server,
 * and one newer than the server it talks to would otherwise meet a setting
 * the server has never heard of as `undefined` — and a settings page that
 * lists it would not render. The defaults are the servers' own
 * (shared/rules.mjs, APP_SETTINGS).
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
    featuredTemplate: DEFAULT_FEATURED_TEMPLATE,
    timeZone: "Europe/Vienna",
    featuredSchedule: null,
    setsSchedule: null,
    navPinned: [],
    navLabels: {},
    companyName: "",
    companyAddress: "",
    companyUid: "",
    cashRegisterId: "KASSE-1",
    takeawayDiscountPercent: 0,
    ...Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined))
  } as ApiSettings;
}

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
}

export interface AdminStorage {
  baseUrl: string;
  token: string;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
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
  let payload: { error?: string } = {};
  if (body) {
    try {
      payload = JSON.parse(body) as { error?: string };
    } catch {
      throw new ApiError(`Request failed (${response.status})`, response.status);
    }
  }
  if (!response.ok) throw new ApiError(payload.error || `Request failed (${response.status})`, response.status);
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

  mediaUrl(path: string): string { return `${this.storage.baseUrl}${path}`; }
  health(): Promise<{ ok: boolean }> { return this.#request("/api/health"); }
  products(): Promise<{ products: ApiCatalogProduct[] }> { return this.#request("/api/admin/products"); }
  createProduct(product: AdminProductInput): Promise<{ product: ApiCatalogProduct }> { return this.#request("/api/admin/products", { method: "POST", body: JSON.stringify(product) }); }
  updateProduct(id: string, product: AdminProductInput): Promise<{ product: ApiCatalogProduct }> { return this.#request(`/api/admin/products/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(product) }); }
  deleteProduct(id: string): Promise<void> { return this.#request(`/api/admin/products/${encodeURIComponent(id)}`, { method: "DELETE" }); }
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
  saveTable(input: { table: string; label?: string; enabled?: boolean; rotateToken?: boolean }): Promise<{ table: RestaurantTable }> { return this.#request("/api/admin/tables", { method: "POST", body: JSON.stringify(input) }); }
  deleteTable(table: string): Promise<void> { return this.#request(`/api/admin/tables/${encodeURIComponent(table)}`, { method: "DELETE" }); }
  printers(): Promise<{ printers: PrinterProfile[] }> { return this.#request("/api/admin/printers"); }
  createPrinter(profile: Omit<PrinterProfile, "id">): Promise<{ printer: PrinterProfile }> { return this.#request("/api/admin/printers", { method: "POST", body: JSON.stringify(profile) }); }
  updatePrinter(id: string, profile: Omit<PrinterProfile, "id">): Promise<{ printer: PrinterProfile }> { return this.#request(`/api/admin/printers/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(profile) }); }
  retryPrintJob(id: string): Promise<{ ok: boolean; id: string }> { return this.#request(`/api/admin/print-jobs/${encodeURIComponent(id)}/retry`, { method: "POST" }); }
  settings(): Promise<ApiSettings> { return this.#request<Partial<ApiSettings>>("/api/admin/settings").then(withSettingDefaults); }
  /** Either setting may be saved alone; the one left out keeps its value. */
  updateSettings(settings: Partial<ApiSettings>): Promise<ApiSettings> { return this.#request<Partial<ApiSettings>>("/api/admin/settings", { method: "PUT", body: JSON.stringify(settings) }).then(withSettingDefaults); }

  /** The console's live channel: every change on the floor and in the menu. */
  live(onEvent: (event: RealtimeEnvelope) => void, onStatus?: (open: boolean) => void): () => void {
    return openLive(this.storage.baseUrl, { role: "staff" }, onEvent, onStatus);
  }

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

  catalog(): Promise<{ products: ApiCatalogProduct[] }> { return this.#request("/api/catalog"); }
  floor(): Promise<{ tables: TableOverview[]; claims: PosClaim[]; takeawayDiscountPercent: number }> { return this.#request("/api/pos/floor"); }
  /** The POS's live channel: every change on the floor, whoever made it. */
  live(onEvent: (event: RealtimeEnvelope) => void, onStatus?: (open: boolean) => void): () => void {
    return openLive(this.baseUrl, { role: "staff" }, onEvent, onStatus);
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
  voucher(code: string): Promise<{ voucher: ApiVoucher }> { return this.#request(`/api/admin/vouchers/${encodeURIComponent(code)}`); }
  settlement(staffId?: string): Promise<{ totals: PosSettlement["totals"] }> { return this.#request(`/api/pos/settlement${staffId ? `?staffId=${encodeURIComponent(staffId)}` : ""}`); }
  settle(staffId?: string): Promise<{ settlement: PosSettlement }> { return this.#request("/api/pos/settlement", { method: "POST", body: JSON.stringify(staffId ? { staffId } : {}) }); }
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

  createServiceRequest(command: CreateServiceRequestCommand): Promise<{ request: { id: string } }> {
    return this.#request("/api/service-requests", { method: "POST", body: JSON.stringify(command) });
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
    return parseJsonResponse<T>(response);
  }
}

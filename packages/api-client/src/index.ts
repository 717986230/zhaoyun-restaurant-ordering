import type {
  ApiBill, ApiCatalogProduct, ApiOrder, ApiPrintJob, ApiServiceRequest, ApiSettings, CreateOrderCommand,
  CreateServiceRequestCommand, MenuLanguage, MenuThemeId, PrintJobStatus, RealtimeEnvelope, VatPercent
} from "@zhaoyun/contracts";
import type { BundleItem, ModifierGroup, PrinterProfile } from "@zhaoyun/domain";

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

  /** Open on purpose: one bit, which the console needs before it can decide
   *  whether to ask for a password or to set one. */
  gate(): Promise<{ configured: boolean }> { return this.#request("/api/admin/gate"); }
  signIn(password: string): Promise<{ token: string; expiresInMs: number }> {
    return this.#request("/api/admin/gate/sign-in", { method: "POST", body: JSON.stringify({ password }) });
  }
  setPassword(password: string, currentPassword?: string): Promise<{ configured: boolean }> {
    return this.#request("/api/admin/gate/password", {
      method: "POST",
      body: JSON.stringify(currentPassword ? { password, currentPassword } : { password })
    });
  }
  signOut(): Promise<void> { return this.#request("/api/admin/gate/sign-out", { method: "POST" }); }

  mediaUrl(path: string): string { return `${this.storage.baseUrl}${path}`; }
  health(): Promise<{ ok: boolean }> { return this.#request("/api/health"); }
  products(): Promise<{ products: ApiCatalogProduct[] }> { return this.#request("/api/admin/products"); }
  createProduct(product: AdminProductInput): Promise<{ product: ApiCatalogProduct }> { return this.#request("/api/admin/products", { method: "POST", body: JSON.stringify(product) }); }
  updateProduct(id: string, product: AdminProductInput): Promise<{ product: ApiCatalogProduct }> { return this.#request(`/api/admin/products/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(product) }); }
  deleteProduct(id: string): Promise<void> { return this.#request(`/api/admin/products/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  session(): Promise<{ role: StaffRole }> { return this.#request("/api/admin/session"); }
  audit(limit = 100): Promise<{ entries: AuditEntry[] }> { return this.#request(`/api/admin/audit?limit=${limit}`); }
  orders(limit = 100): Promise<{ orders: ApiOrder[] }> { return this.#request(`/api/orders?limit=${limit}`); }
  updateOrderStatus(id: string, status: ApiOrder["status"]): Promise<{ order: ApiOrder }> { return this.#request(`/api/orders/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); }
  serviceRequests(limit = 100): Promise<{ requests: ApiServiceRequest[] }> { return this.#request(`/api/service-requests?limit=${limit}`); }
  updateServiceRequestStatus(id: string, status: ApiServiceRequest["status"]): Promise<{ request: ApiServiceRequest }> { return this.#request(`/api/service-requests/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); }
  printJobs(status: PrintJobStatus = "failed", limit = 50): Promise<{ jobs: ApiPrintJob[] }> { return this.#request(`/api/admin/print-jobs?status=${status}&limit=${limit}`); }
  bill(table: string): Promise<{ bill: ApiBill }> { return this.#request(`/api/admin/tables/${encodeURIComponent(table)}/bill`); }
  settleBill(table: string): Promise<{ bill: ApiBill }> { return this.#request(`/api/admin/tables/${encodeURIComponent(table)}/bill/settle`, { method: "POST" }); }
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
  settings(): Promise<ApiSettings> { return this.#request("/api/admin/settings"); }
  /** Either setting may be saved alone; the one left out keeps its value. */
  updateSettings(settings: Partial<ApiSettings>): Promise<ApiSettings> { return this.#request("/api/admin/settings", { method: "PUT", body: JSON.stringify(settings) }); }

  connect(onMessage: (message: RealtimeEnvelope) => void): () => void {
    const base = this.storage.baseUrl.replace(/^http/, "ws");
    if (!base) return () => undefined;
    let socket: WebSocket | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const open = () => {
      socket = new WebSocket(`${base}/ws`);
      socket.addEventListener("message", (event) => {
        try { onMessage(JSON.parse(String(event.data)) as RealtimeEnvelope); } catch { /* Ignore malformed live events. */ }
      });
      socket.addEventListener("close", () => {
        if (!stopped) retryTimer = setTimeout(open, 2500);
      });
    };
    open();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
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

  catalog(): Promise<{ products: ApiCatalogProduct[]; theme?: MenuThemeId; languages?: MenuLanguage[] }> {
    return this.#request("/api/catalog");
  }

  createOrder(command: CreateOrderCommand): Promise<{ order: ApiOrder }> {
    return this.#request("/api/orders", { method: "POST", body: JSON.stringify(command) });
  }

  createServiceRequest(command: CreateServiceRequestCommand): Promise<{ request: { id: string } }> {
    return this.#request("/api/service-requests", { method: "POST", body: JSON.stringify(command) });
  }

  connect(onMessage: (message: RealtimeEnvelope) => void): () => void {
    const base = this.#baseUrl().replace(/^http/, "ws");
    if (!base) return () => undefined;
    let socket: WebSocket | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const open = () => {
      const query = new URLSearchParams(this.#socketParams()).toString();
      socket = new WebSocket(`${base}/ws${query ? `?${query}` : ""}`);
      socket.addEventListener("message", (event) => {
        try { onMessage(JSON.parse(String(event.data)) as RealtimeEnvelope); } catch { /* Ignore malformed live events. */ }
      });
      socket.addEventListener("close", () => {
        if (!stopped) retryTimer = setTimeout(open, 2500);
      });
    };
    open();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
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

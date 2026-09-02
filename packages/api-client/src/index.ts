import type {
  ApiCatalogProduct, ApiOrder, ApiOrderStatus, ApiServiceRequest, ApiServiceRequestStatus,
  CreateOrderCommand, CreateServiceRequestCommand, RealtimeEnvelope
} from "@zhaoyun/contracts";
import type { ModifierGroup, PrinterProfile } from "@zhaoyun/domain";

export interface RestaurantApiOptions {
  baseUrl: () => string;
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
  printStation: "kitchen" | "bar" | "sushi" | "front";
  available: boolean;
  published: boolean;
  modifiers?: ModifierGroup[];
}

export interface AdminStorage {
  baseUrl: string;
  token: string;
  /** Table this device orders for; shared with the customer app on the same origin. */
  tableNumber: string;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export class AdminApi {
  get storage(): AdminStorage {
    const fallback = location.port === "5173" ? "http://127.0.0.1:8787" : location.origin;
    return {
      baseUrl: localStorage.getItem("zy_api_base") || fallback,
      token: sessionStorage.getItem("zy_admin_token") || "",
      tableNumber: localStorage.getItem("zy_table_no") || ""
    };
  }

  configure(storage: AdminStorage): void {
    localStorage.setItem("zy_api_base", storage.baseUrl.replace(/\/+$/, ""));
    sessionStorage.setItem("zy_admin_token", storage.token);
    const table = storage.tableNumber.trim().slice(0, 32);
    if (table) localStorage.setItem("zy_table_no", table);
  }

  mediaUrl(path: string): string { return `${this.storage.baseUrl}${path}`; }
  health(): Promise<{ ok: boolean }> { return this.#request("/api/health"); }
  products(): Promise<{ products: ApiCatalogProduct[] }> { return this.#request("/api/admin/products"); }
  createProduct(product: AdminProductInput): Promise<{ product: ApiCatalogProduct }> { return this.#request("/api/admin/products", { method: "POST", body: JSON.stringify(product) }); }
  updateProduct(id: string, product: AdminProductInput): Promise<{ product: ApiCatalogProduct }> { return this.#request(`/api/admin/products/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(product) }); }
  deleteProduct(id: string): Promise<void> { return this.#request(`/api/admin/products/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  printers(): Promise<{ printers: PrinterProfile[] }> { return this.#request("/api/admin/printers"); }
  createPrinter(profile: Omit<PrinterProfile, "id">): Promise<{ printer: PrinterProfile }> { return this.#request("/api/admin/printers", { method: "POST", body: JSON.stringify(profile) }); }
  updatePrinter(id: string, profile: Omit<PrinterProfile, "id">): Promise<{ printer: PrinterProfile }> { return this.#request(`/api/admin/printers/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(profile) }); }
  retryPrintJob(id: string): Promise<{ ok: boolean; id: string }> { return this.#request(`/api/admin/print-jobs/${encodeURIComponent(id)}/retry`, { method: "POST" }); }
  orders(limit = 100): Promise<{ orders: ApiOrder[] }> { return this.#request(`/api/orders?limit=${limit}`); }
  updateOrderStatus(id: string, status: ApiOrderStatus): Promise<{ order: ApiOrder }> { return this.#request(`/api/orders/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); }
  serviceRequests(limit = 100): Promise<{ requests: ApiServiceRequest[] }> { return this.#request(`/api/service-requests?limit=${limit}`); }
  updateServiceRequestStatus(id: string, status: ApiServiceRequestStatus): Promise<{ request: ApiServiceRequest }> { return this.#request(`/api/service-requests/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); }

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
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new ApiError(payload.error || `Request failed (${response.status})`, response.status);
    return payload as T;
  }
}

export class RestaurantApi {
  readonly #baseUrl: () => string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: RestaurantApiOptions) {
    this.#baseUrl = options.baseUrl;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  mediaUrl(path: string): string {
    return `${this.#baseUrl()}${path}`;
  }

  catalog(): Promise<{ products: ApiCatalogProduct[] }> {
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

  async #request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    if (options.body) headers.set("content-type", "application/json");
    const response = await this.#fetch(`${this.#baseUrl()}${path}`, { ...options, headers });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new ApiError(payload.error || `Request failed (${response.status})`, response.status);
    return payload as T;
  }
}

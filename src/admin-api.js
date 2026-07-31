const storage = {
  get baseUrl() {
    const fallback = location.port === "5173" ? "http://127.0.0.1:8787" : location.origin;
    return localStorage.getItem("zy_api_base") || fallback;
  },
  set baseUrl(value) {
    localStorage.setItem("zy_api_base", value.replace(/\/+$/, ""));
  },
  get token() {
    return sessionStorage.getItem("zy_admin_token") || "";
  },
  set token(value) {
    sessionStorage.setItem("zy_admin_token", value);
  }
};

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("x-admin-token", storage.token);
  if (options.body && !(options.body instanceof FormData)) headers.set("content-type", "application/json");
  const response = await fetch(`${storage.baseUrl}${path}`, { ...options, headers });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

export const adminApi = {
  storage,
  health: () => request("/api/health"),
  products: () => request("/api/admin/products"),
  createProduct: (product) => request("/api/admin/products", { method: "POST", body: JSON.stringify(product) }),
  updateProduct: (id, product) => request(`/api/admin/products/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(product) }),
  deleteProduct: (id) => request(`/api/admin/products/${encodeURIComponent(id)}`, { method: "DELETE" }),
  uploadMedia: (id, file) => {
    const form = new FormData();
    form.append("file", file);
    return request(`/api/admin/products/${encodeURIComponent(id)}/media`, { method: "POST", body: form });
  },
  printers: () => request("/api/admin/printers"),
  createPrinter: (printer) => request("/api/admin/printers", { method: "POST", body: JSON.stringify(printer) }),
  updatePrinter: (id, printer) => request(`/api/admin/printers/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(printer) }),
  deletePrinter: (id) => request(`/api/admin/printers/${encodeURIComponent(id)}`, { method: "DELETE" })
};


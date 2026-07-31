import { Capacitor } from "@capacitor/core";

function baseUrl() {
  const configured = localStorage.getItem("zy_api_base");
  if (configured) return configured.replace(/\/+$/, "");
  if (Capacitor.isNativePlatform()) return "";
  return location.port === "5173" ? "http://127.0.0.1:8787" : location.origin;
}

async function request(path, options = {}) {
  const base = baseUrl();
  if (!base) throw new Error("Restaurant server is not configured");
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...options.headers }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

export const customerApi = {
  mediaUrl(path) {
    return `${baseUrl()}${path}`;
  },
  catalog: () => request("/api/catalog"),
  createOrder: (order) => request("/api/orders", { method: "POST", body: JSON.stringify(order) }),
  createServiceRequest: (serviceRequest) => request("/api/service-requests", { method: "POST", body: JSON.stringify(serviceRequest) }),
  connect(onMessage) {
    const base = baseUrl().replace(/^http/, "ws");
    if (!base) return () => {};
    let socket;
    let retryTimer;
    let stopped = false;

    const open = () => {
      socket = new WebSocket(`${base}/ws`);
      socket.addEventListener("message", (event) => {
        try {
          onMessage(JSON.parse(event.data));
        } catch {
          // A malformed live message must not break ordering.
        }
      });
      socket.addEventListener("close", () => {
        if (!stopped) retryTimer = setTimeout(open, 2500);
      });
    };
    open();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      socket?.close();
    };
  }
};


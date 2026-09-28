/**
 * The API as a Cloudflare Worker over D1.
 *
 * Every route is shared/http.mjs's, over shared/store.mjs — the same code the
 * Node server runs. What is left here is the Worker's own: D1 as the store's
 * driver, pictures kept in D1 (a Worker has no disk), the live channel's
 * Durable Object, CORS, and the built web app (ASSETS).
 */
import { createApi, createApiState, SECURITY_HEADERS } from "../shared/http.mjs";
import { createStore } from "../shared/store.mjs";
import { d1Driver } from "./d1-driver.mjs";
import { openLive, publishLive } from "./live.mjs";

export { LiveHub } from "./live.mjs";

const UPLOAD_IMAGE_TYPES = new Map([["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"]]);
// One D1 row holds at most 2 MB.
const MAX_STORED_IMAGE_BYTES = 1.5 * 1024 * 1024;

// Kept by the isolate across requests: the guessing and ordering budgets.
const state = createApiState();

function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...SECURITY_HEADERS } });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("origin");
  const allowed = String(env.CORS_ORIGIN || "").split(",").map((entry) => entry.trim()).filter(Boolean);
  // A guest tablet is served from the app's own origin or from a file:// shell,
  // so an unset CORS_ORIGIN means "same origin only" rather than "anyone".
  const allow = !allowed.length ? null : allowed.includes("*") ? "*" : allowed.includes(origin) ? origin : null;
  if (!allow) return {};
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-admin-token,x-table-token,x-device-token,x-customer-token",
    "access-control-max-age": "86400",
    ...(allow === "*" ? {} : { vary: "origin" })
  };
}

/** The manager token, or none when this deployment's is too short to be worth trusting. */
function adminToken(env) {
  const expected = env.ADMIN_TOKEN;
  return expected && String(expected).length >= 32 ? expected : null;
}

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, ...SECURITY_HEADERS } });
    }
    const url = new URL(request.url);
    if (url.pathname === "/ws") return openLive(request, env);

    const store = createStore(d1Driver(env.DB));
    const api = createApi({
      store,
      state,
      tokens: { manager: adminToken(env), staff: env.STAFF_TOKEN, kitchen: env.KITCHEN_TOKEN },
      // Pictures only, and small enough for one D1 row. A video needs a bucket this deployment does not have.
      uploads: async (productId, file) => {
        const extension = UPLOAD_IMAGE_TYPES.get(file.type);
        if (!extension) return { error: "Only JPEG, PNG and WebP pictures can be stored here" };
        if (file.size > MAX_STORED_IMAGE_BYTES) return { error: "Picture exceeds 1.5 MB — make it smaller first", status: 413 };
        return { product: await store.storeMedia(productId, { contentType: file.type, extension, bytes: new Uint8Array(await file.arrayBuffer()) }) };
      },
      publish: (event) => ctx?.waitUntil(publishLive(env, event)),
      // VERSION is the commit, set by the deploy (wrangler deploy --var VERSION:<sha>).
      version: env.VERSION || null
    });

    // Cloudflare's own id for the request (cf-ray) where there is one: the same id its logs show.
    const requestId = request.headers.get("cf-ray") || crypto.randomUUID();
    let response = await api(request, { ip: request.headers.get("cf-connecting-ip") || "unknown", requestId });
    if (!response) {
      if (url.pathname.startsWith("/media/")) response = json({ error: "Media not found" }, 404);
      // Anything else is the web app. ASSETS is bound when the built site is
      // deployed with the Worker; without it, this deployment serves the API only.
      else if (env.ASSETS) return env.ASSETS.fetch(request);
      else response = json({ error: "This deployment serves the API only" }, 404);
    }
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(cors)) headers.set(name, value);
    headers.set("x-request-id", requestId);
    // An API answer is data, never a page: nothing in it may run or be framed.
    if (!headers.has("content-security-policy")) headers.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
    return new Response(response.body, { status: response.status, headers });
  }
};

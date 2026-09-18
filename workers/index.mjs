/**
 * The API as a Worker over D1.
 *
 * Route for route this is server/routes.mjs, and it has to stay that way: the
 * same paths, the same status codes, the same response shapes, because the two
 * apps are typed against one contract in packages/contracts and a tablet cannot
 * tell which backend answered. server/tests/contract.test.mjs runs the same
 * assertions against both for exactly that reason.
 *
 * What is deliberately not here:
 *  - WebSocket. The realtime hub is a Node process holding sockets; on Workers
 *    that is a Durable Object. Until then the admin board polls, which it can
 *    already do — TanStack Query owns that refresh either way.
 *  - Media upload. Dish photos are written to a disk that does not exist here;
 *    they belong in R2, and the route says so rather than pretending.
 */
import { Value } from "@sinclair/typebox/value";
import { createStore } from "./store.mjs";
import {
  CreateOrderBody, OrderStatusBody, PrinterBody, ProductBody, ServiceRequestBody, ServiceStatusBody
} from "../src/contracts.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY"
};

const AUTH_WINDOW_MS = 5 * 60 * 1000;
const AUTH_MAX_FAILURES = 5;
const AUTH_MAX_TRACKED_SOURCES = 10_000;

/**
 * Isolate-local, so this throttles a burst rather than enforcing a global
 * budget — Workers run many isolates and they do not share memory. It is worth
 * having anyway: it is what makes a single client guessing the token slow, and
 * D1 is not asked a question for every guess. A global limit needs a Durable
 * Object, and that arrives with the realtime one.
 */
const authFailures = new Map();

function pruneAuthFailures(moment) {
  for (const [source, entry] of authFailures) {
    if (entry.resetAt <= moment) authFailures.delete(source);
  }
}

/** Constant-time compare, so a wrong token leaks nothing through timing. */
function tokenMatches(provided, expected) {
  const encoder = new TextEncoder();
  const a = encoder.encode(typeof provided === "string" ? provided : "");
  const b = encoder.encode(expected || "");
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...SECURITY_HEADERS, ...headers } });
}

function fail(message, status = 400) {
  return json({ error: message || "Request failed" }, status);
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
    "access-control-allow-headers": "content-type,x-admin-token",
    "access-control-max-age": "86400",
    ...(allow === "*" ? {} : { vary: "origin" })
  };
}

function clientKey(request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}

function requireAdmin(request, env) {
  const expected = env.ADMIN_TOKEN;
  if (!expected || String(expected).length < 32) {
    // Refuse rather than fall back to a default: a deployed backend with a weak
    // admin token is worse than one that plainly is not configured yet.
    return fail("ADMIN_TOKEN is not configured on this deployment", 503);
  }
  const moment = Date.now();
  const key = clientKey(request);
  const current = authFailures.get(key);
  if (current && current.resetAt <= moment) authFailures.delete(key);
  const active = authFailures.get(key);
  if (active && active.failures >= AUTH_MAX_FAILURES) {
    const retryAfter = Math.max(1, Math.ceil((active.resetAt - moment) / 1000));
    return json({ error: "Too many authentication attempts", retryAfter }, 429, { "retry-after": String(retryAfter) });
  }
  if (!tokenMatches(request.headers.get("x-admin-token"), expected)) {
    const failures = (active?.failures ?? 0) + 1;
    if (!active && authFailures.size >= AUTH_MAX_TRACKED_SOURCES) pruneAuthFailures(moment);
    authFailures.set(key, { failures, resetAt: moment + AUTH_WINDOW_MS });
    return json({ error: "Admin authentication required" }, 401);
  }
  authFailures.delete(key);
  return null;
}

/**
 * The same TypeBox schemas Fastify validates against, checked with TypeBox's own
 * interpreter rather than Ajv — Ajv compiles validators with `new Function`,
 * which a Worker is not allowed to do. One schema file, so a body the Node
 * server rejects is rejected here too.
 */
async function body(request, schema) {
  let parsed;
  try {
    parsed = (await request.json()) ?? {};
  } catch {
    parsed = {};
  }
  if (!schema) return { value: parsed };
  if (Value.Check(schema, parsed)) return { value: parsed };
  const [problem] = [...Value.Errors(schema, parsed)];
  return { invalid: fail(problem ? `body${problem.path}: ${problem.message}` : "Invalid request body") };
}

function segments(pathname) {
  return pathname.split("/").filter(Boolean);
}

async function handle(request, env) {
  const url = new URL(request.url);
  const path = segments(url.pathname);
  const method = request.method;
  const store = createStore(env.DB);
  const limit = url.searchParams.get("limit") ?? undefined;

  const admin = () => requireAdmin(request, env);

  // /api/health
  if (path.length === 2 && path[0] === "api" && path[1] === "health" && method === "GET") {
    return json({ ok: true, realtimeClients: 0, timestamp: new Date().toISOString() });
  }

  // /api/catalog
  if (path.length === 2 && path[0] === "api" && path[1] === "catalog" && method === "GET") {
    return json({ products: await store.listProducts(true) });
  }

  // /api/orders and /api/orders/:id/status
  if (path[0] === "api" && path[1] === "orders") {
    if (path.length === 2 && method === "GET") {
      const denied = admin();
      if (denied) return denied;
      return json({ orders: await store.listOrders(limit) });
    }
    if (path.length === 2 && method === "POST") {
      try {
        const { value, invalid } = await body(request, CreateOrderBody);
        if (invalid) return invalid;
        return json({ order: await store.createOrder(value) }, 201);
      } catch (error) {
        return fail(error.message);
      }
    }
    if (path.length === 4 && path[3] === "status" && method === "PATCH") {
      const denied = admin();
      if (denied) return denied;
      try {
        const { value, invalid } = await body(request, OrderStatusBody);
        if (invalid) return invalid;
        const order = await store.updateOrder(path[2], value.status);
        return order ? json({ order }) : fail("Order not found", 404);
      } catch (error) {
        return fail(error.message);
      }
    }
  }

  // /api/service-requests and /api/service-requests/:id/status
  if (path[0] === "api" && path[1] === "service-requests") {
    if (path.length === 2 && method === "GET") {
      const denied = admin();
      if (denied) return denied;
      return json({ requests: await store.listServiceRequests(limit) });
    }
    if (path.length === 2 && method === "POST") {
      try {
        const { value, invalid } = await body(request, ServiceRequestBody);
        if (invalid) return invalid;
        return json({ request: await store.createServiceRequest(value) }, 201);
      } catch (error) {
        return fail(error.message);
      }
    }
    if (path.length === 4 && path[3] === "status" && method === "PATCH") {
      const denied = admin();
      if (denied) return denied;
      try {
        const { value, invalid } = await body(request, ServiceStatusBody);
        if (invalid) return invalid;
        const serviceRequest = await store.updateServiceRequest(path[2], value.status);
        return serviceRequest ? json({ request: serviceRequest }) : fail("Service request not found", 404);
      } catch (error) {
        return fail(error.message);
      }
    }
  }

  if (path[0] === "api" && path[1] === "admin") {
    const denied = admin();
    if (denied) return denied;

    // /api/admin/products[/:id][/media]
    if (path[2] === "products") {
      if (path.length === 3 && method === "GET") return json({ products: await store.listProducts(false) });
      if (path.length === 3 && method === "POST") {
        try {
          const { value, invalid } = await body(request, ProductBody);
          if (invalid) return invalid;
          return json({ product: await store.saveProduct(value) }, 201);
        } catch (error) {
          return fail(error.message);
        }
      }
      if (path.length === 4 && method === "GET") {
        const product = await store.getProduct(path[3]);
        return product ? json(product) : fail("Product not found", 404);
      }
      if (path.length === 4 && method === "PUT") {
        try {
          const { value, invalid } = await body(request, ProductBody);
          if (invalid) return invalid;
          const product = await store.saveProduct(value, path[3]);
          return product ? json({ product }) : fail("Product not found", 404);
        } catch (error) {
          return fail(error.message);
        }
      }
      if (path.length === 4 && method === "DELETE") {
        return (await store.deleteProduct(path[3]))
          ? new Response(null, { status: 204, headers: SECURITY_HEADERS })
          : fail("Product not found", 404);
      }
      if (path.length === 5 && path[4] === "media" && method === "POST") {
        return fail("Media upload needs an R2 bucket; this deployment has none configured", 501);
      }
    }

    // /api/admin/printers[/:id]
    if (path[2] === "printers") {
      if (path.length === 3 && method === "GET") return json({ printers: await store.listPrinters() });
      if (path.length === 3 && method === "POST") {
        try {
          const { value, invalid } = await body(request, PrinterBody);
          if (invalid) return invalid;
          return json({ printer: await store.savePrinter(value) }, 201);
        } catch (error) {
          return fail(error.message);
        }
      }
      if (path.length === 4 && method === "PUT") {
        try {
          const { value, invalid } = await body(request, PrinterBody);
          if (invalid) return invalid;
          const printer = await store.savePrinter(value, path[3]);
          return printer ? json({ printer }) : fail("Printer not found", 404);
        } catch (error) {
          return fail(error.message);
        }
      }
      if (path.length === 4 && method === "DELETE") {
        return (await store.deletePrinter(path[3]))
          ? new Response(null, { status: 204, headers: SECURITY_HEADERS })
          : fail("Printer not found", 404);
      }
    }

    // /api/admin/print-jobs[/:id/retry], and the agent's claim/complete/fail
    if (path[2] === "print-jobs") {
      if (path.length === 3 && method === "GET") {
        return json({ jobs: await store.listPrintJobs(url.searchParams.get("status") || "queued", limit) });
      }
      if (path.length === 5 && path[4] === "retry" && method === "POST") {
        return (await store.retryPrintJob(path[3]))
          ? json({ ok: true, id: path[3] })
          : fail("Only failed print jobs can be retried", 409);
      }
      if (path.length === 4 && path[3] === "claim" && method === "POST") {
        const { value: payload } = await body(request);
        const job = await store.claimPrintJob(payload.role, payload.workerId, Number(payload.leaseMs) || 30_000);
        return json({ job });
      }
      if (path.length === 5 && path[4] === "complete" && method === "POST") {
        const { value: payload } = await body(request);
        return json({ ok: await store.completePrintJob(path[3], payload.workerId) });
      }
      if (path.length === 5 && path[4] === "fail" && method === "POST") {
        const { value: payload } = await body(request);
        return json({ ok: await store.failPrintJob(path[3], payload.workerId, payload.error) });
      }
    }

    if (path[2] === "printer-for-role" && path.length === 4 && method === "GET") {
      return json({ printer: await store.printerForRole(path[3]) });
    }
  }

  if (path[0] === "ws") {
    return fail("Realtime needs a Durable Object; this deployment polls instead", 501);
  }

  if (path[0] === "api") return fail("API route not found", 404);

  // Anything that is not /api/ is the web app. ASSETS is bound when the built
  // site is deployed with the Worker; without it, this is an API-only
  // deployment and says so rather than answering an empty 404.
  if (env.ASSETS) return env.ASSETS.fetch(request);
  return fail("This deployment serves the API only", 404);
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, ...SECURITY_HEADERS } });
    }
    let response;
    try {
      response = await handle(request, env);
    } catch (error) {
      response = fail(error?.message || "Unhandled error", 500);
    }
    if (!Object.keys(cors).length) return response;
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(cors)) headers.set(name, value);
    return new Response(response.body, { status: response.status, headers });
  }
};

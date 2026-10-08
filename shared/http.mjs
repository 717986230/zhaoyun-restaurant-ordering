/**
 * The API: every route, for both backends.
 *
 * The Node server (server/index.mjs) and the Worker (workers/index.mjs) each
 * hand this their requests as the web's own Request and send back the
 * Response it answers with. What is left to each host is only what is really
 * its own: where the database is (the store's driver), where an uploaded
 * picture goes, the live channel's sockets, CORS, and the web app's files.
 * So a route is written once, and the two cannot answer differently — which
 * shared/contract-suite.mjs, run against both, goes on checking.
 *
 * Request bodies are checked against the TypeBox schemas in src/contracts.js
 * with TypeBox's own interpreter: a Worker may not compile validators with
 * `new Function`, which is what Ajv does.
 */
import { Value } from "@sinclair/typebox/value";
import {
  CategoryRenameBody, CategoryVatBody, CheckoutBody, EmailCodeBody, EmailVerifyBody, MailTestBody, CreateOrderBody, StornoBody, StaffBody, DeviceBody, PosSignInBody, MoveTableBody, SettlementBody, DrawerOpenBody, DrawerMoveBody, DrawerCloseBody, OrderStatusBody, PrinterBody, ProductBody, ServiceRequestBody, ServiceStatusBody,
  SettingsBody, TableBody, TableLockBody, RegisterBody, AccountSignInBody, AccountUpdateBody, AccountRecoverBody, VoidBody, AvailabilityBody,
  GuestOrderBody, CustomerRegisterBody, CustomerSignInBody, CustomerUpdateBody, CustomerDeleteBody, PointsAdjustBody, CustomerPasswordBody, TableOrderingBody,
  PrintBridgeClaimBody, PrintBridgeDoneBody, PrintBridgeFailBody, PrintBridgeReportBody, NumberedTablesBody, TableRenameBody, ClientErrorBody,
  ReservationBody, StaffReservationBody, ReservationUpdateBody, DeliveryActionBody, StockBody
} from "../src/contracts.js";
import { brevoRequest, codeMessage, mailStatus, testMessage } from "./mail.mjs";
import { EMAIL_CODE_RESEND_MS, EMAIL_CODE_TTL_MS, maskEmail } from "./email-verify.mjs";
import { DELIVERY_PROVIDER_IDS, DELIVERY_PROVIDERS, foodoraLoginRequest, outboundRequest, sampleOrder, webhookAuthentic } from "./delivery.mjs";
import { resolveStaffRole, roleAllows } from "./auth.mjs";
import { customerAccountsOn, menuSettingsView } from "./settings.mjs";
import { liveEvent } from "./live.mjs";
import { ICON_APPS, ICON_SIZES, iconRequest, isPng, servedManifest, MAX_ICON_BYTES, svgHoldingPng } from "./app-icons.mjs";
import { createRateLimiter } from "./rate-limit.mjs";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

const TABLE_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,7}$/;

export const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY"
};

const AUTH_WINDOW_MS = 5 * 60 * 1000;
const AUTH_MAX_FAILURES = 5;
const AUTH_MAX_TRACKED_SOURCES = 10_000;
// The count every isolate and process shares (store.authThrottle): wrong
// passwords and PINs from one address, and against one account from anywhere.
const GUESS_WINDOW_MS = 15 * 60 * 1000;
const GUESS_MAX_PER_SOURCE = 10;
const GUESS_MAX_PER_IDENTITY = 20;

// Business fields worth keeping in the audit log; a request body is never stored whole.
const AUDIT_FIELDS = ["status", "table", "sku", "price", "vatPercent", "published", "available", "name", "role", "enabled", "rotateToken"];
// A booking's: never the guest's name or number, which the audit log would keep past the booking's own retention.
const RESERVATION_AUDIT_FIELDS = ["status", "table", "date", "time", "party"];

/** Constant-time compare, so a wrong token leaks nothing through timing. */
function tokenMatches(provided, expected) {
  const encoder = new TextEncoder();
  const a = encoder.encode(typeof provided === "string" ? provided : "");
  const b = encoder.encode(expected || "");
  if (!b.length || a.length !== b.length) return false;
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

/** A refusal that says what it is (`code`) and, for a pause, how long (retry-after). */
function coded(error) {
  const status = error.status ?? (error.code === "TABLE_LOCKED" ? 409 : 400);
  return json({
    error: error.message || "Request failed",
    ...(error.code ? { code: error.code } : {}),
    // A dish sold out for today (shared/stock.mjs): which, and how many are left.
    ...(error.code === "SOLD_OUT" ? { sku: error.sku, left: error.left } : {}),
    // An email code (shared/email-verify.mjs): how long to wait, how many tries are left.
    ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
    ...(error.attemptsLeft !== undefined ? { attemptsLeft: error.attemptsLeft } : {})
  }, status, error.retryAfter ? { "retry-after": String(error.retryAfter) } : {});
}

/** A table someone is at, or a number already taken: a 409 that says which (`code`). */
const TABLE_CONFLICTS = new Set(["TABLE_CLAIMED", "TABLE_IN_USE", "TABLE_EXISTS"]);
function tableRefusal(error) {
  return TABLE_CONFLICTS.has(error.code) ? coded({ message: error.message, code: error.code, status: 409 }) : fail(error.message);
}

/** A booking refused by its rules: the code says why (full, too soon, too large); anything else is a bug. */
function reservationRefusal(error) {
  if (!error.code) throw error;
  return json({
    error: error.message,
    code: error.code,
    ...(error.reason ? { reason: error.reason } : {}),
    ...(error.maxParty ? { maxParty: error.maxParty } : {}),
    ...(error.limit ? { limit: error.limit } : {}),
    // Booking for members: the points it needs and the guest's.
    ...(error.minPoints !== undefined ? { minPoints: error.minPoints, points: error.points } : {})
  }, error.status ?? 400);
}

/** A delivery order refused by its rules (not switched on, not an order, a step out of turn); anything else is a bug. */
function deliveryRefusal(error) {
  if (!error.code) throw error;
  return json({ error: error.message, code: error.code }, error.status ?? 400);
}

/**
 * What a platform's "something happened to an order" call is about: the
 * order's id and whether it was cancelled. The platforms name these
 * differently, and send more than cancellations; the rest is not ours.
 */
function platformEvent(payload) {
  if (!payload || typeof payload !== "object") return null;
  const order = payload.order ?? payload.Order ?? payload;
  const id = order.OrderId ?? order.orderId ?? order.Id ?? order.id ?? order.token ?? order.orderToken ?? payload.orderToken ?? payload.OrderId ?? payload.orderId;
  const what = [payload.status, payload.Status, payload.event, payload.Event, payload.type, payload.Type, order.status, order.Status].filter((value) => typeof value === "string").join(" ");
  if (!id) return null;
  return { externalId: String(id), cancelled: /cancel/i.test(what), reason: String(payload.reason ?? payload.Reason ?? payload.message ?? payload.Message ?? "").slice(0, 120) };
}

/**
 * A body checked against its schema. An invalid one is a 400 that says which
 * field and why, and starts "Invalid request" whichever backend answers.
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
  return { invalid: fail(problem ? `Invalid request: body${problem.path} ${problem.message}` : "Invalid request body") };
}

function segments(pathname) {
  return pathname.split("/").filter(Boolean).map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
}

/**
 * What the API keeps between requests, in memory: the budgets for guessing
 * passwords and tokens, and for placing orders and calling the service. One
 * per server; a Worker keeps one per isolate (shared/rate-limit.mjs).
 */
export function createApiState({ publicWindowMs = 60_000, orderMax = 60, serviceMax = 20 } = {}) {
  return {
    authFailures: new Map(),
    // Guests signing in keep a budget of their own: a restaurant's Wi-Fi is one
    // address for the guests and the staff tablets alike, and a guest mistyping
    // their password must not lock the POS out.
    customerFailures: new Map(),
    orderLimiter: createRateLimiter({ windowMs: publicWindowMs, max: orderMax }),
    serviceLimiter: createRateLimiter({ windowMs: publicWindowMs, max: serviceMax }),
    // Error reports from the apps: enough for a bad page load, not a flood.
    errorLimiter: createRateLimiter({ windowMs: publicWindowMs, max: 20 }),
    // Table bookings from one address (a restaurant's or a hotel's Wi-Fi is many
    // guests): a burst, not a script filling the evening. The guest's account
    // and its limits (shared/reservations.mjs, guestLimit) do the rest.
    reservationLimiter: createRateLimiter({ windowMs: publicWindowMs, max: 60 }),
    // Email codes from one address: each account has its own limits too (shared/email-verify.mjs).
    mailLimiter: createRateLimiter({ windowMs: publicWindowMs, max: 10 }),
    // Guest sign-ups from one address in ten minutes: a full dining room on
    // the restaurant's Wi-Fi, not a script making accounts for their points.
    registerLimiter: createRateLimiter({ windowMs: 10 * 60_000, max: 40 })
  };
}

/**
 * The API over one store.
 *
 *  - `store`: shared/store.mjs over the host's database;
 *  - `tokens`: { manager, staff, kitchen } — the configured shared tokens, as
 *    far as the host trusts them (the Worker drops a short ADMIN_TOKEN);
 *  - `state`: createApiState(), kept by the host across requests;
 *  - `uploads(productId, file)` → { product } or { error, status }: where a picture goes;
 *  - `publish(event)`: tells the live channel (shared/live.mjs);
 *  - `realtimeClients()`: how many are listening, for /api/health.
 *
 * `handle(request, { ip })` answers with a Response, or null for anything that
 * is not the API's — the web app, a picture the database does not have.
 */
export function createApi({ store, tokens = {}, state = createApiState(), uploads, publish = () => {}, realtimeClients, version = null, delivery = {}, mail = null, fetch: send = (...args) => fetch(...args) }) {
  const options = { realtimeClients, version };
  // foodora's bearer token, kept between calls until it runs out (per isolate on a Worker).
  const platformTokens = new Map();

  /**
   * Tells the platform what the floor did with its order (shared/delivery.mjs,
   * outboundRequest), and keeps what came of it on the order, where the POS
   * shows it and can send it again. A test order, or a platform whose API
   * access is not configured, has nothing to tell: `sync.status` "none".
   */
  async function tellPlatform(order, action, extra = {}) {
    const credentials = { ...(delivery[order.provider] ?? {}) };
    if (order.test) return store.delivery.recordSync(order.id, { ok: null });
    try {
      if (order.provider === "foodora") {
        const cached = platformTokens.get("foodora");
        if (cached && cached.expires > Date.now()) credentials.accessToken = cached.token;
        else {
          const login = foodoraLoginRequest(credentials);
          if (login) {
            const response = await send(login.url, { method: login.method, headers: login.headers, body: login.body, signal: AbortSignal.timeout(8000) });
            if (!response.ok) return store.delivery.recordSync(order.id, { ok: false, error: `Sign-in HTTP ${response.status}` });
            const signedIn = await response.json().catch(() => ({}));
            const token = signedIn.access_token ?? signedIn.accessToken;
            if (!token) return store.delivery.recordSync(order.id, { ok: false, error: "Sign-in gave no token" });
            platformTokens.set("foodora", { token, expires: Date.now() + Math.max(60, Number(signedIn.expires_in) || 1800) * 1000 - 60_000 });
            credentials.accessToken = token;
          }
        }
      }
      const call = outboundRequest(order, action, credentials, extra);
      if (!call) return store.delivery.recordSync(order.id, { ok: null });
      const response = await send(call.url, { method: call.method, headers: call.headers, body: JSON.stringify(call.body), signal: AbortSignal.timeout(8000) });
      if (response.status === 401) platformTokens.delete(order.provider);
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 200);
        return store.delivery.recordSync(order.id, { ok: false, error: `HTTP ${response.status}${detail ? `: ${detail}` : ""}` });
      }
      return store.delivery.recordSync(order.id, { ok: true });
    } catch (error) {
      return store.delivery.recordSync(order.id, { ok: false, error: String(error?.message ?? error) });
    }
  }

  /** The step the platform was last told about, to tell it again. */
  const LAST_TOLD = { accepted: "accept", rejected: "reject", ready: "ready" };

  /** The budget for guessing, per client address: `{ denied }` once it is spent. */
  function authThrottle(ctx, failuresBySource = state.authFailures) {
    const moment = Date.now();
    const key = ctx.ip || "unknown";
    const current = failuresBySource.get(key);
    if (current && current.resetAt <= moment) failuresBySource.delete(key);
    const active = failuresBySource.get(key);
    if (active && active.failures >= AUTH_MAX_FAILURES) {
      const retryAfter = Math.max(1, Math.ceil((active.resetAt - moment) / 1000));
      return { denied: json({ error: "Too many authentication attempts", retryAfter }, 429, { "retry-after": String(retryAfter) }) };
    }
    return {
      fail() {
        const failures = (active?.failures ?? 0) + 1;
        if (!active && failuresBySource.size >= AUTH_MAX_TRACKED_SOURCES) {
          for (const [source, entry] of failuresBySource) if (entry.resetAt <= moment) failuresBySource.delete(source);
        }
        failuresBySource.set(key, { failures, resetAt: moment + AUTH_WINDOW_MS });
      },
      pass() {
        failuresBySource.delete(key);
      }
    };
  }

  /**
   * Guessing a password or a PIN, counted in the database: Cloudflare runs
   * many isolates of the Worker, each with its own memory, so the count in
   * `authThrottle` alone could be multiplied by however many there are. By
   * address, and by the account being guessed (`identity`) from any address.
   * `{ denied }` once either is spent; `fail()` and `pass()` otherwise.
   */
  async function guessBudget(ctx, scope, identity = "") {
    const keys = [`${scope}:ip:${ctx.ip || "unknown"}`];
    const entries = [[keys[0], GUESS_MAX_PER_SOURCE]];
    if (identity) {
      keys.push(`${scope}:id:${String(identity).trim().toLowerCase().slice(0, 128)}`);
      entries.push([keys[1], GUESS_MAX_PER_IDENTITY]);
    }
    const retryAfter = await store.authThrottle.retryAfter(entries);
    if (retryAfter > 0) return { denied: json({ error: "Too many authentication attempts", retryAfter }, 429, { "retry-after": String(retryAfter) }) };
    return {
      fail: () => store.authThrottle.fail(keys, GUESS_WINDOW_MS),
      pass: () => store.authThrottle.clear(keys)
    };
  }

  /** A burst from one device to a public route: a 429 with how long to wait, or nothing. */
  /**
   * One email (shared/mail.mjs): through Brevo, or into the outbox for the
   * tests. False when it could not go; why is in the log, never the key.
   */
  async function sendMail(message) {
    if (!mail) return false;
    if (mail.provider === "outbox") {
      await store.customers.recordOutbox(message);
      return true;
    }
    const { url: address, init } = brevoRequest(mail, message, (await store.getSettings()).restaurantName);
    try {
      const response = await send(address, init);
      if (response.ok) return true;
      console.error(JSON.stringify({ level: "error", msg: "mail not sent", status: response.status, detail: (await response.text()).slice(0, 300) }));
    } catch (error) {
      console.error(JSON.stringify({ level: "error", msg: "mail not sent", error: String(error?.message ?? error) }));
    }
    return false;
  }

  function throttlePublic(limiter, ctx, message) {
    const { allowed, retryAfter } = limiter.check(ctx.ip || "unknown");
    return allowed ? null : json({ error: message, retryAfter }, 429, { "retry-after": String(retryAfter) });
  }

  /**
   * Authenticate, then check rank. The header carries a session token (the
   * restaurant's account, or a waiter on a POS device) or one of the
   * configured tokens. Returns `{ role, pos, account }` to go on, or
   * `{ denied }`, so a caller cannot forget to check.
   */
  async function requireRole(request, ctx, minimumRole) {
    const throttle = authThrottle(ctx);
    if (throttle.denied) return throttle;
    const provided = request.headers.get("x-admin-token");
    const session = await store.roleForSession(provided);
    const role = session?.role ?? resolveStaffRole((token) => tokenMatches(provided, token), tokens);
    if (!role) {
      // Nothing configured that could ever grant one: say so, rather than
      // counting a failure against a caller who had no way to succeed.
      if (!tokens.manager && !(await store.accountStatus()).registered) {
        return { denied: fail("Register the restaurant's account on the admin console, or configure ADMIN_TOKEN", 503) };
      }
      throttle.fail();
      return { denied: json({ error: "Admin authentication required" }, 401) };
    }
    throttle.pass();
    ctx.role = role;
    // A waiter's session carries who they are and which device they are on.
    const pos = session?.staff ? { staff: session.staff, deviceId: session.deviceId } : null;
    if (!roleAllows(role, minimumRole)) {
      // A valid token used beyond its role is worth recording, not just refusing.
      ctx.audited = true;
      const url = new URL(request.url);
      await store.recordAudit({ role, ip: ctx.ip ?? "", method: request.method, route: url.pathname + url.search, status: 403, detail: { denied: minimumRole } });
      return { denied: json({ error: `This role may not perform ${minimumRole} actions` }, 403) };
    }
    return { role, pos, account: session?.account ?? null };
  }

  /**
   * The table gate. Until a restaurant registers its first table the app runs
   * in open mode, so a fresh install works before anything is set up. Once
   * tables exist, a guest's order or call names one of them and carries the
   * token printed on its card. The table is upper-cased in place: that is
   * what is stored and what the bill is grouped by.
   */
  async function refuseUnknownTable(request, command) {
    const table = String(command.table ?? "").trim().toUpperCase();
    // Validated even in open mode: a table that cannot be registered later
    // would otherwise be accepted now and become unbillable.
    if (!TABLE_PATTERN.test(table)) return fail("Table number must be 1-8 letters or digits");
    command.table = table;
    if (!await store.hasTables()) return null;
    const registered = await store.getTable(table);
    if (!registered || !registered.enabled) return json({ error: "Unknown table" }, 403);
    if (!tokenMatches(request.headers.get("x-table-token"), registered.token)) return json({ error: "Table token is invalid" }, 403);
    return null;
  }

  /** Responses that changed nothing anyone watches (a POS keeping its table): no live event, no audit. */
  const QUIET = new WeakSet();
  const quiet = (response) => {
    QUIET.add(response);
    return response;
  };

  async function handle(request, ctx) {
    const url = new URL(request.url);
    const path = segments(url.pathname);
    const method = request.method;
    const limit = url.searchParams.get("limit") ?? undefined;

    const gate = (minimumRole) => requireRole(request, ctx, minimumRole);

    // /api/health
    if (path.length === 2 && path[0] === "api" && path[1] === "health" && method === "GET") {
      // What a deploy's smoke test and an uptime monitor ask: which build, and can it reach its database.
      const version = options.version ?? null;
      try {
        await store.ping();
      } catch {
        return json({ ok: false, database: "unreachable", version, timestamp: new Date().toISOString() }, 503);
      }
      return json({ ok: true, database: "ok", version, realtimeClients: options.realtimeClients?.() ?? 0, timestamp: new Date().toISOString() });
    }

    // /api/catalog
    if (path.length === 2 && path[0] === "api" && path[1] === "catalog" && method === "GET") {
      const settings = await store.getSettings();
      return json({ products: await store.listProducts(true, settings.timeZone), theme: settings.menuTheme, languages: settings.menuLanguages, menu: menuSettingsView(settings) });
    }

    // /api/orders and /api/orders/:id/status
    if (path[0] === "api" && path[1] === "orders") {
      if (path.length === 2 && method === "GET") {
        const { denied } = await gate("kitchen");
        if (denied) return denied;
        return json({ orders: await store.listOrders(limit) });
      }
      // The older way a guest orders at the table, under the same rules as /api/guest/orders.
      if (path.length === 2 && method === "POST") {
        const limited = throttlePublic(state.orderLimiter, ctx, "Too many orders from this device");
        if (limited) return limited;
        const { value, invalid } = await body(request, CreateOrderBody);
        if (invalid) return invalid;
        const refused = await refuseUnknownTable(request, value);
        if (refused) return refused;
        return placeGuestOrder({ ...value, channel: "dine-in" });
      }
      if (path.length === 4 && path[3] === "status" && method === "PATCH") {
        const { denied } = await gate("kitchen");
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

    /** One guest's data as one document (GDPR Art. 15 and 20), for them or for the manager answering them. */
    async function customerExport(customerId) {
      const data = await store.customers.exportData(customerId);
      if (!data) return fail("Guest not found", 404);
      const settings = await store.getSettings();
      return json({
        format: "zhaoyun-customer-export/1",
        exportedAt: new Date().toISOString(),
        restaurant: { name: settings.restaurantName ?? "", company: settings.companyName ?? "", address: settings.companyAddress ?? "" },
        ...data
      }, 200, { "cache-control": "no-store" });
    }

    /**
     * A guest's own order (shared/ordering.mjs): switched off until the owner
     * switches it on, and within its limits. A locked or closed table, a pause
     * between orders: the code says which, so the menu can say what to do.
     */
    async function placeGuestOrder({ channel, payment, ...order }) {
      try {
        const customer = await store.customers.session(request.headers.get("x-customer-token"));
        return json({ order: await store.placeGuestOrder(order, { channel, payment, customer }) }, 201);
      } catch (error) {
        return coded(error);
      }
    }

    if (path[0] === "api" && path[1] === "guest" && path[2] === "orders" && path.length === 3) {
      if (method === "POST") {
        const limited = throttlePublic(state.orderLimiter, ctx, "Too many orders from this device");
        if (limited) return limited;
        const { value, invalid } = await body(request, GuestOrderBody);
        if (invalid) return invalid;
        // A pickup names no table; an order at the table names its own, with its card's token.
        if (value.channel === "pickup") delete value.table;
        else {
          const refused = await refuseUnknownTable(request, value);
          if (refused) return refused;
        }
        return placeGuestOrder(value);
      }
      // A guest without an account follows the orders their phone placed, by the ids it made up for them.
      if (method === "GET") {
        const ids = String(url.searchParams.get("ids") ?? "").split(",").map((id) => id.trim()).filter((id) => id.length >= 8 && id.length <= 128);
        return json({ orders: await store.customers.ordersByRequest(ids) });
      }
    }

    /**
     * Guests' own accounts (shared/customer.mjs, shared/customer-store.mjs).
     * The session travels in `x-customer-token` and opens nothing else.
     */
    if (path[0] === "api" && path[1] === "customer") {
      const customers = store.customers;
      const rest = path.slice(2).join("/");
      if (method === "POST" && (rest === "register" || rest === "sign-in")) {
        if (rest === "register" && !customerAccountsOn(await store.getSettings())) return json({ error: "Guest accounts are not available", code: "ACCOUNTS_OFF" }, 403);
        const throttle = authThrottle(ctx, state.customerFailures);
        if (throttle.denied) return throttle.denied;
        if (rest === "register") {
          // New accounts from one address: a busy table's worth, not a script making them by the hundred.
          const limited = throttlePublic(state.registerLimiter, ctx, "Too many new accounts from this device");
          if (limited) return limited;
          const { value, invalid } = await body(request, CustomerRegisterBody);
          if (invalid) return invalid;
          try {
            // `table` is what older menus still send; the bonus no longer depends on it.
            const { table: _table, ...account } = value;
            const session = await customers.register(account);
            // A new account: the sign-up bonus, once.
            if (await store.reservations.signupBonus(session.customer.id)) {
              return json({ ...session, customer: await customers.byIdView(session.customer.id), signupBonus: true }, 201);
            }
            return json(session, 201);
          } catch (error) {
            return coded(error);
          }
        }
        const { value, invalid } = await body(request, CustomerSignInBody);
        if (invalid) return invalid;
        const budget = await guessBudget(ctx, "customer", value.email);
        if (budget.denied) return budget.denied;
        const session = await customers.signIn(value.email, value.password);
        if (!session) {
          throttle.fail();
          await budget.fail();
          return fail("Wrong email or password", 401);
        }
        throttle.pass();
        await budget.pass();
        return json(session);
      }
      if (method === "POST" && rest === "sign-out") {
        await customers.signOut(request.headers.get("x-customer-token"));
        return new Response(null, { status: 204, headers: SECURITY_HEADERS });
      }
      const customer = await customers.session(request.headers.get("x-customer-token"));
      if (!customer) return json({ error: "Please sign in", code: "SIGN_IN_REQUIRED" }, 401);
      try {
        if (rest === "" && method === "GET") return json(await customers.profile(customer.id));
        if (rest === "" && method === "PUT") {
          const { value, invalid } = await body(request, CustomerUpdateBody);
          if (invalid) return invalid;
          const updated = await customers.update(customer.id, value);
          return updated ? json(updated) : fail("Wrong password", 401);
        }
        if (rest === "delete" && method === "POST") {
          const { value, invalid } = await body(request, CustomerDeleteBody);
          if (invalid) return invalid;
          return (await customers.deleteOwn(customer.id, value.password)) ? new Response(null, { status: 204, headers: SECURITY_HEADERS }) : fail("Wrong password", 401);
        }
        if (path.length === 4 && path[2] === "favorites" && (method === "PUT" || method === "DELETE")) {
          return json({ favorites: await customers.setFavorite(customer.id, path[3], method === "PUT") });
        }
        if (rest === "points" && method === "GET") return json({ entries: await customers.points(customer.id) });
        if (rest === "orders" && method === "GET") return json({ orders: await customers.orders(customer.id) });
        if (rest === "export" && method === "GET") return customerExport(customer.id);
        if (rest === "reservations" && method === "GET") return json({ reservations: await store.reservations.forCustomer(customer.id) }, 200, { "cache-control": "no-store" });
        // Proving the account's email before booking: a code to it, and the code back.
        if (rest === "email-code" && method === "POST") {
          if (!mail) return json({ error: "Email verification is not set up", code: "VERIFICATION_OFF" }, 409);
          const limited = throttlePublic(state.mailLimiter, ctx, "Too many codes from this device");
          if (limited) return limited;
          const { value, invalid } = await body(request, EmailCodeBody);
          if (invalid) return invalid;
          const issued = await customers.issueEmailCode(customer.id);
          const settings = await store.getSettings();
          const message = { to: issued.email, ...codeMessage(issued.code, { language: value.language, restaurant: settings.restaurantName, minutes: EMAIL_CODE_TTL_MS / 60_000 }) };
          if (!(await sendMail(message))) return json({ error: "The email could not be sent — please try again", code: "MAIL_FAILED" }, 502);
          return json({ sentTo: maskEmail(issued.email), retryAfter: EMAIL_CODE_RESEND_MS / 1000 }, 201);
        }
        if (rest === "email-verify" && method === "POST") {
          const { value, invalid } = await body(request, EmailVerifyBody);
          if (invalid) return invalid;
          return json({ customer: await customers.verifyEmailCode(customer.id, value.code) });
        }
      } catch (error) {
        return coded(error);
      }
      return fail("Not found", 404);
    }

    // An error in one of the apps, for the log (packages/api-client, reportClientErrors).
    // Written as one JSON line beside the server's own; nothing is stored.
    if (path.length === 2 && path[0] === "api" && path[1] === "client-errors" && method === "POST") {
      const limited = throttlePublic(state.errorLimiter, ctx, "Too many error reports from this device");
      if (limited) return limited;
      const { value, invalid } = await body(request, ClientErrorBody);
      if (invalid) return invalid;
      console.error(JSON.stringify({
        level: "error",
        msg: "client error",
        requestId: ctx.requestId,
        app: value.app,
        error: value.message,
        stack: value.stack ?? "",
        // The path only: a table card's code travels in the query.
        path: String(value.path ?? "").split("?")[0],
        userAgent: String(request.headers.get("user-agent") ?? "").slice(0, 200)
      }));
      return new Response(null, { status: 204, headers: SECURITY_HEADERS });
    }

    /**
     * The delivery platforms' webhooks (shared/delivery.mjs): a new order at
     * /api/delivery/<platform>/orders, what became of one on their side at
     * /api/delivery/<platform>/events. Each platform proves itself with the
     * secret this deployment was given for it (LIEFERANDO_WEBHOOK_SECRET,
     * FOODORA_WEBHOOK_SECRET); one without is not here at all.
     */
    if (path[0] === "api" && path[1] === "delivery" && path.length === 4 && method === "POST" && (path[3] === "orders" || path[3] === "events")) {
      const provider = path[2];
      const secret = DELIVERY_PROVIDERS[provider] ? delivery[provider]?.webhookSecret : null;
      if (!secret) return fail("Not found", 404);
      const throttle = authThrottle(ctx);
      if (throttle.denied) return throttle.denied;
      if (!(await webhookAuthentic(request.headers, secret))) {
        throttle.fail();
        return fail("Unauthorized", 401);
      }
      const { value } = await body(request);
      try {
        if (path[3] === "orders") {
          const received = await store.delivery.receive(provider, value);
          const order = received.autoAccepted ? await tellPlatform(received.order, "accept", { prepMinutes: received.order.prepMinutes }) : received.order;
          return json({ id: order.id, status: order.status, duplicate: !received.created }, received.created ? 201 : 200);
        }
        const event = platformEvent(value);
        const order = event?.cancelled ? await store.delivery.platformCancelled(provider, event.externalId, event.reason) : null;
        return json({ ok: true, ...(order ? { id: order.id, status: order.status } : { ignored: true }) });
      } catch (error) {
        return deliveryRefusal(error);
      }
    }

    /**
     * Booking a table (shared/reservations.mjs). Open to anyone while the
     * owner has it switched on; a guest's own booking is theirs through the
     * link they were given: its id, and the token in `x-reservation-token`.
     */
    if (path[0] === "api" && path[1] === "reservations") {
      const reservations = store.reservations;
      try {
        if (path.length === 3 && path[2] === "availability" && method === "GET") {
          const date = url.searchParams.get("date");
          // Whether a guest proves their email first: only where there is mail to send the code with.
          if (!date) return json({ booking: { ...(await reservations.booking()), emailVerification: Boolean(mail) } });
          return json(await reservations.availability(date, url.searchParams.get("party") ?? undefined, url.searchParams.get("time")));
        }
        if (path.length === 2 && method === "POST") {
          const limited = throttlePublic(state.reservationLimiter, ctx, "Too many bookings from this device");
          if (limited) return limited;
          const { value, invalid } = await body(request, ReservationBody);
          if (invalid) return invalid;
          // From the guest's own account: signed in, or no booking.
          const customer = await store.customers.session(request.headers.get("x-customer-token"));
          // An account by mobile number has no email to prove; one by email proves it, where mail goes out.
          if (mail && customer && !customer.emailVerified && !customer.phone) return json({ error: "Please verify your email address first", code: "EMAIL_UNVERIFIED" }, 403);
          return json(await reservations.create(value, { customer }), 201);
        }
        const token = request.headers.get("x-reservation-token");
        if (path.length === 3 && method === "GET") {
          const reservation = await reservations.forGuest(path[2], token);
          return reservation ? json({ reservation }, 200, { "cache-control": "no-store" }) : fail("Booking not found", 404);
        }
        if (path.length === 4 && path[3] === "cancel" && method === "POST") {
          const customer = await store.customers.session(request.headers.get("x-customer-token"));
          const reservation = await reservations.cancelForGuest(path[2], token, customer?.id ?? null);
          return reservation ? json({ reservation }) : fail("Booking not found", 404);
        }
      } catch (error) {
        return reservationRefusal(error);
      }
      return fail("Not found", 404);
    }

    // /api/service-requests and /api/service-requests/:id/status
    if (path[0] === "api" && path[1] === "service-requests") {
      if (path.length === 2 && method === "GET") {
        const { denied } = await gate("staff");
        if (denied) return denied;
        return json({ requests: await store.listServiceRequests(limit) });
      }
      if (path.length === 2 && method === "POST") {
        const limited = throttlePublic(state.serviceLimiter, ctx, "Too many service requests from this device");
        if (limited) return limited;
        try {
          const refusedBody = await body(request, ServiceRequestBody);
          if (refusedBody.invalid) return refusedBody.invalid;
          const value = refusedBody.value;
          const refused = await refuseUnknownTable(request, value);
          if (refused) return refused;
          const created = await store.createServiceRequest(value);
          // The same call again, before anyone came: the one already waiting, not a second.
          if (created.repeated) {
            const { repeated, ...waiting } = created;
            return json({ request: waiting, repeated }, 200);
          }
          return json({ request: created }, 201);
        } catch (error) {
          return fail(error.message);
        }
      }
      if (path.length === 4 && path[3] === "status" && method === "PATCH") {
        const { denied } = await gate("staff");
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

    // ——— The print bridge in the restaurant (server/print-agent.mjs). It signs in
    // as a paired device (the console pairs it like a POS) or with a staff
    // token, reads the printers, takes the tickets for the stations it serves
    // and says what it found at each printer.
    if (path[0] === "api" && path[1] === "print-bridge") {
      if (!(await store.deviceForToken(request.headers.get("x-device-token")))) {
        const { denied } = await gate("staff");
        if (denied) return denied;
      }
      if (path.length === 3 && path[2] === "printers" && method === "GET") {
        return json({ printers: (await store.listPrinters()).filter((printer) => printer.enabled) });
      }
      if (path.length === 3 && path[2] === "claim" && method === "POST") {
        const { value, invalid } = await body(request, PrintBridgeClaimBody);
        if (invalid) return invalid;
        // Asked every few seconds: neither news for anyone nor worth an audit line.
        return quiet(json({ jobs: await store.claimPrintJobs(value.roles, value.workerId, value.leaseMs ?? 30_000, value.max ?? 5) }));
      }
      if (path.length === 5 && path[2] === "jobs" && path[4] === "complete" && method === "POST") {
        const { value, invalid } = await body(request, PrintBridgeDoneBody);
        if (invalid) return invalid;
        return quiet(json({ ok: await store.completePrintJob(path[3], value.workerId) }));
      }
      // A failure is news: the console's board shows it.
      if (path.length === 5 && path[2] === "jobs" && path[4] === "fail" && method === "POST") {
        const { value, invalid } = await body(request, PrintBridgeFailBody);
        if (invalid) return invalid;
        return json({ ok: await store.failPrintJob(path[3], value.workerId, value.error) });
      }
      if (path.length === 3 && path[2] === "status" && method === "POST") {
        const { value, invalid } = await body(request, PrintBridgeReportBody);
        if (invalid) return invalid;
        return quiet(json(await store.recordBridgeReport(value)));
      }
      return fail("Not found", 404);
    }

    // ——— The POS (shared/pos.mjs). A paired device lists the waiters and takes
    // a PIN; a waiter's session does the rest.
    if (path[0] === "api" && path[1] === "pos") {
      const pairedDevice = async () => store.deviceForToken(request.headers.get("x-device-token"));
      if (path.length === 3 && path[2] === "staff" && method === "GET") {
        if (!(await pairedDevice())) return fail("This device is not paired with the POS", 401);
        return json({ staff: (await store.listStaff(true)).map(({ id, name, role }) => ({ id, name, role })) });
      }
      if (path.length === 3 && path[2] === "sign-in" && method === "POST") {
        const throttle = authThrottle(ctx);
        if (throttle.denied) return throttle.denied;
        const device = await pairedDevice();
        if (!device) return fail("This device is not paired with the POS", 401);
        const { value, invalid } = await body(request, PosSignInBody);
        if (invalid) return invalid;
        // A PIN is four to six digits: the waiter's, from any of the paired devices, counts too.
        const budget = await guessBudget(ctx, "pin", value.staffId);
        if (budget.denied) return budget.denied;
        const session = await store.posSignIn(device, value.staffId, value.pin);
        if (!session) {
          throttle.fail();
          await budget.fail();
          return fail("Wrong PIN", 401);
        }
        throttle.pass();
        await budget.pass();
        return json(session);
      }
      if (path.length === 3 && path[2] === "sign-out" && method === "POST") {
        await store.posSignOut(request.headers.get("x-admin-token"));
        return new Response(null, { status: 204 });
      }
      if (path.length === 3 && path[2] === "settlements" && method === "GET") {
        const { denied } = await gate("manager");
        if (denied) return denied;
        return json({ settlements: await store.listSettlements(limit) });
      }
      if (path.length === 3 && path[2] === "drawers" && method === "GET") {
        const { denied } = await gate("manager");
        if (denied) return denied;
        return json({ drawers: await store.drawer.list(limit) });
      }

      const { denied, role, pos } = await gate("staff");
      if (denied) return denied;
      if (!pos) return fail("Sign in on a POS device", 403);
      const claimed = (error) => (error.code === "SOLD_OUT" || error.code === "BAD_STOCK" ? coded(error) : fail(error.message, error.code === "TABLE_CLAIMED" ? 409 : 400));
      try {
        if (path.length === 3 && path[2] === "floor" && method === "GET") {
          // `deviceId` is this device's: the tables it has open are its own, the others' are locked to it.
          return json({
            tables: await store.tablesOverview(),
            claims: await store.liveClaims(),
            deviceId: pos.deviceId,
            requests: await store.openServiceRequests(),
            // Today's bookings still to come or at the table.
            reservations: await store.reservations.today(),
            // Delivery platforms' orders not yet handed over.
            delivery: await store.delivery.open(),
            takeawayDiscountPercent: (await store.getSettings()).takeawayDiscountPercent
          });
        }
        if (path.length === 5 && path[2] === "tables" && path[4] === "claim") {
          if (method === "POST") {
            // A POS keeps its table every half minute; only taking it is news.
            const renewing = await store.holdsTable(path[3], pos.deviceId);
            const response = json({ claim: await store.claimTable(path[3], pos) });
            if (renewing) QUIET.add(response);
            return response;
          }
          if (method === "DELETE") {
            await store.releaseTable(path[3], pos, role === "manager" && url.searchParams.get("force") === "1");
            return new Response(null, { status: 204 });
          }
        }
        if (path.length === 3 && path[2] === "orders" && method === "POST") {
          const { value, invalid } = await body(request, CreateOrderBody);
          if (invalid) return invalid;
          return json({ order: await store.createOrder(value, pos) }, 201);
        }
        if (path.length === 3 && path[2] === "takeaway" && method === "POST") return json(await store.newTakeaway(pos), 201);
        if (path.length === 5 && path[2] === "tables" && path[4] === "move" && method === "POST") {
          const { value, invalid } = await body(request, MoveTableBody);
          if (invalid) return invalid;
          const moved = await store.moveTable(path[3], value.to, pos);
          return moved ? json(moved) : fail("Nothing open on that table", 404);
        }
        if (path.length === 5 && path[2] === "tables" && path[4] === "void" && method === "POST") {
          const { value, invalid } = await body(request, VoidBody);
          if (invalid) return invalid;
          try {
            return json({ void: await store.voidItem(path[3], value, pos, role) }, 201);
          } catch (error) {
            if (error.code === "NOT_FOUND") return fail(error.message, 404);
            throw error;
          }
        }
        if (path.length === 3 && path[2] === "catalog" && method === "GET") {
          return json({ products: (await store.listProducts(false)).filter((product) => product.published) });
        }
        // 每日限量: the floor says how many portions a dish has today, or each day.
        if (path.length === 5 && path[2] === "products" && path[4] === "stock" && method === "PUT") {
          const { value, invalid } = await body(request, StockBody);
          if (invalid) return invalid;
          const product = await store.setStock(path[3], value);
          return product ? json({ product }) : fail("No such dish on the menu", 404);
        }
        if (path.length === 5 && path[2] === "products" && path[4] === "availability" && method === "PUT") {
          const { value, invalid } = await body(request, AvailabilityBody);
          if (invalid) return invalid;
          const product = await store.setAvailable(path[3], value.available);
          return product ? json({ product }) : fail("No such dish on the menu", 404);
        }
        // The cash drawer: open with a float, money in and out, counted at the end (shared/drawer.mjs).
        if (path[2] === "drawer") {
          const drawerFailed = (error) => (error.code === "DRAWER_OPEN" || error.code === "NO_DRAWER" ? fail(error.message, 409) : fail(error.message, 400));
          try {
            if (path.length === 3 && method === "GET") return json({ drawer: await store.drawer.current() });
            if (path.length === 4 && path[3] === "open" && method === "POST") {
              const { value, invalid } = await body(request, DrawerOpenBody);
              if (invalid) return invalid;
              return json({ drawer: await store.drawer.open(value, pos.staff) }, 201);
            }
            if (path.length === 4 && path[3] === "movements" && method === "POST") {
              const { value, invalid } = await body(request, DrawerMoveBody);
              if (invalid) return invalid;
              return json({ movement: await store.drawer.move(value, pos.staff) }, 201);
            }
            if (path.length === 4 && path[3] === "close" && method === "POST") {
              const { value, invalid } = await body(request, DrawerCloseBody);
              if (invalid) return invalid;
              return json({ drawer: await store.drawer.close(value, pos.staff) }, 201);
            }
          } catch (error) {
            return drawerFailed(error);
          }
        }
        if (path.length === 3 && path[2] === "settlement") {
          const { value } = method === "POST" ? await body(request, SettlementBody) : { value: {} };
          const staffId = value?.staffId ?? url.searchParams.get("staffId") ?? pos.staff.id;
          if (staffId !== pos.staff.id && role !== "manager") return fail("Only the manager settles another waiter", 403);
          if (method === "GET") return json({ totals: await store.staffSettlementPreview(staffId) });
          if (method === "POST") {
            const settlement = await store.settleStaff(staffId, role);
            return settlement ? json({ settlement }, 201) : fail("No receipts since the last settlement", 409);
          }
        }
      } catch (error) {
        return claimed(error);
      }
      return fail("Not found", 404);
    }

    /**
     * The restaurant's account (shared/account.mjs).
     * `GET /api/account` is open on purpose: one bit, whether there is an account
     * yet, which the console needs to choose between registering and signing in.
     */
    if (path[0] === "api" && path[1] === "account") {
      if (path.length === 2 && method === "GET") return json(await store.accountStatus());
      if (path.length === 2 && method === "PUT") {
        const { denied, account } = await gate("manager");
        if (denied) return denied;
        if (!account) return fail("Sign in with the account to change it", 403);
        const { value, invalid } = await body(request, AccountUpdateBody);
        if (invalid) return invalid;
        try {
          const updated = await store.updateAccount(account.id, value);
          return updated ? json(updated) : fail("Wrong password", 401);
        } catch (error) {
          return fail(error.message);
        }
      }
      if (path.length === 3 && path[2] === "sign-out" && method === "POST") {
        const { denied } = await gate("kitchen");
        if (denied) return denied;
        await store.signOut(request.headers.get("x-admin-token"));
        return new Response(null, { status: 204, headers: SECURITY_HEADERS });
      }
      if (path.length === 3 && method === "POST" && ["register", "sign-in", "recover"].includes(path[2])) {
        const throttle = authThrottle(ctx);
        if (throttle.denied) return throttle.denied;
        if (path[2] === "sign-in") {
          const { value, invalid } = await body(request, AccountSignInBody);
          if (invalid) return invalid;
          const budget = await guessBudget(ctx, "account", value.login);
          if (budget.denied) return budget.denied;
          const session = await store.signInAccount(value.login, value.password);
          if (!session) {
            throttle.fail();
            await budget.fail();
            return fail("Wrong account name or password", 401);
          }
          throttle.pass();
          await budget.pass();
          return json(session);
        }
        if (path[2] === "recover") {
          // ADMIN_TOKEN and only the token — not a live session, which a stolen tablet would carry.
          const expected = tokens.manager;
          if (!expected || !tokenMatches(request.headers.get("x-admin-token"), expected)) {
            throttle.fail();
            return fail("ADMIN_TOKEN required", 401);
          }
          throttle.pass();
        }
        const { value, invalid } = await body(request, path[2] === "register" ? RegisterBody : AccountRecoverBody);
        if (invalid) return invalid;
        try {
          if (path[2] === "recover") return json(await store.recoverAccount(value));
          const session = await store.registerAccount(value);
          return session ? json(session, 201) : fail("This restaurant already has an account: sign in", 409);
        } catch (error) {
          return fail(error.message);
        }
      }
      return fail("Not found", 404);
    }

    if (path[0] === "api" && path[1] === "admin") {
      // The three routes a waiter tablet and the kitchen screen legitimately
      // reach. They are guarded at their own rank, before the manager gate that
      // covers everything below them — which is what keeps the catalogue, and so
      // the menu's prices and allergen declarations, manager-only.
      if (path.length === 3 && path[2] === "session" && method === "GET") {
        const { denied, role, account } = await gate("kitchen");
        return denied || json(account ? { role, account } : { role });
      }
      if (path.length === 4 && path[2] === "tables" && path[3] === "open" && method === "GET") {
        const { denied } = await gate("staff");
        if (denied) return denied;
        return json({ tables: await store.openBillTables() });
      }
      // The floor's view of the room. The entry tokens are not in it — those stay
      // on /api/admin/tables, which is the manager's.
      if (path.length === 4 && path[2] === "tables" && path[3] === "overview" && method === "GET") {
        const { denied } = await gate("staff");
        if (denied) return denied;
        return json({ tables: await store.tablesOverview() });
      }
      // Open a table for its guests to order from their phones (开台), or close it.
      if (path.length === 5 && path[2] === "tables" && path[4] === "ordering" && method === "POST") {
        const { denied, pos } = await gate("staff");
        if (denied) return denied;
        const { value, invalid } = await body(request, TableOrderingBody);
        if (invalid) return invalid;
        try {
          // A table open on a POS is that device's to open or close.
          await store.assertTableFree(path[3], pos?.deviceId ?? null);
          if (value.open) return json({ session: await store.openTable(path[3], pos) });
          await store.closeTable(path[3]);
          return json({ session: null });
        } catch (error) {
          return tableRefusal(error);
        }
      }
      if (path.length === 5 && path[2] === "tables" && path[4] === "lock" && method === "POST") {
        const { denied, pos } = await gate("staff");
        if (denied) return denied;
        try {
          const { value, invalid } = await body(request, TableLockBody);
          if (invalid) return invalid;
          await store.assertTableFree(path[3], pos?.deviceId ?? null);
          const table = await store.setTableLock(path[3], value.locked);
          return table ? json({ table }) : fail("Table not found", 404);
        } catch (error) {
          return tableRefusal(error);
        }
      }
      // The bill is the floor's, not the manager's.
      if (path[2] === "tables" && path.length >= 5 && path[4] === "bill") {
        const { denied } = await gate("staff");
        if (denied) return denied;
        if (path.length === 5 && method === "GET") {
          return json({ bill: await store.billForTable(path[3]) });
        }
        // An interim bill for the guest to read. Paying is a receipt (checkout).
        if (path.length === 6 && path[5] === "print" && method === "POST") {
          const bill = await store.printTableBill(path[3]);
          return bill ? json({ bill }) : fail("Table has nothing left to pay", 409);
        }
      }

      // The register (shared/register.mjs): a sale, the receipts, vouchers.
      if (path.length === 3 && path[2] === "checkout" && method === "POST") {
        const { denied, role, pos } = await gate("staff");
        if (denied) return denied;
        try {
          const { value, invalid } = await body(request, CheckoutBody);
          if (invalid) return invalid;
          return json({ receipt: await store.checkout(value, role, pos) }, 201);
        } catch (error) {
          return fail(error.message, error.code === "TABLE_CLAIMED" ? 409 : 400);
        }
      }
      // A receipt printed again for the guest, marked as a copy (Belegkopie).
      if (path.length === 5 && path[2] === "receipts" && path[4] === "print" && method === "POST") {
        const { denied } = await gate("staff");
        if (denied) return denied;
        return (await store.reprintReceipt(path[3])) ? new Response(null, { status: 204, headers: SECURITY_HEADERS }) : fail("No such receipt", 404);
      }
      if (path[2] === "receipts" && method === "GET" && path.length <= 4) {
        const { denied } = await gate("staff");
        if (denied) return denied;
        if (path.length === 3) return json({ receipts: await store.listReceipts(limit) });
        const receipt = await store.getReceipt(path[3]);
        return receipt ? json({ receipt }) : fail("Receipt not found", 404);
      }
      if (path.length === 4 && path[2] === "vouchers" && method === "GET") {
        const { denied } = await gate("staff");
        if (denied) return denied;
        const voucher = await store.getVoucher(path[3]);
        return voucher ? json({ voucher }) : fail("Voucher not found", 404);
      }
      if (path[2] === "print-jobs") {
        const { denied } = await gate("staff");
        if (denied) return denied;
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

      // A member at the counter: the POS scanned the code on their phone
      // (ZYMEM:<id>, the booking page). Their first visit's bonus, once ever.
      if (path[2] === "members" && path.length === 5 && path[4] === "visit" && method === "POST") {
        const { denied } = await gate("staff");
        if (denied) return denied;
        const visit = await store.reservations.memberVisit(path[3]);
        return visit ? json(visit) : fail("No such member", 404);
      }

      // Table bookings are the floor's: the waiters take them by phone, seat
      // them and mark who never came. Erasing one for good is the manager's.
      if (path[2] === "reservations" && path.length <= 4) {
        const { denied } = await gate(method === "DELETE" ? "manager" : "staff");
        if (denied) return denied;
        const reservations = store.reservations;
        try {
          if (path.length === 3 && method === "GET") {
            return json(await reservations.list(url.searchParams.get("from") ?? "", url.searchParams.get("to") ?? "", { q: url.searchParams.get("q") ?? "", status: url.searchParams.get("status") ?? "" }));
          }
          if (path.length === 3 && method === "POST") {
            const { value, invalid } = await body(request, StaffReservationBody);
            if (invalid) return invalid;
            return json(await reservations.create(value, { staff: true }), 201);
          }
          if (path.length === 4 && method === "PATCH") {
            const { value, invalid } = await body(request, ReservationUpdateBody);
            if (invalid) return invalid;
            const reservation = await reservations.update(path[3], value);
            return reservation ? json({ reservation }) : fail("Booking not found", 404);
          }
          if (path.length === 4 && method === "DELETE") {
            return (await reservations.remove(path[3])) ? new Response(null, { status: 204, headers: SECURITY_HEADERS }) : fail("Booking not found", 404);
          }
        } catch (error) {
          return reservationRefusal(error);
        }
        return fail("Not found", 404);
      }

      /**
       * The delivery platforms' orders are the floor's: accept (the kitchen
       * gets its tickets), reject, ready, handed over; and the platform told
       * each time. Which platforms are connected, and a made-up order to try
       * the whole path with, are the manager's.
       */
      /**
       * Mail (shared/mail.mjs): whether it goes out and from whom, and a test
       * message to the owner's own address. The outbox is the tests' inbox.
       */
      if (path[2] === "mail") {
        const { denied } = await gate("manager");
        if (denied) return denied;
        if (path.length === 3 && method === "GET") return json(mailStatus(mail));
        if (path.length === 4 && path[3] === "test" && method === "POST") {
          const { value, invalid } = await body(request, MailTestBody);
          if (invalid) return invalid;
          if (!mail) return json({ error: "Mail is not set up", code: "VERIFICATION_OFF" }, 409);
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.to)) return fail("That is not an email address");
          const settings = await store.getSettings();
          return (await sendMail({ to: value.to.trim(), ...testMessage({ language: value.language, restaurant: settings.restaurantName }) }))
            ? json({ sent: true })
            : json({ error: "The email could not be sent — check the Brevo key, the sender and the authorised IPs", code: "MAIL_FAILED" }, 502);
        }
        if (path.length === 4 && path[3] === "outbox" && method === "GET") {
          if (mail?.provider !== "outbox") return fail("Not found", 404);
          return json({ messages: await store.customers.outbox(limit) });
        }
        return fail("Not found", 404);
      }

      if (path[2] === "delivery") {
        const manager = path[3] === "status" || path[3] === "test";
        // The kitchen screen sees what it cooks and says when it is ready; nothing else.
        const kitchen = (path.length === 4 && path[3] === "kitchen" && method === "GET") || (path.length === 6 && path[3] === "orders" && path[5] === "ready" && method === "POST");
        const { denied } = await gate(manager ? "manager" : kitchen ? "kitchen" : "staff");
        if (denied) return denied;
        try {
          if (path.length === 4 && path[3] === "kitchen" && method === "GET") return json({ orders: await store.delivery.kitchen() });
          if (path.length === 4 && path[3] === "orders" && method === "GET") {
            return json(await store.delivery.list(url.searchParams.get("from") ?? "", url.searchParams.get("to") ?? "", { provider: url.searchParams.get("provider") ?? "", status: url.searchParams.get("status") ?? "" }));
          }
          if (path.length === 6 && path[3] === "orders" && method === "POST") {
            const action = path[5];
            const { value, invalid } = await body(request, DeliveryActionBody);
            if (invalid) return invalid;
            if (action === "resend") {
              const order = await store.delivery.get(path[4]);
              if (!order) return fail("Order not found", 404);
              const step = LAST_TOLD[order.status];
              if (!step) return fail("Nothing to tell the platform", 409);
              return json({ order: await tellPlatform(order, step, { prepMinutes: order.prepMinutes ?? 20, reason: order.rejectReason ?? "OTHER" }) });
            }
            if (!["accept", "reject", "ready", "complete"].includes(action)) return fail("Not found", 404);
            const done = await store.delivery.act(path[4], action, value);
            if (!done) return fail("Order not found", 404);
            if (action === "complete") return json({ order: done.order });
            return json({ order: await tellPlatform(done.order, action, { prepMinutes: done.order.prepMinutes ?? 20, reason: done.order.rejectReason ?? "OTHER" }) });
          }
          if (path.length === 4 && path[3] === "status" && method === "GET") {
            const settings = (await store.getSettings()).delivery;
            return json({
              providers: DELIVERY_PROVIDER_IDS.map((id) => ({
                id,
                name: DELIVERY_PROVIDERS[id].name,
                ...settings[id],
                // Whether this deployment holds the platform's secrets; never the secrets.
                webhook: Boolean(delivery[id]?.webhookSecret),
                api: id === "foodora" ? Boolean(delivery[id]?.username && delivery[id]?.password) : Boolean(delivery[id]?.apiKey),
                ordersPath: `/api/delivery/${id}/orders`,
                eventsPath: `/api/delivery/${id}/events`
              }))
            });
          }
          if (path.length === 5 && path[3] === "test" && method === "POST") {
            if (!DELIVERY_PROVIDERS[path[4]]) return fail("Not found", 404);
            const dishes = (await store.listProducts(true)).slice(0, 2);
            // The platform's own shape, through the same path: the owner sees the ticket, the POS and the report before going live.
            const received = await store.delivery.receive(path[4], sampleOrder(path[4], dishes.map((dish) => ({ sku: dish.sku, name_de: dish.names.de, price_cents: Math.round(dish.price * 100) }))), { simulate: true });
            return json({ order: received.order }, 201);
          }
        } catch (error) {
          return deliveryRefusal(error);
        }
        return fail("Not found", 404);
      }

      const { denied, role, pos } = await gate("manager");
      if (denied) return denied;

      // A storno, the day's closing and the journal are the manager's.
      if (path.length === 5 && path[2] === "receipts" && path[4] === "storno" && method === "POST") {
        try {
          const { value, invalid } = await body(request, StornoBody);
          if (invalid) return invalid;
          const receipt = await store.stornoReceipt(path[3], value.reason, role, pos);
          return receipt ? json({ receipt }, 201) : fail("Receipt not found", 404);
        } catch (error) {
          return fail(error.message, /already been cancelled/.test(error.message) ? 409 : 400);
        }
      }
      if (path[2] === "day-closings") {
        if (path.length === 4 && path[3] === "preview" && method === "GET") return json({ totals: await store.closingPreview() });
        if (path.length === 3 && method === "GET") return json({ closings: await store.listClosings(limit) });
        if (path.length === 3 && method === "POST") {
          const closing = await store.closeDay(role);
          return closing ? json({ closing }, 201) : fail("No receipts since the last closing", 409);
        }
      }
      if (path.length === 3 && path[2] === "journal" && method === "GET") {
        const from = url.searchParams.get("from") ?? "";
        const to = url.searchParams.get("to") ?? "";
        if (![from, to].every((day) => /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/.test(day))) return fail("from and to are dates (YYYY-MM-DD) or ISO times");
        return json(await store.exportJournal(from, to));
      }

      // Guests' accounts, the manager's side: look a guest up, change their
      // points with a reason, set a new password, remove the account.
      // The sales report over the manager's days: GET /api/admin/reports/sales?from=YYYY-MM-DD&to=YYYY-MM-DD
      if (path.length === 4 && path[2] === "reports" && path[3] === "sales" && method === "GET") {
        try {
          return json({ report: await store.salesReport(url.searchParams.get("from"), url.searchParams.get("to")) });
        } catch (error) {
          return coded(error);
        }
      }
      if (path[2] === "customers") {
        const customers = store.customers;
        try {
          if (path.length === 3 && method === "GET") return json({ customers: await customers.list(url.searchParams.get("q") ?? "", limit) });
          const id = path[3] ? path[3] : "";
          if (path.length === 4 && method === "GET") {
            const found = await customers.get(id);
            return found ? json(found) : fail("Guest not found", 404);
          }
          if (path.length === 4 && method === "DELETE") return (await customers.remove(id)) ? new Response(null, { status: 204, headers: SECURITY_HEADERS }) : fail("Guest not found", 404);
          if (path.length === 5 && path[4] === "export" && method === "GET") return customerExport(id);
          if (path.length === 5 && path[4] === "points" && method === "POST") {
            const { value, invalid } = await body(request, PointsAdjustBody);
            if (invalid) return invalid;
            const customer = await customers.adjustPoints(id, value);
            return customer ? json({ customer }) : fail("Guest not found", 404);
          }
          if (path.length === 5 && path[4] === "password" && method === "POST") {
            const { value, invalid } = await body(request, CustomerPasswordBody);
            if (invalid) return invalid;
            const customer = await customers.resetPassword(id, value.password);
            return customer ? json({ customer }) : fail("Guest not found", 404);
          }
        } catch (error) {
          return coded(error);
        }
      }

      // The waiters and the devices the POS runs on.
      if (path.length === 4 && path[2] === "staff" && path[3] === "activity" && method === "GET") {
        return json({ staff: await store.staffActivity() });
      }
      if (path[2] === "staff") {
        try {
          if (path.length === 3 && method === "GET") return json({ staff: await store.listStaff() });
          const { value, invalid } = await body(request, StaffBody);
          if (invalid) return invalid;
          if (path.length === 3 && method === "POST") return json({ staff: await store.saveStaff(value) }, 201);
          if (path.length === 4 && method === "PUT") {
            const staff = await store.saveStaff(value, path[3]);
            return staff ? json({ staff }) : fail("Waiter not found", 404);
          }
        } catch (error) {
          return fail(error.message);
        }
      }
      if (path[2] === "pos-devices") {
        try {
          if (path.length === 3 && method === "GET") return json({ devices: await store.listDevices() });
          if (path.length === 3 && method === "POST") {
            const { value, invalid } = await body(request, DeviceBody);
            if (invalid) return invalid;
            return json(await store.pairDevice(value.name), 201);
          }
          if (path.length === 4 && method === "DELETE") return (await store.deleteDevice(path[3])) ? new Response(null, { status: 204 }) : fail("Device not found", 404);
        } catch (error) {
          return fail(error.message);
        }
      }

      // /api/admin/audit
      if (path.length === 3 && path[2] === "audit" && method === "GET") {
        return json({ entries: await store.listAudit(limit) });
      }

      // /api/admin/tables[/:table]
      if (path[2] === "tables") {
        if (path.length === 3 && method === "GET") return json({ tables: await store.listTables() });
        if (path.length === 4 && path[3] === "numbered" && method === "POST") {
          const { value, invalid } = await body(request, NumberedTablesBody);
          if (invalid) return invalid;
          return json(await store.registerNumberedTables(value.count), 201);
        }
        if (path.length === 3 && method === "POST") {
          try {
            const { value, invalid } = await body(request, TableBody);
            if (invalid) return invalid;
            return json({ table: await store.saveTable(value) }, 201);
          } catch (error) {
            return fail(error.message);
          }
        }
        // Another number or label. The number waits until nobody is at the table.
        if (path.length === 4 && method === "PATCH") {
          try {
            const { value, invalid } = await body(request, TableRenameBody);
            if (invalid) return invalid;
            const table = await store.renameTable(path[3], value);
            return table ? json({ table }) : fail("Table not found", 404);
          } catch (error) {
            return tableRefusal(error);
          }
        }
        if (path.length === 4 && method === "DELETE") {
          try {
            return (await store.deleteTable(path[3]))
              ? new Response(null, { status: 204, headers: SECURITY_HEADERS })
              : fail("Table not found", 404);
          } catch (error) {
            return tableRefusal(error);
          }
        }
      }

      // /api/admin/categories/rename: a category's dishes under another name.
      if (path.length === 4 && path[2] === "categories" && path[3] === "rename" && method === "POST") {
        try {
          const { value, invalid } = await body(request, CategoryRenameBody);
          if (invalid) return invalid;
          const result = await store.renameCategory(value.from, value.to);
          return result ? json(result) : fail("No dish is in that category", 404);
        } catch (error) {
          return fail(error.message);
        }
      }

      // /api/admin/categories/vat: every dish of a category at one rate.
      if (path.length === 4 && path[2] === "categories" && path[3] === "vat" && method === "POST") {
        try {
          const { value, invalid } = await body(request, CategoryVatBody);
          if (invalid) return invalid;
          const result = await store.setCategoryVat(value.category, value.vatPercent);
          return result ? json(result) : fail("No dish is in that category", 404);
        } catch (error) {
          return fail(error.message);
        }
      }

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
        if (path.length === 5 && path[4] === "stock" && method === "PUT") {
          try {
            const { value, invalid } = await body(request, StockBody);
            if (invalid) return invalid;
            const product = await store.setStock(path[3], value);
            return product ? json({ product }) : fail("Product not found", 404);
          } catch (error) {
            return coded(error);
          }
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
        if (path.length === 5 && path[4] === "duplicate" && method === "POST") {
          const product = await store.duplicateProduct(path[3]);
          return product ? json({ product }, 201) : fail("Product not found", 404);
        }
        if (path.length === 5 && path[4] === "media" && method === "POST") {
          let file;
          try {
            file = (await request.formData()).get("file");
          } catch {
            return fail("Media file is required");
          }
          if (!file || typeof file === "string") return fail("Media file is required");
          // Where the picture goes is the host's: the Worker keeps it in the
          // database, the Node server on disk (and takes videos too).
          const saved = await uploads(path[3], file);
          if (saved.error) return fail(saved.error, saved.status ?? 400);
          return saved.product ? json({ product: saved.product }, 201) : fail("Product not found", 404);
        }
      }

      // /api/admin/printers[/:id]
      if (path[2] === "printers") {
        if (path.length === 3 && method === "GET") {
          // The printers, what the bridge last found at each, the bridges themselves and what is waiting.
          const [printers, bridges, queue, discovered] = await Promise.all([store.listPrinters(), store.listPrintBridges(), store.printQueue(), store.listDiscoveredPrinters()]);
          return json({ printers, bridges, queue, discovered });
        }
        if (path.length === 5 && path[4] === "test" && method === "POST") {
          const queued = await store.queueTestPrint(path[3]);
          return queued ? json(queued, 201) : fail("Printer not found", 404);
        }
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

      if (path[2] === "printer-for-role" && path.length === 4 && method === "GET") {
        return json({ printer: await store.printerForRole(path[3]) });
      }

      // /api/admin/app-icons[/:app]: the installed apps' icons (shared/app-icons.mjs).
      if (path[2] === "app-icons") {
        if (path.length === 3 && method === "GET") return json({ icons: await store.appIcons() });
        if (path.length === 4 && !ICON_APPS.includes(path[3])) return fail("No such app", 404);
        if (path.length === 4 && method === "DELETE") return json({ icons: await store.resetAppIcon(path[3]) });
        if (path.length === 4 && method === "PUT") {
          let form;
          try {
            form = await request.formData();
          } catch {
            return fail("The icon's pictures are required");
          }
          const files = {};
          for (const size of ICON_SIZES) {
            const file = form.get(size.field);
            if (!file || typeof file === "string") return json({ error: `The ${size.pixels} × ${size.pixels} picture is missing`, code: "ICON_MISSING", field: size.field }, 400);
            if (file.size > MAX_ICON_BYTES) return json({ error: "An icon picture exceeds 1 MB", code: "ICON_TOO_BIG" }, 413);
            const bytes = new Uint8Array(await file.arrayBuffer());
            if (!isPng(bytes)) return json({ error: "An icon picture has to be a PNG", code: "ICON_NOT_PNG" }, 400);
            files[size.file] = bytes;
          }
          return json({ icons: await store.saveAppIcon(path[3], files) });
        }
      }

      // /api/admin/settings
      if (path.length === 3 && path[2] === "settings" && method === "GET") {
        return json(await store.getSettings());
      }
      if (path.length === 3 && path[2] === "settings" && method === "PUT") {
        try {
          const { value, invalid } = await body(request, SettingsBody);
          if (invalid) return invalid;
          return json(await store.saveSettings(value));
        } catch (error) {
          return fail(error.message);
        }
      }
    }

    if (path[0] === "api") return fail("API route not found", 404);

    // Pictures kept in the database. The id carries a hash (seeded photos) or is
    // a fresh uuid (uploads), so a URL never changes what it points at. One the
    // database does not have is the host's to look for (the Node server's disk).
    if (path[0] === "media" && path.length === 2 && (method === "GET" || method === "HEAD")) {
      const media = await store.getMediaFile(path[1]);
      if (!media) return null;
      return new Response(method === "HEAD" ? null : media.bytes, {
        headers: {
          ...SECURITY_HEADERS,
          "content-type": media.contentType,
          "cache-control": "public, max-age=31536000, immutable",
          "content-security-policy": "default-src 'none'; sandbox"
        }
      });
    }

    // The installed apps' icons and manifests: the owner's own when there is
    // one, otherwise the built files (null: the host's to serve).
    const icon = (method === "GET" || method === "HEAD") ? iconRequest(url.pathname) : null;
    if (icon) {
      const iconHeaders = { ...SECURITY_HEADERS, "cache-control": "no-cache", "content-security-policy": "default-src 'none'; img-src data:; sandbox" };
      if (icon.kind === "manifest") {
        const [stored, settings] = await Promise.all([store.storedAppIcons(), icon.app === "menu" ? store.getSettings() : null]);
        const manifest = servedManifest(icon.app, { version: stored[icon.app]?.version, name: settings?.restaurantName });
        if (!manifest) return null;
        return new Response(method === "HEAD" ? null : JSON.stringify(manifest), { headers: { ...iconHeaders, "content-type": "application/manifest+json; charset=utf-8" } });
      }
      const picture = await store.appIconFile(icon.app, icon.kind === "svg" ? "192" : icon.file);
      if (!picture) return null;
      const svg = icon.kind === "svg";
      return new Response(method === "HEAD" ? null : (svg ? svgHoldingPng(picture.bytes) : picture.bytes), { headers: { ...iconHeaders, "content-type": svg ? "image/svg+xml" : "image/png" } });
    }

    // Anything else is the web app, the host's to serve.
    return null;
  }

  /**
   * The request answered, and what follows a write: the live channel told
   * (shared/live.mjs) and a staff write recorded in the audit log. An error
   * nobody planned for is a 500 that says nothing about the inside.
   */
  return async function serve(request, { ip = "", requestId = "" } = {}) {
    const ctx = { ip, requestId, role: null, audited: false };
    const url = new URL(request.url);
    const writing = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    // The body a write names its table and business fields in, read once.
    let sent = {};
    if (writing && request.headers.get("content-type")?.includes("application/json")) {
      try { sent = (await request.clone().json()) ?? {}; } catch { sent = {}; }
    }
    let response;
    try {
      response = await handle(request, ctx);
    } catch (error) {
      // One line a log search can find by the id the caller was given.
      console.error(JSON.stringify({ level: "error", msg: "request failed", requestId, method: request.method, path: url.pathname, error: String(error?.message ?? error), stack: error?.stack }));
      response = json({ error: "Internal server error", ...(requestId ? { requestId } : {}) }, 500);
    }
    if (!response || !writing || QUIET.has(response)) return response;
    const event = liveEvent(request.method, url.pathname, response.status, sent?.table);
    if (event) {
      try { await publish(event); } catch { /* The next poll catches up. */ }
    }
    if (ctx.role && !ctx.audited) {
      const detail = {};
      const fields = url.pathname.startsWith("/api/admin/reservations") ? RESERVATION_AUDIT_FIELDS : AUDIT_FIELDS;
      for (const field of fields) if (sent && typeof sent === "object" && sent[field] !== undefined) detail[field] = sent[field];
      try {
        await store.recordAudit({ role: ctx.role, ip, method: request.method, route: url.pathname, status: response.status, detail });
      } catch (error) {
        console.error("audit write failed", error);
      }
    }
    return response;
  };
}

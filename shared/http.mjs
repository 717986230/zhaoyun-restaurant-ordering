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
import {
  CategoryRenameBody, CategoryVatBody, CheckoutBody, EmailCodeBody, EmailVerifyBody, MailTestBody, CreateOrderBody, StornoBody, StaffBody, DeviceBody, PosSignInBody, MoveTableBody, SettlementBody, DrawerOpenBody, DrawerMoveBody, DrawerCloseBody, OrderStatusBody, PrinterBody, ProductBody, ServiceRequestBody, ServiceStatusBody,
  SettingsBody, TableBody, TableLockBody, RegisterBody, AccountSignInBody, AccountUpdateBody, AccountRecoverBody, VoidBody, UrgeBody, FireBody, AvailabilityBody,
  GuestOrderBody, CustomerRegisterBody, CustomerSignInBody, CustomerUpdateBody, CustomerDeleteBody, BirthdayBody, PointsAdjustBody, BalanceAdjustBody, TopUpBody, CustomerPasswordBody, TableOrderingBody,
  PrintBridgeClaimBody, PrintBridgeDoneBody, PrintBridgeFailBody, PrintBridgeReportBody, NumberedTablesBody, LetteredTablesBody, TableRenameBody, ClientErrorBody,
  ReservationBody, ReservationLookupBody, StaffReservationBody, ReservationUpdateBody, WaitlistBody, WaitlistUpdateBody, DeliveryActionBody, StockBody,
  InviteBody, SetPasswordBody, ForgotPasswordBody, OwnerPasswordBody, TenantBody
} from "../src/contracts.js";
import {
  SECURITY_HEADERS, body, coded, deliveryRefusal, fail, json, platformEvent,
  reservationRefusal, segments, tableRefusal, tokenMatches
} from "./http-response.mjs";

export { SECURITY_HEADERS, body, coded, deliveryRefusal, fail, json, platformEvent, reservationRefusal, segments, tableRefusal, tokenMatches } from "./http-response.mjs";
import { alertMessage, birthdayMessage, bookingMessage, codeMessage, createMailer, inviteMessage, mailStatus, resetMessage, testMessage, waitlistReadyMessage } from "./mail.mjs";
import { DEFAULT_TENANT_ID } from "./tenant.mjs";
import { isPhoneLogin, localDayIn } from "./customer.mjs";
import { EMAIL_CODE_RESEND_MS, EMAIL_CODE_TTL_MS, maskEmail } from "./email-verify.mjs";
import { DELIVERY_PROVIDER_IDS, DELIVERY_PROVIDERS, foodoraLoginRequest, outboundRequest, sampleOrder, webhookAuthentic } from "./delivery.mjs";
import { auditActor, resolveStaffRole, roleAllows } from "./auth.mjs";
import { customerAccountsOn, menuSettingsView } from "./settings.mjs";
import { restaurantDay } from "./stock.mjs";
import { liveEvent } from "./live.mjs";
import { ICON_APPS, ICON_SIZES, iconRequest, isPng, servedManifest, MAX_ICON_BYTES, svgHoldingPng } from "./app-icons.mjs";
import { createRateLimiter } from "./rate-limit.mjs";

const TABLE_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,7}$/;

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
// At most one owner alert per this long, so a burst of 500s is one email, not
// a flood. Kept per isolate, so several isolates may each send one — still few.
const ALERT_COOLDOWN_MS = 10 * 60_000;

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
    // Looking a booking up by its number needs a matching phone or email too, so
    // the number alone reveals nothing; a tight limit stops a script trying many.
    reservationLookupLimiter: createRateLimiter({ windowMs: publicWindowMs, max: 10 }),
    // Email codes from one address: each account has its own limits too (shared/email-verify.mjs).
    mailLimiter: createRateLimiter({ windowMs: publicWindowMs, max: 10 }),
    // Guest sign-ups from one address in ten minutes: a full dining room on
    // the restaurant's Wi-Fi, not a script making accounts for their points.
    registerLimiter: createRateLimiter({ windowMs: 10 * 60_000, max: 40 }),
    // When the owner was last told about an unplanned error, so the cooldown
    // above holds across requests (ALERT_COOLDOWN_MS).
    errorAlert: { lastSentAt: 0 },
    // The built /api/catalog body per tenant, kept between requests so the many
    // guests browsing one isolate share one build. Valid while the store's menu
    // stamp and the restaurant day are unchanged; see the /api/catalog route.
    catalogBodies: new Map()
  };
}

// A cached catalog body may outlive, by this long, a change made in another
// isolate (a menu edit a guest's live channel already tells them to refetch).
const CATALOG_BODY_TTL_MS = 10_000;

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
export function createApi({ store, tokens = {}, state = createApiState(), uploads, publish = () => {}, realtimeClients, version = null, delivery = {}, mail = null, ownerAlertEmail = null, defer = (task) => { Promise.resolve(task).catch(() => {}); }, fetch: send = (...args) => fetch(...args) }) {
  const options = { realtimeClients, version };
  // foodora's bearer token, kept between calls until it runs out (per isolate on a Worker).
  const platformTokens = new Map();

  /**
   * Tells the platform what the floor did with its order (shared/delivery.mjs,
   * outboundRequest), and keeps what came of it on the order, where the POS
   * shows it and can send it again. A test order, or a platform whose API
   * access is not configured, has nothing to tell: `sync.status` "none".
   */
  async function tellPlatform(db, order, action, extra = {}) {
    const credentials = { ...(delivery[order.provider] ?? {}) };
    if (order.test) return db.delivery.recordSync(order.id, { ok: null });
    try {
      if (order.provider === "foodora") {
        const cached = platformTokens.get("foodora");
        if (cached && cached.expires > Date.now()) credentials.accessToken = cached.token;
        else {
          const login = foodoraLoginRequest(credentials);
          if (login) {
            const response = await send(login.url, { method: login.method, headers: login.headers, body: login.body, signal: AbortSignal.timeout(8000) });
            if (!response.ok) return db.delivery.recordSync(order.id, { ok: false, error: `Sign-in HTTP ${response.status}` });
            const signedIn = await response.json().catch(() => ({}));
            const token = signedIn.access_token ?? signedIn.accessToken;
            if (!token) return db.delivery.recordSync(order.id, { ok: false, error: "Sign-in gave no token" });
            platformTokens.set("foodora", { token, expires: Date.now() + Math.max(60, Number(signedIn.expires_in) || 1800) * 1000 - 60_000 });
            credentials.accessToken = token;
          }
        }
      }
      const call = outboundRequest(order, action, credentials, extra);
      if (!call) return db.delivery.recordSync(order.id, { ok: null });
      const response = await send(call.url, { method: call.method, headers: call.headers, body: JSON.stringify(call.body), signal: AbortSignal.timeout(8000) });
      if (response.status === 401) platformTokens.delete(order.provider);
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 200);
        return db.delivery.recordSync(order.id, { ok: false, error: `HTTP ${response.status}${detail ? `: ${detail}` : ""}` });
      }
      return db.delivery.recordSync(order.id, { ok: true });
    } catch (error) {
      return db.delivery.recordSync(order.id, { ok: false, error: String(error?.message ?? error) });
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
  function throttlePublic(limiter, ctx, message) {
    const { allowed, retryAfter } = limiter.check(ctx.ip || "unknown");
    return allowed ? null : json({ error: message, retryAfter }, 429, { "retry-after": String(retryAfter) });
  }

  /**
   * An unplanned error just became a 500. Tell the owner, best-effort: only
   * when this deployment can send mail (Brevo) and has an address to send to
   * (OWNER_ALERT_EMAIL), and at most once per cooldown (ALERT_COOLDOWN_MS) so a
   * burst is one email. Never throws — the request already failed, and the
   * telling of it must not fail the host's request lifecycle in turn.
   */
  async function alertOwner(db, detail) {
    if (!mail || !ownerAlertEmail) return;
    const now = Date.now();
    if (now - state.errorAlert.lastSentAt < ALERT_COOLDOWN_MS) return;
    state.errorAlert.lastSentAt = now;
    try {
      let restaurant = "";
      // The settings read may itself be what failed; the alert goes out regardless.
      try { restaurant = (await db.getSettings()).restaurantName; } catch { /* no name, still send */ }
      const mailer = createMailer({ mail, store: db, send });
      await mailer({ to: ownerAlertEmail, ...alertMessage({ ...detail, restaurant }) });
    } catch (error) {
      console.error(JSON.stringify({ level: "error", msg: "owner alert not sent", error: String(error?.message ?? error) }));
    }
  }

  /**
   * Authenticate, then check rank. The header carries a session token (the
   * restaurant's account, or a waiter on a POS device) or one of the
   * configured tokens. Returns `{ role, pos, account, via }` to go on, or
   * `{ denied }`, so a caller cannot forget to check. `via` says how the
   * role was granted — the owner gate needs it, to tell the platform owner's
   * own login apart from a shared manager token or a waiter's session.
   */
  async function requireRole(db, request, ctx, minimumRole) {
    const throttle = authThrottle(ctx);
    if (throttle.denied) return throttle;
    const provided = request.headers.get("x-admin-token");
    const session = await db.roleForSession(provided);
    // A session that belongs to another tenant is not this tenant's session,
    // even when it was good enough to resolve the tenant: the tenant came
    // from a different token, or the session expired between the two reads.
    if (session?.tenantId && session.tenantId !== ctx.tenantId) {
      throttle.fail();
      return { denied: json({ error: "Admin authentication required" }, 401) };
    }
    const via = session ? (session.account ? "account" : session.staff ? "pos" : "tenant-token") : "env-token";
    const role = session?.role ?? resolveStaffRole((token) => tokenMatches(provided, token), tokens);
    if (!role) {
      // Nothing configured that could ever grant one: say so, rather than
      // counting a failure against a caller who had no way to succeed.
      if (!tokens.manager && !(await db.accountStatus()).registered) {
        return { denied: fail("Register the restaurant's account on the admin console, or configure ADMIN_TOKEN", 503) };
      }
      throttle.fail();
      return { denied: json({ error: "Admin authentication required" }, 401) };
    }
    throttle.pass();
    ctx.role = role;
    // A waiter's session carries who they are and which device they are on.
    const pos = session?.staff ? { staff: session.staff, deviceId: session.deviceId } : null;
    // Who did it, by name, so the audit log traces a POS action to the person,
    // not just to the shared role token the whole floor signs in with.
    ctx.staff = pos?.staff ?? null;
    if (!roleAllows(role, minimumRole)) {
      // A valid token used beyond its role is worth recording, not just refusing.
      ctx.audited = true;
      const url = new URL(request.url);
      await db.recordAudit({ role, ip: ctx.ip ?? "", method: request.method, route: url.pathname + url.search, status: 403, detail: { denied: minimumRole, ...auditActor(ctx.staff) } });
      return { denied: json({ error: `This role may not perform ${minimumRole} actions` }, 403) };
    }
    return { role, pos, account: session?.account ?? null, via };
  }

  /**
   * The table gate. Until a restaurant registers its first table the app runs
   * in open mode, so a fresh install works before anything is set up. Once
   * tables exist, a guest's order or call names one of them and carries the
   * token printed on its card. The table is upper-cased in place: that is
   * what is stored and what the bill is grouped by.
   */
  async function refuseUnknownTable(db, request, command) {
    const table = String(command.table ?? "").trim().toUpperCase();
    // Validated even in open mode: a table that cannot be registered later
    // would otherwise be accepted now and become unbillable.
    if (!TABLE_PATTERN.test(table)) return fail("Table number must be 1-8 letters or digits");
    command.table = table;
    if (!await db.hasTables()) return null;
    const registered = await db.getTable(table);
    if (!registered || !registered.enabled) return json({ error: "Unknown table" }, 403);
    if (!tokenMatches(request.headers.get("x-table-token"), registered.token)) return json({ error: "Table token is invalid" }, 403);
    return null;
  }

  /**
   * Which restaurant this request belongs to, resolved before the store is
   * scoped to it. A credential that names the tenant wins, in the order the
   * store knows them (shared/store.mjs, resolveTenant); then a slug on the
   * query or header; then the env tokens, which belong to the default tenant
   * only; then the single-tenant fallback, which keeps today's
   * single-restaurant deployments working without any token. A request that
   * names no tenant at all resolves to the default tenant (the store fails
   * closed to it), never to everything.
   */
  async function resolveRequestTenant(request) {
    const url = new URL(request.url);
    const headers = request.headers;
    // A minimal store (a test double, or a deployment predating tenants)
    // has none of these: it is the single default tenant, and nothing here
    // may fail for that. A real store always has them.
    const tenant = typeof store.resolveTenant === "function"
      ? await store.resolveTenant({
          adminToken: headers.get("x-admin-token"),
          deviceToken: headers.get("x-device-token"),
          tableToken: headers.get("x-table-token"),
          customerToken: headers.get("x-customer-token"),
          reservationToken: headers.get("x-reservation-token"),
          slug: url.searchParams.get("restaurant") ?? headers.get("x-restaurant"),
        })
      : null;
    if (tenant) return tenant;
    if (resolveStaffRole((token) => tokenMatches(headers.get("x-admin-token"), token), tokens)) return DEFAULT_TENANT_ID;
    const tenants = typeof store.listTenants === "function" ? await store.listTenants() : [];
    if (tenants.length === 1) return tenants[0].id;
    return null;
  }

  /**
   * The drinks the cart offers while it has none: the owner's picks, else the
   * best sellers of the last month, else the first drinks on the menu; only
   * what a guest can order now. Nothing when switched off.
   */
  function cartSuggestionsFor(suggestions, products, bestSellers) {
    if (!suggestions?.enabled) return {};
    const orderable = new Map(products.filter((product) => product.kind === "drink" && !product.bundleItems?.length).map((product) => [product.id, product]));
    if (suggestions.productIds.length) {
      const picked = suggestions.productIds.filter((id) => orderable.has(id));
      return picked.length ? { suggestions: picked } : {};
    }
    // Three: the best sellers first, topped up from the menu's own order.
    const ids = [...new Set([...bestSellers.filter((id) => orderable.has(id)), ...orderable.keys()])].slice(0, 3);
    return ids.length ? { suggestions: ids } : {};
  }

  /** Responses that changed nothing anyone watches (a POS keeping its table): no live event, no audit. */
  const QUIET = new WeakSet();
  const quiet = (response) => {
    QUIET.add(response);
    return response;
  };

  async function handle(request, ctx, db) {
    // The store for this request's tenant (serve resolved it): every query
    // below reads and writes that restaurant only. `db` shadows the outer
    // store for the whole dispatch, so a helper that forgets its store
    // argument cannot touch another tenant's rows.
    const store = db;
    // One email (shared/mail.mjs): through Brevo, or into the outbox for
    // the tests — recorded under this tenant, like everything else here.
    const sendMail = createMailer({ mail, store, send });
    const url = new URL(request.url);
    const path = segments(url.pathname);
    const method = request.method;
    const limit = url.searchParams.get("limit") ?? undefined;

    const gate = (minimumRole) => requireRole(store, request, ctx, minimumRole);
    // The platform owner only: the account whose role is 'owner', or the
    // deployment's own manager token (the owner's own credential). A tenant
    // admin, a tenant role token, or a waiter's session is a manager of one
    // restaurant, not the owner of the platform.
    const gateOwner = async () => {
      const { denied, role, account, via } = await gate("manager");
      if (denied) return { denied };
      if (account?.role === "owner" || via === "env-token") return { role, account };
      return { denied: fail("Only the platform owner", 403) };
    };

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
      // The whole built body is the same for every guest of one restaurant and
      // changes only when the menu, the stock or the sales do — so it is cached
      // and served without rebuilding (no stock read, no 100-dish map, no
      // re-serialize) while the store's stamp and the restaurant day hold.
      const stamp = typeof store.menuStamp === "function" ? store.menuStamp() : null;
      const today = settings.timeZone ? restaurantDay(settings.timeZone) : null;
      const cacheKey = ctx.tenantId;
      if (stamp) {
        const hit = state.catalogBodies.get(cacheKey);
        if (hit && hit.menu === stamp.menu && hit.dyn === stamp.dyn && hit.today === today && Date.now() - hit.at < CATALOG_BODY_TTL_MS) {
          return new Response(hit.body, { status: 200, headers: { "content-type": "application/json; charset=utf-8", ...SECURITY_HEADERS } });
        }
      }
      const suggestions = settings.cartSuggestions;
      const [products, bestSellers] = await Promise.all([
        store.listProducts(true, settings.timeZone),
        suggestions?.enabled && !suggestions.productIds.length ? store.topDrinks(30, 3) : []
      ]);
      const payload = { products, theme: settings.menuTheme, languages: settings.menuLanguages, menu: { ...menuSettingsView(settings), ...cartSuggestionsFor(suggestions, products, bestSellers) } };
      const serialized = JSON.stringify(payload);
      if (stamp) state.catalogBodies.set(cacheKey, { menu: stamp.menu, dyn: stamp.dyn, today, at: Date.now(), body: serialized });
      return new Response(serialized, { status: 200, headers: { "content-type": "application/json; charset=utf-8", ...SECURITY_HEADERS } });
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
        const refused = await refuseUnknownTable(store, request, value);
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
        // A booking holds this table: only its guest (checked in, so the table
        // is no longer held) may order on it. A walk-in is turned away.
        if (channel === "dine-in" && order.table) {
          const hold = await store.reservations.holdOn(order.table);
          if (hold) {
            const mine = customer ? await store.reservations.checkIn(order.table, { customerId: customer.id }) : null;
            if (mine) await store.openTable(order.table);
            else return json({ error: `Table ${hold.table} is reserved for ${hold.time}`, code: "TABLE_RESERVED", reserved: { time: hold.time } }, 409);
          }
        }
        return json({ order: await store.placeGuestOrder(order, { channel, payment, customer }) }, 201);
      } catch (error) {
        return coded(error);
      }
    }

    // Whether this table may order yet: the menu says so before the cart is
    // filled, not when it is sent (the table's card token, as for an order).
    if (path[0] === "api" && path[1] === "guest" && path[2] === "tables" && path.length === 4 && method === "GET") {
      const command = { table: decodeURIComponent(path[3]) };
      const refused = await refuseUnknownTable(store, request, command);
      if (refused) return refused;
      const ordering = (await store.getSettings()).guestOrdering;
      // A table a booking holds: the booked guest scanning its code checks
      // themselves in (seated, and the table opened for them to order); anyone
      // else is told it is reserved and may not order on it.
      const hold = await store.reservations.holdOn(command.table);
      if (hold) {
        const customer = await store.customers.session(request.headers.get("x-customer-token"));
        const mine = customer ? await store.reservations.checkIn(command.table, { customerId: customer.id }) : null;
        if (mine) {
          await store.openTable(command.table);
          return json({ table: command.table, open: true, checkedIn: true, reservation: { reference: mine.reference, time: mine.time } });
        }
        return json({ table: command.table, open: false, reserved: { time: hold.time } });
      }
      const open = !ordering?.requireOpenTable || await store.tableOpenForGuests(command.table);
      return json({ table: command.table, open });
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
          const refused = await refuseUnknownTable(store, request, value);
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
        // This tenant first; a member whose email belongs to exactly one
        // other tenant signs in there instead, so a pickup guest who opens
        // the menu without a table token still reaches their account.
        let session = await customers.signIn(value.email, value.password);
        if (!session) {
          const emailTenant = await store.tenantForCustomerEmail(value.email);
          if (emailTenant && emailTenant !== ctx.tenantId) session = await store.withTenant(emailTenant).customers.signIn(value.email, value.password);
        }
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
        // 会员储值: the guest's own balance history (read-only; top-ups happen at the counter).
        // The member's own ledger: their money, not who at the till booked it —
        // the operator is the restaurant's audit trail, kept off the guest's view.
        if (rest === "balance" && method === "GET") return json({ entries: (await customers.balanceHistory(customer.id)).map(({ operator: _operator, ...entry }) => entry) });
        // 生日营销: the member's own birthday (month and day only), to read or set.
        if (rest === "birthday" && method === "GET") return json({ birthday: await customers.birthday(customer.id) });
        if (rest === "birthday" && method === "POST") {
          const { value, invalid } = await body(request, BirthdayBody);
          if (invalid) return invalid;
          if (value.clear) { await customers.clearBirthday(customer.id); return json({ birthday: null }); }
          try {
            return json({ birthday: await customers.setBirthday(customer.id, value) });
          } catch (error) {
            return fail(error.message, 400);
          }
        }
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
          const order = received.autoAccepted ? await tellPlatform(store, received.order, "accept", { prepMinutes: received.order.prepMinutes }) : received.order;
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
        if (path.length === 3 && path[2] === "lookup" && method === "POST") {
          const limited = throttlePublic(state.reservationLookupLimiter, ctx, "Too many lookups from this device");
          if (limited) return limited;
          const { value, invalid } = await body(request, ReservationLookupBody);
          if (invalid) return invalid;
          const found = await reservations.lookup(value.reference, value.contact);
          return found ? json(found, 200, { "cache-control": "no-store" }) : fail("Booking not found", 404);
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
          const created = await reservations.create(value, { customer });
          // The booking is made; the email is a courtesy on top, so a mail
          // hiccup never fails it. The token rides the link's fragment (#t=),
          // which the booking page reads client-side and no server ever sees.
          const booked = created.reservation;
          if (mail && booked?.email && created.token) {
            try {
              const settings = await store.getSettings();
              const manageUrl = `${url.origin}/book.html?r=${encodeURIComponent(booked.id)}#t=${encodeURIComponent(created.token)}`;
              await sendMail({ to: booked.email, ...bookingMessage(booked, { language: booked.language || value.language, restaurant: settings.restaurantName, manageUrl }) });
            } catch (error) {
              console.error(JSON.stringify({ level: "error", msg: "booking mail not sent", error: String(error?.message ?? error) }));
            }
          }
          return json(created, 201);
        }
        const token = request.headers.get("x-reservation-token");
        if (path.length === 3 && method === "GET") {
          const reservation = await reservations.forGuest(path[2], token);
          return reservation ? json({ reservation }, 200, { "cache-control": "no-store" }) : fail("Booking not found", 404);
        }
        if (path.length === 4 && path[3] === "cancel" && method === "POST") {
          const customer = await store.customers.session(request.headers.get("x-customer-token"));
          const cancelledResult = await reservations.cancelForGuest(path[2], token, customer?.id ?? null);
          if (!cancelledResult) return fail("Booking not found", 404);
          // justCancelled is the store's own signal, not part of the guest's view: email once, then drop it.
          const { justCancelled, ...reservation } = cancelledResult;
          // The guest's cancellation notice, a courtesy like the confirmation:
          // a mail hiccup never undoes the cancellation the guest just made.
          if (mail && justCancelled && reservation.email) {
            try {
              const settings = await store.getSettings();
              await sendMail({ to: reservation.email, ...bookingMessage(reservation, { language: reservation.language || "de", restaurant: settings.restaurantName }) });
            } catch (error) {
              console.error(JSON.stringify({ level: "error", msg: "cancellation mail not sent", error: String(error?.message ?? error) }));
            }
          }
          return json({ reservation });
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
          const refused = await refuseUnknownTable(store, request, value);
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
      const claimed = (error) =>
        error.code === "SOLD_OUT" || error.code === "BAD_STOCK"
          ? coded(error)
          : fail(
              error.message,
              error.code === "TABLE_CLAIMED" || error.code === "TABLE_OCCUPIED"
                ? 409
                : 400,
            );
      try {
        if (path.length === 3 && path[2] === "floor" && method === "GET") {
          // `deviceId` is this device's: the tables it has open are its own, the others' are locked to it.
          const floorSettings = await store.getSettings();
          return json({
            tables: await store.tablesOverview(),
            claims: await store.liveClaims(),
            deviceId: pos.deviceId,
            requests: await store.openServiceRequests(),
            // Today's bookings still to come or at the table.
            reservations: await store.reservations.today(),
            // Tables a booking is holding right now (reserved, waiting for the guest).
            held: await store.reservations.heldTables(),
            // Delivery platforms' orders not yet handed over.
            delivery: await store.delivery.open(),
            takeawayDiscountPercent: floorSettings.takeawayDiscountPercent,
            // The SEPA account for the pay-by-transfer GiroCode, if the shop set one.
            sepaPayment: floorSettings.sepaPayment
          });
        }
        if (path.length === 5 && path[2] === "tables" && path[4] === "claim") {
          if (method === "POST") {
            // A POS keeps its table every half minute; only taking it is news.
            const renewing = await store.holdsTable(path[3], pos.deviceId);
            // A table a booking holds is closed to the floor: only a manager may
            // open it over the hold, which checks the booked guest in. A device
            // renewing its own open table is past this.
            if (!renewing) {
              const hold = await store.reservations.holdOn(path[3]);
              if (hold && role !== "manager") return json({ error: `Table ${hold.table} is reserved for ${hold.time}`, code: "TABLE_RESERVED", reservedFor: hold.time }, 409);
              if (hold) await store.reservations.checkIn(path[3], { force: true });
            }
            // `?shared=1` opens the table to several devices at once (多人同桌),
            // `?shared=0` makes it exclusive again, and no flag (the hold
            // heartbeat) keeps whatever mode the table is already in.
            const sharedParam = url.searchParams.get("shared");
            const shared = sharedParam === null ? undefined : sharedParam === "1";
            const response = json({ claim: await store.claimTable(path[3], pos, { shared }) });
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
          const moved = await store.moveTable(path[3], value.to, pos, {
            merge: value.merge === true,
          });
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
        if (path.length === 5 && path[2] === "tables" && path[4] === "urge" && method === "POST") {
          const { value, invalid } = await body(request, UrgeBody);
          if (invalid) return invalid;
          try {
            return json({ urged: await store.urgeItem(path[3], value.orderItemId, pos) }, 201);
          } catch (error) {
            if (error.code === "NOT_FOUND") return fail(error.message, 404);
            throw error;
          }
        }
        if (path.length === 5 && path[2] === "tables" && path[4] === "fire" && method === "POST") {
          const { value, invalid } = await body(request, FireBody);
          if (invalid) return invalid;
          try {
            return json({ fired: await store.fireItem(path[3], value.orderItemId, pos) }, 201);
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
      // The owner's invitation: a new admin for a tenant, who sets their own
      // password through the one-time link. The link reaches the admin by
      // email when mail is configured and an address was given; otherwise
      // the token rides in the response, for the owner to hand over (phase
      // 3's dashboard copies the link from there).
      if (path.length === 3 && path[2] === "invite" && method === "POST") {
        const { denied } = await gateOwner();
        if (denied) return denied;
        const { value, invalid } = await body(request, InviteBody);
        if (invalid) return invalid;
        try {
          const targetTenant = value.tenantId ?? ctx.tenantId;
          const { account, token } = await store.inviteAccount({ tenantId: targetTenant, login: value.login, name: value.name, email: value.email });
          const inviteUrl = `${url.origin}/set-password?token=${token}`;
          // The set-password page is phase 3's; until it exists the link's
          // token is what the owner hands over.
          let emailed = false;
          if (mail && account.email) {
            const target = store.withTenant(targetTenant);
            const settings = await target.getSettings();
            emailed = await createMailer({ mail, store: target, send })({ to: account.email, ...inviteMessage({ language: settings.menuLanguages?.[0] ?? "de", restaurant: settings.restaurantName, url: inviteUrl }) });
          }
          return json({ account, inviteUrl, ...(emailed ? {} : { token }) }, 201);
        } catch (error) {
          return fail(error.message);
        }
      }
      // Spending a one-time link: the token it carries, and the password it sets.
      if (path.length === 3 && path[2] === "set-password" && method === "POST") {
        const throttle = authThrottle(ctx);
        if (throttle.denied) return throttle.denied;
        const { value, invalid } = await body(request, SetPasswordBody);
        if (invalid) return invalid;
        const account = await store.useAccountToken(value.token, { password: value.password });
        if (!account) {
          throttle.fail();
          return fail("This link is invalid or expired", 401);
        }
        throttle.pass();
        return json({ account });
      }
      // A forgotten password: the link goes out by email, or nothing does —
      // the token is never handed to whoever asked, or any login could be
      // taken over by asking. The response is the same either way.
      if (path.length === 3 && path[2] === "forgot-password" && method === "POST") {
        const { value, invalid } = await body(request, ForgotPasswordBody);
        if (invalid) return invalid;
        const result = await store.requestPasswordReset(value.login);
        if (result?.account?.email && mail) {
          const target = store.withTenant(result.account.tenantId);
          const settings = await target.getSettings();
          const resetUrl = `${url.origin}/set-password?token=${result.token}`;
          await createMailer({ mail, store: target, send })({ to: result.account.email, ...resetMessage({ language: settings.menuLanguages?.[0] ?? "de", restaurant: settings.restaurantName, url: resetUrl }) });
        }
        return json({ ok: true });
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
      // The platform owner's tenant powers (phase 3's dashboard calls these):
      // list the restaurants, open a new one with the seed catalogue, and
      // view or change any account's password. A tenant admin is a manager
      // of one restaurant, not the owner — gateOwner refuses them.
      if (path.length === 3 && path[2] === "tenants" && method === "GET") {
        const { denied } = await gateOwner();
        if (denied) return denied;
        return json({ tenants: await store.listTenants() });
      }
      if (path.length === 3 && path[2] === "tenants" && method === "POST") {
        const { denied } = await gateOwner();
        if (denied) return denied;
        const { value, invalid } = await body(request, TenantBody);
        if (invalid) return invalid;
        try {
          const tenant = await store.createTenant(value);
          const provisioned = await store.provisionTenant(tenant.id);
          return json({ tenant, provisioned }, 201);
        } catch (error) {
          return fail(error.message);
        }
      }
      // A tenant's whole database, as plain rows — the export it takes when
      // it moves, or the owner keeps before a delete.
      if (path.length === 5 && path[2] === "tenants" && path[4] === "export" && method === "GET") {
        const { denied } = await gateOwner();
        if (denied) return denied;
        try {
          return json(await store.exportTenantData(path[3]));
        } catch (error) {
          return fail(error.message, error.message === "No such tenant" ? 404 : 400);
        }
      }
      // A tenant, gone: every row it owns, then the tenant row itself, all
      // or nothing. The default tenant cannot be deleted. The dashboard
      // confirms this first; the delete itself is audited into the default
      // tenant by the caller, since the tenant's own audit log goes with it.
      if (path.length === 4 && path[2] === "tenants" && method === "DELETE") {
        const { denied } = await gateOwner();
        if (denied) return denied;
        try {
          const result = await store.deleteTenant(path[3]);
          await store.recordAudit({ role: "owner", ip: ctx.ip ?? "", method: "DELETE", route: `/api/admin/tenants/${path[3]}`, status: 200, detail: { tenantId: path[3], tenantName: result.tenant.name } });
          return json(result);
        } catch (error) {
          return fail(error.message, error.message === "No such tenant" ? 404 : 400);
        }
      }
      if (path.length === 5 && path[2] === "accounts" && path[4] === "password" && method === "GET") {
        const { denied } = await gateOwner();
        if (denied) return denied;
        if (!(await store.getAccount(path[3]))) return fail("No such account", 404);
        // Null when the password was set before any view key existed: a hash
        // cannot be turned back into the password it came from.
        return json({ password: await store.viewAccountPassword(path[3]) });
      }
      if (path.length === 5 && path[2] === "accounts" && path[4] === "password" && method === "PUT") {
        const { denied } = await gateOwner();
        if (denied) return denied;
        const { value, invalid } = await body(request, OwnerPasswordBody);
        if (invalid) return invalid;
        const updated = await store.setAccountPassword(path[3], { password: value.password });
        return updated ? json(updated) : fail("No such account", 404);
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
        return json({ tables: await store.tablesOverview(), held: await store.reservations.heldTables() });
      }
      // Open a table for its guests to order from their phones (开台), or close it.
      if (path.length === 5 && path[2] === "tables" && path[4] === "ordering" && method === "POST") {
        const { denied, role, pos } = await gate("staff");
        if (denied) return denied;
        const { value, invalid } = await body(request, TableOrderingBody);
        if (invalid) return invalid;
        try {
          // A table open on a POS is that device's to open or close.
          await store.assertTableFree(path[3], pos?.deviceId ?? null);
          if (value.open) {
            // Held by a booking: only a manager opens it over the hold, and
            // doing so checks the booked guest in.
            const hold = await store.reservations.holdOn(path[3]);
            if (hold && role !== "manager") return json({ error: `Table ${hold.table} is reserved for ${hold.time}`, code: "TABLE_RESERVED", reservedFor: hold.time }, 409);
            if (hold) await store.reservations.checkIn(path[3], { force: true });
            return json({ session: await store.openTable(path[3], pos) });
          }
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

      // A member looked up at the till by their email or mobile number, to
      // read their balance (会员储值) and pay a bill from it, or to top it up.
      if (path[2] === "members" && path.length === 3 && method === "GET") {
        const { denied } = await gate("staff");
        if (denied) return denied;
        const member = await store.customers.byLogin(url.searchParams.get("login") ?? "");
        return member ? json({ member }) : fail("No such member", 404);
      }

      // A member putting money in (会员储值充值): a top-up receipt, the money and
      // the house's bonus added to their balance (shared/register.mjs, planTopUp).
      if (path.length === 3 && path[2] === "topup" && method === "POST") {
        const { denied, role, pos } = await gate("staff");
        if (denied) return denied;
        try {
          const { value, invalid } = await body(request, TopUpBody);
          if (invalid) return invalid;
          return json(await store.topUp(value, role, pos), 201);
        } catch (error) {
          return fail(error.message, error.code === "NOT_FOUND" ? 404 : 400);
        }
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

      // The walk-in waitlist is the floor's (shared/waitlist.mjs): parties
      // taken at the door when full, notified when a table frees up, then
      // seated or gone. Notifying one with an email sends "your table is
      // ready" through the same pipeline as a booking.
      if (path[2] === "waitlist" && path.length <= 4) {
        const { denied } = await gate("staff");
        if (denied) return denied;
        const waitlist = store.waitlist;
        try {
          if (path.length === 3 && method === "GET") return json(await waitlist.list());
          if (path.length === 3 && method === "POST") {
            const { value, invalid } = await body(request, WaitlistBody);
            if (invalid) return invalid;
            return json(await waitlist.add(value), 201);
          }
          if (path.length === 4 && method === "PATCH") {
            const { value, invalid } = await body(request, WaitlistUpdateBody);
            if (invalid) return invalid;
            const result = await waitlist.update(path[3], value);
            if (!result) return fail("Not on the waitlist", 404);
            // Told their table is ready: once, best-effort, only if they left an email.
            if (result.justNotified && result.entry.email && mail) {
              const settings = await store.getSettings();
              await sendMail({ to: result.entry.email, ...waitlistReadyMessage(result.entry, { language: result.entry.language || "de", restaurant: settings.restaurantName }) });
            }
            return json({ entry: result.entry });
          }
          if (path.length === 4 && method === "DELETE") {
            return (await waitlist.remove(path[3])) ? new Response(null, { status: 204, headers: SECURITY_HEADERS }) : fail("Not on the waitlist", 404);
          }
        } catch (error) {
          if (!error.code) throw error;
          return json({ error: error.message, code: error.code }, error.status ?? 400);
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
              return json({ order: await tellPlatform(store, order, step, { prepMinutes: order.prepMinutes ?? 20, reason: order.rejectReason ?? "OTHER" }) });
            }
            if (!["accept", "reject", "ready", "complete"].includes(action)) return fail("Not found", 404);
            const done = await store.delivery.act(path[4], action, value);
            if (!done) return fail("Order not found", 404);
            if (action === "complete") return json({ order: done.order });
            return json({ order: await tellPlatform(store, done.order, action, { prepMinutes: done.order.prepMinutes ?? 20, reason: done.order.rejectReason ?? "OTHER" }) });
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
      // 今日概况: the day so far, on one screen — sales, the best sellers, the
      // tables seated now and what they still owe, and the day's bookings.
      if (path.length === 3 && path[2] === "today" && method === "GET") {
        const settings = await store.getSettings();
        const date = restaurantDay(settings.timeZone);
        const [report, tables, bookings] = await Promise.all([store.salesReport(date, date), store.tablesOverview(), store.reservations.today()]);
        const seated = tables.filter((table) => table.state === "seated");
        return json({
          today: {
            date,
            receipts: report.totals.receipts,
            grossCents: report.totals.grossCents,
            averageCents: report.totals.averageCents,
            top: [...report.items].sort((left, right) => right.quantity - left.quantity || right.grossCents - left.grossCents).slice(0, 5)
              .map((item) => ({ name: item.name, names: item.names, quantity: item.quantity, grossCents: item.grossCents })),
            seatedTables: seated.length,
            openCents: seated.reduce((sum, table) => sum + Math.round(table.total * 100), 0),
            bookings: bookings.map((booking) => ({ id: booking.id, time: booking.time, name: booking.name, party: booking.party, table: booking.table, status: booking.status, reference: booking.reference })),
            bookedGuests: bookings.reduce((sum, booking) => sum + booking.party, 0)
          }
        });
      }

      // The sales report over the manager's days: GET /api/admin/reports/sales?from=YYYY-MM-DD&to=YYYY-MM-DD
      if (path.length === 4 && path[2] === "reports" && path[3] === "sales" && method === "GET") {
        try {
          return json({ report: await store.salesReport(url.searchParams.get("from"), url.searchParams.get("to")) });
        } catch (error) {
          return coded(error);
        }
      }

      // 会员数据看板 (read-only): GET /api/admin/reports/members?from=YYYY-MM-DD&to=YYYY-MM-DD
      if (path.length === 4 && path[2] === "reports" && path[3] === "members" && method === "GET") {
        try {
          return json({ report: await store.memberReport(url.searchParams.get("from"), url.searchParams.get("to")) });
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
          // The manager changes a member's balance by hand (退款 / 调整), with a
          // required note; who made the change goes on the ledger too.
          if (path.length === 5 && path[4] === "balance" && method === "POST") {
            const { value, invalid } = await body(request, BalanceAdjustBody);
            if (invalid) return invalid;
            const customer = await customers.adjustBalance(id, value, pos?.staff?.name || role || "");
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
        if (path.length === 4 && path[3] === "lettered" && method === "POST") {
          const { value, invalid } = await body(request, LetteredTablesBody);
          if (invalid) return invalid;
          return json(await store.registerLetteredTables(value), 201);
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
  /**
   * 生日祝福邮件, the daily job (the Worker's cron, the Node server's timer):
   * from 09:00 in the restaurant's own time zone, each member whose birthday it
   * is today gets one greeting with the birthday offer. Off unless the owner
   * switched the birthday perk and its email on, and mail is set up. Each
   * greeting is claimed in the database before it is sent, so running the job
   * every hour, or twice at once, still mails a member once a year; a send that
   * fails gives the claim back for the next run. Members who signed up with a
   * mobile number have no address to write to and are left out.
   */
  /**
   * The daily birthday job, one restaurant at a time: each tenant has its
   * own perk, timezone, languages and members, so a greeting never crosses
   * restaurants. The return keeps the old shape for a single tenant — off
   * when no tenant greets by email, early when every greeting tenant is
   * still before 09:00 local — and counts what was sent across all of them.
   */
  async function birthdayGreetings(at = new Date()) {
    if (!mail) return { sent: 0, skipped: "off" };
    let sent = 0;
    let failed = 0;
    let eligible = 0;
    let early = 0;
    for (const tenant of await store.listTenants()) {
      const scoped = store.withTenant(tenant.id);
      const settings = await scoped.getSettings();
      const perk = settings.birthdayPerk;
      if (!perk?.enabled || !perk.greetByEmail) continue;
      eligible += 1;
      const today = localDayIn(settings.timeZone, at);
      if (today.hour < 9) { early += 1; continue; }
      // German where the menu has it (an Austrian restaurant's guests); otherwise the menu's own language.
      const offered = settings.menuLanguages ?? [];
      const language = offered.includes("de") || !offered.length ? "de" : offered.includes("en") ? "en" : "zh";
      const mailer = createMailer({ mail, store: scoped, send });
      for (const member of await scoped.customers.birthdaysDue(today)) {
        if (isPhoneLogin(member.email)) continue;
        if (!(await scoped.customers.claimGreeting(member.id, today.year))) continue;
        const name = member.name || String(member.email).split("@")[0];
        const message = birthdayMessage(name, { language, restaurant: settings.restaurantName, discountPercent: perk.discountPercent });
        if (await mailer({ to: member.email, ...message })) sent += 1;
        else { failed += 1; await scoped.customers.releaseGreeting(member.id, today.year); }
      }
    }
    if (!eligible) return { sent: 0, skipped: "off" };
    if (early === eligible) return { sent: 0, skipped: "early" };
    return { sent, failed };
  }

  serve.birthdayGreetings = birthdayGreetings;
  return serve;

  async function serve(request, { ip = "", requestId = "" } = {}) {
    const ctx = { ip, requestId, role: null, staff: null, audited: false, tenantId: DEFAULT_TENANT_ID };
    const url = new URL(request.url);
    const writing = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    // The body a write names its table and business fields in, read once.
    let sent = {};
    if (writing && request.headers.get("content-type")?.includes("application/json")) {
      try { sent = (await request.clone().json()) ?? {}; } catch { sent = {}; }
    }
    // Which restaurant this request belongs to — the API's routes never see
    // the unscoped store. Non-API requests (the web app, a picture) never
    // reach the store, so they keep the default one. A store without tenant
    // methods (a test double) is the single default tenant.
    const scoped = url.pathname.startsWith("/api/") && typeof store.withTenant === "function" ? store.withTenant(await resolveRequestTenant(request)) : store;
    ctx.tenantId = scoped.tenantId ?? DEFAULT_TENANT_ID;
    let response;
    try {
      response = await handle(request, ctx, scoped);
    } catch (error) {
      // One line a log search can find by the id the caller was given.
      console.error(JSON.stringify({ level: "error", msg: "request failed", requestId, method: request.method, path: url.pathname, error: String(error?.message ?? error), stack: error?.stack }));
      // Tell the owner out of band, without holding up the 500 (the host runs
      // it to completion — ctx.waitUntil on a Worker; the running process on Node).
      defer(alertOwner(scoped, { method: request.method, path: url.pathname, requestId, time: new Date().toISOString() }));
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
      // The waiter who signed in on the device, so "who voided this" has a name
      // and a staff id (shared-token tablet logins have no staff, so they
      // contribute nothing and keep only their role, as before).
      Object.assign(detail, auditActor(ctx.staff));
      try {
        await scoped.recordAudit({ role: ctx.role, ip, method: request.method, route: url.pathname, status: response.status, detail });
      } catch (error) {
        console.error("audit write failed", error);
      }
    }
    return response;
  };
}

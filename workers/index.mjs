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
  CategoryRenameBody, CategoryVatBody, CheckoutBody, CreateOrderBody, StornoBody, StaffBody, DeviceBody, PosSignInBody, MoveTableBody, SettlementBody, OrderStatusBody, PrinterBody, ProductBody, ServiceRequestBody, ServiceStatusBody,
  SettingsBody, TableBody, TableLockBody, RegisterBody, AccountSignInBody, AccountUpdateBody, AccountRecoverBody
} from "../src/contracts.js";
import { menuSettingsView, resolveStaffRole, roleAllows } from "../shared/rules.mjs";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

const TABLE_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,7}$/;

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY"
};

const UPLOAD_IMAGE_TYPES = new Map([["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"]]);
const MAX_STORED_IMAGE_BYTES = 1.5 * 1024 * 1024;

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
    "access-control-allow-headers": "content-type,x-admin-token,x-table-token,x-device-token",
    "access-control-max-age": "86400",
    ...(allow === "*" ? {} : { vary: "origin" })
  };
}

function clientKey(request) {
  return request.headers.get("cf-connecting-ip") || "unknown";
}

/**
 * The table gate the Node server has had all along, and this one had not.
 *
 * Until a restaurant registers its first table the app runs in open mode, so a
 * fresh install works before anything is set up. Once tables exist, an order
 * has to name one of them and carry the token printed on its card — otherwise
 * anyone who knows the address can put food on someone else's bill.
 *
 * The table is upper-cased in place, because that is what is stored and what
 * the bill is grouped by.
 */
async function refuseUnknownTable(request, store, order) {
  const table = String(order.table ?? "").trim().toUpperCase();
  // Validated even in open mode: a table that cannot be registered later would
  // otherwise be accepted now and become unbillable.
  if (!TABLE_PATTERN.test(table)) return fail("Table number must be 1-8 letters or digits");
  order.table = table;
  if (!await store.hasTables()) return null;
  const registered = await store.getTable(table);
  if (!registered || !registered.enabled) return json({ error: "Unknown table" }, 403);
  if (!tokenMatches(request.headers.get("x-table-token"), registered.token)) {
    return json({ error: "Table token is invalid" }, 403);
  }
  return null;
}

/**
 * One budget per client address, shared by the guards and the sign-in route,
 * so guessing the password and guessing a token are counted together. Returns
 * `{ denied }` once the budget is spent.
 */
function authThrottle(request) {
  const moment = Date.now();
  const key = clientKey(request);
  const current = authFailures.get(key);
  if (current && current.resetAt <= moment) authFailures.delete(key);
  const active = authFailures.get(key);
  if (active && active.failures >= AUTH_MAX_FAILURES) {
    const retryAfter = Math.max(1, Math.ceil((active.resetAt - moment) / 1000));
    return { denied: json({ error: "Too many authentication attempts", retryAfter }, 429, { "retry-after": String(retryAfter) }) };
  }
  return {
    fail() {
      const failures = (active?.failures ?? 0) + 1;
      if (!active && authFailures.size >= AUTH_MAX_TRACKED_SOURCES) pruneAuthFailures(moment);
      authFailures.set(key, { failures, resetAt: moment + AUTH_WINDOW_MS });
    },
    pass() {
      authFailures.delete(key);
    }
  };
}

/** The manager token, or nothing when this deployment has none worth trusting.
 *  Refusing a short one rather than falling back to a default: a deployed
 *  backend with a weak admin token is worse than one that plainly has none. */
function adminToken(env) {
  const expected = env.ADMIN_TOKEN;
  return expected && String(expected).length >= 32 ? expected : null;
}

/**
 * Authenticate, then check rank.
 *
 * The header carries one of two things: a session token the console got by
 * typing the console's password, or one of the shared tokens — `ADMIN_TOKEN`
 * for manager, and the optional `STAFF_TOKEN` / `KITCHEN_TOKEN`. The session
 * is asked first because it is what everyone uses; the tokens stay for the
 * tablets configured with one, and for getting back in when the password has
 * been forgotten.
 *
 * Roles only come from tokens. Past the password gate there is one role and it
 * is manager: it is the owner's own console.
 *
 * Returns `{ role }` when the request may proceed and `{ denied }` when it may
 * not, so a caller cannot forget to check.
 */
async function requireRole(request, env, store, minimumRole) {
  const expected = adminToken(env);
  const throttle = authThrottle(request);
  if (throttle.denied) return throttle;
  const provided = request.headers.get("x-admin-token");
  const session = await store.roleForSession(provided);
  const role = session?.role ?? resolveStaffRole((token) => tokenMatches(provided, token), {
    manager: expected,
    staff: env.STAFF_TOKEN,
    kitchen: env.KITCHEN_TOKEN
  });
  if (!role) {
    // Nothing configured that could ever grant one: say so, rather than
    // counting a failure against a caller who had no way to succeed.
    if (!expected && !(await store.accountStatus()).registered) {
      return { denied: fail("Register the restaurant's account on the admin console, or configure ADMIN_TOKEN", 503) };
    }
    throttle.fail();
    return { denied: json({ error: "Admin authentication required" }, 401) };
  }
  throttle.pass();
  // A waiter's session carries who they are and which device they are on.
  const pos = session?.staff ? { staff: session.staff, deviceId: session.deviceId } : null;
  if (!roleAllows(role, minimumRole)) {
    // A valid token used beyond its role is worth recording, not just refusing.
    const url = new URL(request.url);
    await store.recordAudit({
      role, ip: clientKey(request), method: request.method,
      route: url.pathname + url.search, status: 403, detail: { denied: minimumRole }
    });
    return { denied: json({ error: `This role may not perform ${minimumRole} actions` }, 403) };
  }
  return { role, pos, account: session?.account ?? null };
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

  const gate = (minimumRole) => requireRole(request, env, store, minimumRole);

  // /api/health
  if (path.length === 2 && path[0] === "api" && path[1] === "health" && method === "GET") {
    return json({ ok: true, realtimeClients: 0, timestamp: new Date().toISOString() });
  }

  // /api/catalog
  if (path.length === 2 && path[0] === "api" && path[1] === "catalog" && method === "GET") {
    const settings = await store.getSettings();
    return json({ products: await store.listProducts(true), theme: settings.menuTheme, languages: settings.menuLanguages, menu: menuSettingsView(settings) });
  }

  // /api/orders and /api/orders/:id/status
  if (path[0] === "api" && path[1] === "orders") {
    if (path.length === 2 && method === "GET") {
      const { denied } = await gate("kitchen");
      if (denied) return denied;
      return json({ orders: await store.listOrders(limit) });
    }
    if (path.length === 2 && method === "POST") {
      try {
        const { value, invalid } = await body(request, CreateOrderBody);
        if (invalid) return invalid;
        const refused = await refuseUnknownTable(request, store, value);
        if (refused) return refused;
        return json({ order: await store.createOrder(value) }, 201);
      } catch (error) {
        // A locked table is a state the guest can wait out, not a malformed
        // request, so the app can tell them to ask a waiter instead of telling
        // them their cart is wrong.
        return fail(error.message, error.code === "TABLE_LOCKED" ? 409 : 400);
      }
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

  // /api/service-requests and /api/service-requests/:id/status
  if (path[0] === "api" && path[1] === "service-requests") {
    if (path.length === 2 && method === "GET") {
      const { denied } = await gate("staff");
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

  // ——— The POS (shared/pos.mjs). A paired device lists the waiters and takes
  // a PIN; a waiter's session does the rest.
  if (path[0] === "api" && path[1] === "pos") {
    const pairedDevice = async () => store.deviceForToken(request.headers.get("x-device-token"));
    if (path.length === 3 && path[2] === "staff" && method === "GET") {
      if (!(await pairedDevice())) return fail("This device is not paired with the POS", 401);
      return json({ staff: (await store.listStaff(true)).map(({ id, name, role }) => ({ id, name, role })) });
    }
    if (path.length === 3 && path[2] === "sign-in" && method === "POST") {
      const throttle = authThrottle(request);
      if (throttle.denied) return throttle.denied;
      const device = await pairedDevice();
      if (!device) return fail("This device is not paired with the POS", 401);
      const { value, invalid } = await body(request, PosSignInBody);
      if (invalid) return invalid;
      const session = await store.posSignIn(device, value.staffId, value.pin);
      if (!session) {
        throttle.fail();
        return fail("Wrong PIN", 401);
      }
      throttle.pass();
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

    const { denied, role, pos } = await gate("staff");
    if (denied) return denied;
    if (!pos) return fail("Sign in on a POS device", 403);
    const claimed = (error) => fail(error.message, error.code === "TABLE_CLAIMED" ? 409 : 400);
    try {
      if (path.length === 3 && path[2] === "floor" && method === "GET") {
        return json({ tables: await store.tablesOverview(), claims: await store.liveClaims(), takeawayDiscountPercent: (await store.getSettings()).takeawayDiscountPercent });
      }
      if (path.length === 5 && path[2] === "tables" && path[4] === "claim") {
        if (method === "POST") return json({ claim: await store.claimTable(path[3], pos) });
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
   * The restaurant's account (shared/account.mjs), as server/routes.mjs has it.
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
      const throttle = authThrottle(request);
      if (throttle.denied) return throttle.denied;
      if (path[2] === "sign-in") {
        const { value, invalid } = await body(request, AccountSignInBody);
        if (invalid) return invalid;
        const session = await store.signInAccount(value.login, value.password);
        if (!session) {
          throttle.fail();
          return fail("Wrong account name or password", 401);
        }
        throttle.pass();
        return json(session);
      }
      if (path[2] === "recover") {
        // ADMIN_TOKEN and only the token — not a live session, which a stolen tablet would carry.
        const expected = adminToken(env);
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
    if (path.length === 5 && path[2] === "tables" && path[4] === "lock" && method === "POST") {
      const { denied } = await gate("staff");
      if (denied) return denied;
      try {
        const { value, invalid } = await body(request, TableLockBody);
        if (invalid) return invalid;
        const table = await store.setTableLock(path[3], value.locked);
        return table ? json({ table }) : fail("Table not found", 404);
      } catch (error) {
        return fail(error.message);
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
      const voucher = await store.getVoucher(decodeURIComponent(path[3]));
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

    // The waiters and the devices the POS runs on.
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
      if (path.length === 3 && method === "POST") {
        try {
          const { value, invalid } = await body(request, TableBody);
          if (invalid) return invalid;
          return json({ table: await store.saveTable(value) }, 201);
        } catch (error) {
          return fail(error.message);
        }
      }
      if (path.length === 4 && method === "DELETE") {
        try {
          return (await store.deleteTable(path[3]))
            ? new Response(null, { status: 204, headers: SECURITY_HEADERS })
            : fail("Table not found", 404);
        } catch (error) {
          return fail(error.message);
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
        // Pictures only, and small enough for one D1 row (2 MB). A video needs
        // a bucket this deployment does not have.
        let file;
        try {
          file = (await request.formData()).get("file");
        } catch {
          return fail("Media file is required");
        }
        if (!file || typeof file === "string") return fail("Media file is required");
        const accepted = UPLOAD_IMAGE_TYPES.get(file.type);
        if (!accepted) return fail("Only JPEG, PNG and WebP pictures can be stored here");
        if (file.size > MAX_STORED_IMAGE_BYTES) return fail("Picture exceeds 1.5 MB — make it smaller first", 413);
        const product = await store.storeMedia(path[3], { contentType: file.type, extension: accepted, bytes: new Uint8Array(await file.arrayBuffer()) });
        return product ? json({ product }, 201) : fail("Product not found", 404);
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

    if (path[2] === "printer-for-role" && path.length === 4 && method === "GET") {
      return json({ printer: await store.printerForRole(path[3]) });
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

  if (path[0] === "ws") {
    return fail("Realtime needs a Durable Object; this deployment polls instead", 501);
  }

  if (path[0] === "api") return fail("API route not found", 404);

  // Pictures kept in D1. The id carries a hash (seeded photos) or is a fresh
  // uuid (uploads), so a URL never changes what it points at.
  if (path[0] === "media" && path.length === 2 && (method === "GET" || method === "HEAD")) {
    const media = await store.getMediaFile(path[1]);
    if (!media) return fail("Media not found", 404);
    return new Response(method === "HEAD" ? null : media.bytes, {
      headers: {
        ...SECURITY_HEADERS,
        "content-type": media.contentType,
        "cache-control": "public, max-age=31536000, immutable",
        "content-security-policy": "default-src 'none'; sandbox"
      }
    });
  }

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

import { createWriteStream, existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { pipeline } from "node:stream/promises";
import {
  CategoryRenameBody, CategoryVatBody, CheckoutBody, CreateOrderBody, IdParams, LimitQuery, OrderStatusBody, PrinterBody, PrintJobsQuery,
  ProductBody, ServiceRequestBody, ServiceStatusBody, SetPasswordBody, SettingsBody,
  SignInBody, StornoBody, TableBody, TableLockBody, TableParams, JournalQuery, VoucherParams,
  StaffBody, DeviceBody, PosSignInBody, MoveTableBody, SettlementBody
} from "./schemas.mjs";
import { createRateLimiter, rateLimitGuard } from "./rate-limit.mjs";
// Who outranks whom is the one rule the Worker must not decide differently.
import { menuSettingsView, ROLE_RANK, resolveStaffRole } from "../shared/rules.mjs";

const MEDIA_TYPES = new Map([
  ["image/jpeg", { type: "image", extension: ".jpg" }],
  ["image/png", { type: "image", extension: ".png" }],
  ["image/webp", { type: "image", extension: ".webp" }],
  ["video/mp4", { type: "video", extension: ".mp4" }],
  ["video/webm", { type: "video", extension: ".webm" }]
]);

const TABLE_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,7}$/;
const AUTH_WINDOW_MS = 5 * 60 * 1000;
const AUTH_MAX_FAILURES = 5;
const AUTH_MAX_TRACKED_SOURCES = 10_000;

function tokenMatches(provided, expected) {
  const providedBytes = Buffer.from(typeof provided === "string" ? provided : "", "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  const candidate = providedBytes.length === expectedBytes.length ? providedBytes : Buffer.alloc(expectedBytes.length);
  return providedBytes.length === expectedBytes.length && timingSafeEqual(candidate, expectedBytes);
}

function errorReply(reply, error, statusCode = 400) {
  return reply.code(statusCode).send({ error: error.message || "Request failed" });
}

// Manager can do everything; staff runs the floor; kitchen only moves orders along.

export function registerRoutes(app, { database, realtime, config }) {
  const authFailures = new Map();

  /** The failure table is keyed by client address, so it grows without a bound
   *  of its own. Drop expired entries before it can become one. */
  function pruneAuthFailures(moment) {
    for (const [source, entry] of authFailures) {
      if (entry.resetAt <= moment) authFailures.delete(source);
    }
  }
  const orderLimiter = createRateLimiter({ windowMs: config.publicRateLimitWindowMs, max: config.orderRateLimitMax });
  const serviceLimiter = createRateLimiter({ windowMs: config.publicRateLimitWindowMs, max: config.serviceRateLimitMax });
  const guardOrders = rateLimitGuard(orderLimiter, "Too many orders from this device");
  const guardServiceRequests = rateLimitGuard(serviceLimiter, "Too many service requests from this device");

  /**
   * Guest devices declare their own table. Once tables are registered the server
   * only accepts a known table plus its token; an empty registry stays open so a
   * fresh install works before any table has been set up.
   */
  function requireTable(request, reply, done) {
    const table = String(request.body?.table ?? "").trim().toUpperCase();
    // Validated even in open mode: a table that cannot be registered later
    // would otherwise be accepted now and become unbillable.
    if (!TABLE_PATTERN.test(table)) {
      reply.code(400).send({ error: "Table number must be 1-8 letters or digits" });
      return;
    }
    request.body.table = table;
    if (!database.hasTables()) {
      done();
      return;
    }
    const registered = database.getTable(table);
    if (!registered || !registered.enabled) {
      reply.code(403).send({ error: "Unknown table" });
      return;
    }
    if (!tokenMatches(request.headers["x-table-token"], registered.token)) {
      reply.code(403).send({ error: "Table token is invalid" });
      return;
    }
    done();
  }

  /**
   * The header carries one of two things: a session token the console got by
   * typing the password, or one of the configured tokens. The session is asked
   * first because it is what everyone uses; the tokens stay for the tablets
   * that were configured with one, and for getting back in when the password
   * has been forgotten.
   */
  /** Who is asking: a role, and for a waiter on a POS device, who and where. */
  async function resolveSession(request) {
    const provided = request.headers["x-admin-token"];
    const session = await database.roleForSession(provided);
    if (session) return session;
    const role = resolveStaffRole((expected) => tokenMatches(provided, expected), {
      manager: config.adminToken,
      staff: config.staffToken,
      kitchen: config.kitchenToken
    });
    return role ? { role } : null;
  }

  /**
   * One budget per client address, shared by the guards and the sign-in route,
   * so guessing the password and guessing a token are counted together. Returns
   * null once the budget is spent, having already sent the 429.
   */
  function authThrottle(request, reply) {
    const moment = Date.now();
    const key = request.ip || "unknown";
    const current = authFailures.get(key);
    if (current && current.resetAt <= moment) authFailures.delete(key);
    const active = authFailures.get(key);
    if (active && active.failures >= AUTH_MAX_FAILURES) {
      const retryAfter = Math.max(1, Math.ceil((active.resetAt - moment) / 1000));
      reply.header("retry-after", retryAfter);
      reply.code(429).send({ error: "Too many authentication attempts", retryAfter });
      return null;
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

  /** @param {"manager"|"staff"|"kitchen"} minimumRole */
  function requireRole(minimumRole) {
    const required = ROLE_RANK[minimumRole];
    return async function guard(request, reply) {
      const throttle = authThrottle(request, reply);
      if (!throttle) return reply;
      const session = await resolveSession(request);
      const role = session?.role;
      if (!role) {
        throttle.fail();
        return reply.code(401).send({ error: "Admin authentication required" });
      }
      throttle.pass();
      request.staffRole = role;
      // A waiter's session carries who they are and which device they are on.
      request.pos = session.staff ? { staff: session.staff, deviceId: session.deviceId } : null;
      if (ROLE_RANK[role] < required) {
        // A valid token used beyond its role is worth recording, not just refusing.
        request.auditedDenial = true;
        database.recordAudit({ role, ip: request.ip, method: request.method, route: request.url, status: 403, detail: { denied: minimumRole } });
        return reply.code(403).send({ error: `This role may not perform ${minimumRole} actions` });
      }
      return undefined;
    };
  }

  const requireAdmin = requireRole("manager");
  const requireFloor = requireRole("staff");
  const requireKitchen = requireRole("kitchen");

  // Business fields worth keeping; the request body is never stored wholesale.
  const AUDIT_FIELDS = ["status", "table", "sku", "price", "vatPercent", "published", "available", "name", "role", "enabled", "rotateToken"];

  /**
   * Every write made with a staff token is recorded. One shared token per role
   * means the log cannot name a person, but it does answer what changed, when,
   * from which device and under which role.
   */
  app.addHook("onResponse", async (request, reply) => {
    if (!request.staffRole || request.auditedDenial) return;
    if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return;
    const detail = { params: request.params ?? {} };
    const body = request.body;
    if (body && typeof body === "object" && !Buffer.isBuffer(body)) {
      for (const field of AUDIT_FIELDS) {
        if (body[field] !== undefined) detail[field] = body[field];
      }
    }
    try {
      database.recordAudit({
        role: request.staffRole,
        ip: request.ip,
        method: request.method,
        route: request.routeOptions?.url ?? request.url,
        status: reply.statusCode,
        detail
      });
    } catch (error) {
      request.log.error({ err: error }, "audit write failed");
    }
  });

  app.get("/api/health", async () => ({
    ok: true,
    realtimeClients: realtime.size(),
    timestamp: new Date().toISOString()
  }));

  app.get("/ws", { websocket: true }, (socket, request) => {
    const table = String(request.query?.table ?? "").trim().toUpperCase();
    realtime.connect(socket, TABLE_PATTERN.test(table) ? table : null);
  });

  // A picture kept in the database answers first; anything else is an upload
  // on disk. The id carries a hash of the bytes, so it can be cached for good.
  app.get("/media/:file", async (request, reply) => {
    const stored = database.getMediaFile(request.params.file);
    if (stored) {
      return reply
        .header("cache-control", "public, max-age=31536000, immutable")
        .type(stored.contentType)
        .send(stored.bytes);
    }
    return reply.sendFile(request.params.file);
  });

  app.get("/api/catalog", async () => {
    const settings = database.getSettings();
    return { products: database.listProducts(true), theme: settings.menuTheme, languages: settings.menuLanguages, menu: menuSettingsView(settings) };
  });
  app.get("/api/admin/settings", { preHandler: requireAdmin }, async () => database.getSettings());
  app.put("/api/admin/settings", { preHandler: requireAdmin, schema: { body: SettingsBody } }, async (request, reply) => {
    try {
      return database.saveSettings(request.body || {});
    } catch (error) {
      return errorReply(reply, error);
    }
  });
  app.get("/api/admin/products", { preHandler: requireAdmin, schema: { querystring: LimitQuery } }, async () => ({ products: database.listProducts(false) }));
  app.get("/api/admin/products/:id", { preHandler: requireAdmin, schema: { params: IdParams } }, async (request, reply) => {
    const product = database.getProduct(request.params.id);
    return product || errorReply(reply, new Error("Product not found"), 404);
  });
  app.post("/api/admin/products", { preHandler: requireAdmin, schema: { body: ProductBody } }, async (request, reply) => {
    try {
      const product = database.saveProduct(request.body || {});
      realtime.broadcast("catalog.changed", { productId: product.id });
      return reply.code(201).send({ product });
    } catch (error) {
      return errorReply(reply, error);
    }
  });
  app.put("/api/admin/products/:id", { preHandler: requireAdmin, schema: { params: IdParams, body: ProductBody } }, async (request, reply) => {
    try {
      const product = database.saveProduct(request.body || {}, request.params.id);
      if (!product) return errorReply(reply, new Error("Product not found"), 404);
      realtime.broadcast("catalog.changed", { productId: product.id });
      return { product };
    } catch (error) {
      return errorReply(reply, error);
    }
  });
  app.delete("/api/admin/products/:id", { preHandler: requireAdmin, schema: { params: IdParams } }, async (request, reply) => {
    if (!database.deleteProduct(request.params.id)) return errorReply(reply, new Error("Product not found"), 404);
    realtime.broadcast("catalog.changed", { productId: request.params.id });
    return reply.code(204).send();
  });

  app.post("/api/admin/categories/rename", { preHandler: requireAdmin, schema: { body: CategoryRenameBody } }, async (request, reply) => {
    try {
      const result = database.renameCategory(request.body.from, request.body.to);
      if (!result) return errorReply(reply, new Error("No dish is in that category"), 404);
      realtime.broadcast("catalog.changed", { category: result.category });
      return result;
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  app.post("/api/admin/categories/vat", { preHandler: requireAdmin, schema: { body: CategoryVatBody } }, async (request, reply) => {
    try {
      const result = database.setCategoryVat(request.body.category, request.body.vatPercent);
      if (!result) return errorReply(reply, new Error("No dish is in that category"), 404);
      realtime.broadcast("catalog.changed", { category: result.category });
      return result;
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  app.post("/api/admin/products/:id/duplicate", { preHandler: requireAdmin, schema: { params: IdParams } }, async (request, reply) => {
    const product = database.duplicateProduct(request.params.id);
    if (!product) return errorReply(reply, new Error("Product not found"), 404);
    realtime.broadcast("catalog.changed", { productId: product.id });
    return reply.code(201).send({ product });
  });

  app.post("/api/admin/products/:id/media", { preHandler: requireAdmin, schema: { params: IdParams } }, async (request, reply) => {
    const part = await request.file({ limits: { fileSize: 50 * 1024 * 1024, files: 1 } });
    if (!part) return errorReply(reply, new Error("Media file is required"));
    const accepted = MEDIA_TYPES.get(part.mimetype);
    if (!accepted) {
      part.file.resume();
      return errorReply(reply, new Error("Only JPEG, PNG, WebP, MP4 and WebM are supported"));
    }
    const filename = `${randomUUID()}${accepted.extension}`;
    const target = path.join(config.uploadDir, filename);
    try {
      await pipeline(part.file, createWriteStream(target, { flags: "wx" }));
      if (part.file.truncated) {
        await unlink(target).catch(() => undefined);
        return errorReply(reply, new Error("Media file exceeds 50 MB"), 413);
      }
      const product = database.addMedia(request.params.id, {
        type: accepted.type,
        url: `/media/${filename}`
      });
      if (!product) {
        await unlink(target).catch(() => undefined);
        return errorReply(reply, new Error("Product not found"), 404);
      }
      realtime.broadcast("catalog.changed", { productId: product.id });
      return reply.code(201).send({ product });
    } catch (error) {
      await unlink(target).catch(() => undefined);
      return errorReply(reply, error);
    }
  });

  app.get("/api/orders", { preHandler: requireKitchen, schema: { querystring: LimitQuery } }, async (request) => ({
    orders: database.listOrders(request.query.limit)
  }));
  app.post("/api/orders", { preHandler: [guardOrders, requireTable], schema: { body: CreateOrderBody } }, async (request, reply) => {
    try {
      const order = database.createOrder(request.body || {});
      realtime.broadcast("order.changed", order, order.table);
      realtime.broadcast("print.queued", { orderId: order.id }, order.table);
      return reply.code(201).send({ order });
    } catch (error) {
      // A locked table is a state the guest can wait out, not a malformed
      // request, so the app can tell them to ask a waiter instead of telling
      // them their cart is wrong.
      return errorReply(reply, error, error.code === "TABLE_LOCKED" ? 409 : 400);
    }
  });
  app.patch("/api/orders/:id/status", { preHandler: requireKitchen, schema: { params: IdParams, body: OrderStatusBody } }, async (request, reply) => {
    try {
      const order = database.updateOrder(request.params.id, request.body?.status);
      if (!order) return errorReply(reply, new Error("Order not found"), 404);
      realtime.broadcast("order.changed", order, order.table);
      return { order };
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  app.get("/api/service-requests", { preHandler: requireFloor, schema: { querystring: LimitQuery } }, async (request) => ({
    requests: database.listServiceRequests(request.query.limit)
  }));
  app.post("/api/service-requests", { preHandler: [guardServiceRequests, requireTable], schema: { body: ServiceRequestBody } }, async (request, reply) => {
    try {
      const serviceRequest = database.createServiceRequest(request.body || {});
      realtime.broadcast("service.changed", serviceRequest, serviceRequest.table);
      return reply.code(201).send({ request: serviceRequest });
    } catch (error) {
      return errorReply(reply, error);
    }
  });
  app.patch("/api/service-requests/:id/status", { preHandler: requireFloor, schema: { params: IdParams, body: ServiceStatusBody } }, async (request, reply) => {
    try {
      const serviceRequest = database.updateServiceRequest(request.params.id, request.body?.status);
      if (!serviceRequest) return errorReply(reply, new Error("Service request not found"), 404);
      realtime.broadcast("service.changed", serviceRequest, serviceRequest.table);
      return { request: serviceRequest };
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  /**
   * The door of the admin console.
   *
   * `GET` is deliberately open: it answers one bit — has a password been set —
   * which the console needs before it can draw anything, and which anyone who
   * tried to sign in would learn regardless.
   */
  app.get("/api/admin/gate", async () => database.adminGate());

  app.post("/api/admin/gate/sign-in", { schema: { body: SignInBody } }, async (request, reply) => {
    const throttle = authThrottle(request, reply);
    if (!throttle) return reply;
    const session = await database.signIn(request.body?.password);
    if (!session) {
      throttle.fail();
      return reply.code(401).send({ error: "Wrong password" });
    }
    throttle.pass();
    return session;
  });

  /**
   * Sets the password: once for whoever opens the console first, because there
   * is nothing yet to prove, and thereafter only for someone who can produce
   * the one in force.
   *
   * The recovery path is ADMIN_TOKEN, and it is the token that is accepted
   * here rather than a live session on purpose: a stolen session must not be
   * able to change the password and lock the owner out of their own menu.
   */
  app.post("/api/admin/gate/password", { schema: { body: SetPasswordBody } }, async (request, reply) => {
    const throttle = authThrottle(request, reply);
    if (!throttle) return reply;
    const provided = request.headers["x-admin-token"];
    const recovering = Boolean(config.adminToken) && tokenMatches(provided, config.adminToken);
    try {
      const gate = recovering
        ? await database.resetAdminGatePassword(request.body?.password)
        : await database.setAdminGatePassword(request.body?.password, request.body?.currentPassword);
      if (!gate) {
        throttle.fail();
        return reply.code(401).send({ error: "Wrong password" });
      }
      throttle.pass();
      return gate;
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  app.post("/api/admin/gate/sign-out", { preHandler: requireKitchen }, async (request, reply) => {
    await database.signOut(request.headers["x-admin-token"]);
    return reply.code(204).send();
  });

  app.get("/api/admin/session", { preHandler: requireKitchen }, async (request) => ({ role: request.staffRole }));
  app.get("/api/admin/audit", { preHandler: requireAdmin, schema: { querystring: LimitQuery } }, async (request) => ({
    entries: database.listAudit(request.query.limit)
  }));
  app.get("/api/admin/tables", { preHandler: requireAdmin }, async () => ({ tables: database.listTables() }));
  app.get("/api/admin/tables/open", { preHandler: requireFloor }, async () => ({ tables: database.openBillTables() }));

  /**
   * The floor's view of the room: every table, what is on it, and whether it
   * is taking orders. The entry tokens are not in here — those stay on
   * `/api/admin/tables`, which is the manager's.
   */
  app.get("/api/admin/tables/overview", { preHandler: requireFloor }, async () => ({ tables: database.tablesOverview() }));

  app.post("/api/admin/tables/:table/lock", { preHandler: requireFloor, schema: { params: TableParams, body: TableLockBody } }, async (request, reply) => {
    try {
      const table = database.setTableLock(request.params.table, request.body.locked);
      if (!table) return errorReply(reply, new Error("Table not found"), 404);
      realtime.broadcast("table.changed", { table: table.table, locked: table.locked }, table.table);
      return { table };
    } catch (error) {
      return errorReply(reply, error);
    }
  });
  app.post("/api/admin/tables", { preHandler: requireAdmin, schema: { body: TableBody } }, async (request, reply) => {
    try {
      return reply.code(201).send({ table: database.saveTable(request.body || {}) });
    } catch (error) {
      return errorReply(reply, error);
    }
  });
  app.delete("/api/admin/tables/:table", { preHandler: requireAdmin, schema: { params: TableParams } }, async (request, reply) => {
    if (!database.deleteTable(request.params.table)) return errorReply(reply, new Error("Table not found"), 404);
    return reply.code(204).send();
  });
  app.get("/api/admin/tables/:table/bill", { preHandler: requireFloor, schema: { params: TableParams } }, async (request) => ({
    bill: database.billForTable(request.params.table)
  }));
  // An interim bill for the guest to read. Paying is a receipt (checkout).
  app.post("/api/admin/tables/:table/bill/print", { preHandler: requireFloor, schema: { params: TableParams } }, async (request, reply) => {
    const bill = database.printTableBill(request.params.table);
    if (!bill) return errorReply(reply, new Error("Table has nothing left to pay"), 409);
    realtime.broadcast("print.queued", { jobId: bill.printJobId }, bill.table);
    return { bill };
  });

  // The register (shared/register.mjs): receipts, storno, the day's closing, the journal.
  app.post("/api/admin/checkout", { preHandler: requireFloor, schema: { body: CheckoutBody } }, async (request, reply) => {
    try {
      const receipt = database.checkout(request.body, request.staffRole, request.pos);
      if (receipt.table) realtime.broadcast("bill.paid", { table: receipt.table, receiptNo: receipt.receiptNo }, receipt.table);
      return reply.code(201).send({ receipt });
    } catch (error) {
      return errorReply(reply, error, error.code === "TABLE_CLAIMED" ? 409 : 400);
    }
  });
  app.get("/api/admin/receipts", { preHandler: requireFloor, schema: { querystring: LimitQuery } }, async (request) => ({
    receipts: database.listReceipts(request.query.limit)
  }));
  app.get("/api/admin/receipts/:id", { preHandler: requireFloor, schema: { params: IdParams } }, async (request, reply) => {
    const receipt = database.getReceipt(request.params.id);
    return receipt ? { receipt } : errorReply(reply, new Error("Receipt not found"), 404);
  });
  app.post("/api/admin/receipts/:id/storno", { preHandler: requireAdmin, schema: { params: IdParams, body: StornoBody } }, async (request, reply) => {
    try {
      const receipt = database.stornoReceipt(request.params.id, request.body.reason, request.staffRole, request.pos);
      if (!receipt) return errorReply(reply, new Error("Receipt not found"), 404);
      return reply.code(201).send({ receipt });
    } catch (error) {
      return errorReply(reply, error, /already been cancelled/.test(error.message) ? 409 : 400);
    }
  });
  app.get("/api/admin/vouchers/:code", { preHandler: requireFloor, schema: { params: VoucherParams } }, async (request, reply) => {
    const voucher = database.getVoucher(request.params.code);
    return voucher ? { voucher } : errorReply(reply, new Error("Voucher not found"), 404);
  });
  app.get("/api/admin/day-closings/preview", { preHandler: requireAdmin }, async () => ({ totals: database.closingPreview() }));
  app.get("/api/admin/day-closings", { preHandler: requireAdmin, schema: { querystring: LimitQuery } }, async (request) => ({
    closings: database.listClosings(request.query.limit)
  }));
  app.post("/api/admin/day-closings", { preHandler: requireAdmin }, async (request, reply) => {
    const closing = database.closeDay(request.staffRole);
    if (!closing) return errorReply(reply, new Error("No receipts since the last closing"), 409);
    return reply.code(201).send({ closing });
  });
  // ——— The POS (shared/pos.mjs). The manager pairs devices and keeps the
  // waiters; a paired device lists them and takes a PIN; a waiter's session
  // does the rest.
  app.get("/api/admin/staff", { preHandler: requireAdmin }, async () => ({ staff: database.listStaff() }));
  app.post("/api/admin/staff", { preHandler: requireAdmin, schema: { body: StaffBody } }, async (request, reply) => {
    try {
      return reply.code(201).send({ staff: await database.saveStaff(request.body) });
    } catch (error) {
      return errorReply(reply, error);
    }
  });
  app.put("/api/admin/staff/:id", { preHandler: requireAdmin, schema: { params: IdParams, body: StaffBody } }, async (request, reply) => {
    try {
      const staff = await database.saveStaff(request.body, request.params.id);
      return staff ? { staff } : errorReply(reply, new Error("Waiter not found"), 404);
    } catch (error) {
      return errorReply(reply, error);
    }
  });
  app.get("/api/admin/pos-devices", { preHandler: requireAdmin }, async () => ({ devices: database.listDevices() }));
  app.post("/api/admin/pos-devices", { preHandler: requireAdmin, schema: { body: DeviceBody } }, async (request, reply) => {
    try {
      return reply.code(201).send(await database.pairDevice(request.body.name));
    } catch (error) {
      return errorReply(reply, error);
    }
  });
  app.delete("/api/admin/pos-devices/:id", { preHandler: requireAdmin, schema: { params: IdParams } }, async (request, reply) =>
    (database.deleteDevice(request.params.id) ? reply.code(204).send() : errorReply(reply, new Error("Device not found"), 404)));

  /** A paired device, from its token, or the reply that says it is not one. */
  async function pairedDevice(request, reply) {
    const device = await database.deviceForToken(request.headers["x-device-token"]);
    if (!device) {
      reply.code(401).send({ error: "This device is not paired with the POS" });
      return null;
    }
    return device;
  }
  app.get("/api/pos/staff", async (request, reply) => {
    if (!(await pairedDevice(request, reply))) return reply;
    return { staff: database.listStaff(true).map(({ id, name, role }) => ({ id, name, role })) };
  });
  app.post("/api/pos/sign-in", { schema: { body: PosSignInBody } }, async (request, reply) => {
    const throttle = authThrottle(request, reply);
    if (!throttle) return reply;
    const device = await pairedDevice(request, reply);
    if (!device) return reply;
    const session = await database.posSignIn(device, request.body.staffId, request.body.pin);
    if (!session) {
      throttle.fail();
      return reply.code(401).send({ error: "Wrong PIN" });
    }
    throttle.pass();
    return session;
  });
  app.post("/api/pos/sign-out", async (request, reply) => {
    await database.posSignOut(request.headers["x-admin-token"]);
    return reply.code(204).send();
  });

  /** A waiter's own POS session: the routes below act as someone, on some device. */
  async function requirePos(request, reply) {
    const denied = await requireFloor(request, reply);
    if (denied || reply.sent) return denied ?? reply;
    if (!request.pos) return reply.code(403).send({ error: "Sign in on a POS device" });
    return undefined;
  }
  const claimed = (reply, error) => errorReply(reply, error, error.code === "TABLE_CLAIMED" ? 409 : 400);
  app.get("/api/pos/floor", { preHandler: requirePos }, async () => ({ tables: database.tablesOverview(), claims: database.liveClaims() }));
  app.post("/api/pos/tables/:table/claim", { preHandler: requirePos, schema: { params: TableParams } }, async (request, reply) => {
    try {
      return { claim: database.claimTable(request.params.table, request.pos) };
    } catch (error) {
      return claimed(reply, error);
    }
  });
  app.delete("/api/pos/tables/:table/claim", { preHandler: requirePos, schema: { params: TableParams } }, async (request, reply) => {
    database.releaseTable(request.params.table, request.pos, request.staffRole === "manager" && request.query?.force === "1");
    return reply.code(204).send();
  });
  app.post("/api/pos/orders", { preHandler: requirePos, schema: { body: CreateOrderBody } }, async (request, reply) => {
    try {
      const order = database.createOrder(request.body, request.pos);
      realtime.broadcast("order.created", { orderId: order.id, table: order.table }, order.table);
      return reply.code(201).send({ order });
    } catch (error) {
      return claimed(reply, error);
    }
  });
  app.post("/api/pos/takeaway", { preHandler: requirePos }, async (request, reply) => reply.code(201).send(database.newTakeaway(request.pos)));
  app.post("/api/pos/tables/:table/move", { preHandler: requirePos, schema: { params: TableParams, body: MoveTableBody } }, async (request, reply) => {
    try {
      const moved = database.moveTable(request.params.table, request.body.to, request.pos);
      return moved ?? errorReply(reply, new Error("Nothing open on that table"), 404);
    } catch (error) {
      return claimed(reply, error);
    }
  });
  /** A waiter's own settlement; the manager may settle anyone's. */
  const settlementFor = (request, reply) => {
    const staffId = request.body?.staffId ?? request.query?.staffId ?? request.pos.staff.id;
    if (staffId !== request.pos.staff.id && request.staffRole !== "manager") {
      reply.code(403).send({ error: "Only the manager settles another waiter" });
      return null;
    }
    return staffId;
  };
  app.get("/api/pos/settlement", { preHandler: requirePos }, async (request, reply) => {
    const staffId = settlementFor(request, reply);
    return staffId ? { totals: database.staffSettlementPreview(staffId) } : reply;
  });
  app.post("/api/pos/settlement", { preHandler: requirePos, schema: { body: SettlementBody } }, async (request, reply) => {
    const staffId = settlementFor(request, reply);
    if (!staffId) return reply;
    const settlement = database.settleStaff(staffId, request.staffRole);
    return settlement ? reply.code(201).send({ settlement }) : errorReply(reply, new Error("No receipts since the last settlement"), 409);
  });
  app.get("/api/pos/settlements", { preHandler: requireAdmin, schema: { querystring: LimitQuery } }, async (request) => ({ settlements: database.listSettlements(request.query.limit) }));

  app.get("/api/admin/journal", { preHandler: requireAdmin, schema: { querystring: JournalQuery } }, async (request) =>
    database.exportJournal(request.query.from, request.query.to));

  app.get("/api/admin/printers", { preHandler: requireAdmin }, async () => ({ printers: database.listPrinters() }));
  app.post("/api/admin/printers", { preHandler: requireAdmin, schema: { body: PrinterBody } }, async (request, reply) => {
    try {
      return reply.code(201).send({ printer: database.savePrinter(request.body || {}) });
    } catch (error) {
      return errorReply(reply, error);
    }
  });
  app.put("/api/admin/printers/:id", { preHandler: requireAdmin, schema: { params: IdParams, body: PrinterBody } }, async (request, reply) => {
    try {
      const printer = database.savePrinter(request.body || {}, request.params.id);
      return printer ? { printer } : errorReply(reply, new Error("Printer not found"), 404);
    } catch (error) {
      return errorReply(reply, error);
    }
  });
  app.delete("/api/admin/printers/:id", { preHandler: requireAdmin, schema: { params: IdParams } }, async (request, reply) => {
    if (!database.deletePrinter(request.params.id)) return errorReply(reply, new Error("Printer not found"), 404);
    return reply.code(204).send();
  });
  app.get("/api/admin/print-jobs", { preHandler: requireFloor, schema: { querystring: PrintJobsQuery } }, async (request) => ({
    jobs: database.listPrintJobs(request.query.status, request.query.limit)
  }));
  app.post("/api/admin/print-jobs/:id/retry", { preHandler: requireFloor, schema: { params: IdParams } }, async (request, reply) => {
    if (!database.retryPrintJob(request.params.id)) return errorReply(reply, new Error("Only failed print jobs can be retried"), 409);
    return { ok: true, id: request.params.id };
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "API route not found" });
    // Never answer a missing bundle with the HTML shell: browsers then fail on the MIME type
    // instead of showing that the build is stale.
    if (request.url.startsWith("/assets/") || request.url.startsWith("/media/")) {
      return reply.code(404).send({ error: "Asset not found" });
    }
    const fallback = path.join(config.webDir, request.url === "/admin" ? "admin.html" : "index.html");
    if (existsSync(fallback)) return reply.type("text/html").sendFile(path.basename(fallback), config.webDir);
    return reply.code(404).send({ error: "Run npm run build before using the production web server" });
  });
}

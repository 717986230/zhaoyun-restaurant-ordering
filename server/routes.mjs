import { createWriteStream, existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { pipeline } from "node:stream/promises";
import {
  CreateOrderBody, IdParams, LimitQuery, OrderStatusBody, PrinterBody, PrintJobsQuery,
  ProductBody, ServiceRequestBody, ServiceStatusBody
} from "./schemas.mjs";

const MEDIA_TYPES = new Map([
  ["image/jpeg", { type: "image", extension: ".jpg" }],
  ["image/png", { type: "image", extension: ".png" }],
  ["image/webp", { type: "image", extension: ".webp" }],
  ["video/mp4", { type: "video", extension: ".mp4" }],
  ["video/webm", { type: "video", extension: ".webm" }]
]);

const AUTH_WINDOW_MS = 5 * 60 * 1000;
const AUTH_MAX_FAILURES = 5;

function tokenMatches(provided, expected) {
  const providedBytes = Buffer.from(typeof provided === "string" ? provided : "", "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  const candidate = providedBytes.length === expectedBytes.length ? providedBytes : Buffer.alloc(expectedBytes.length);
  return providedBytes.length === expectedBytes.length && timingSafeEqual(candidate, expectedBytes);
}

function errorReply(reply, error, statusCode = 400) {
  return reply.code(statusCode).send({ error: error.message || "Request failed" });
}

export function registerRoutes(app, { database, realtime, config }) {
  const authFailures = new Map();

  function requireAdmin(request, reply, done) {
    const now = Date.now();
    const key = request.ip || "unknown";
    const current = authFailures.get(key);
    if (current && current.resetAt <= now) authFailures.delete(key);
    const active = authFailures.get(key);
    if (active && active.failures >= AUTH_MAX_FAILURES) {
      const retryAfter = Math.max(1, Math.ceil((active.resetAt - now) / 1000));
      reply.header("retry-after", retryAfter);
      reply.code(429).send({ error: "Too many authentication attempts", retryAfter });
      return;
    }
    if (!tokenMatches(request.headers["x-admin-token"], config.adminToken)) {
      const failures = (active?.failures ?? 0) + 1;
      authFailures.set(key, { failures, resetAt: now + AUTH_WINDOW_MS });
      reply.code(401).send({ error: "Admin authentication required" });
      return;
    }
    authFailures.delete(key);
    done();
  }

  app.get("/api/health", async () => ({
    ok: true,
    realtimeClients: realtime.size(),
    timestamp: new Date().toISOString()
  }));

  app.get("/ws", { websocket: true }, (socket) => realtime.connect(socket));

  app.get("/api/catalog", async () => ({ products: database.listProducts(true) }));
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

  app.get("/api/orders", { preHandler: requireAdmin, schema: { querystring: LimitQuery } }, async (request) => ({
    orders: database.listOrders(request.query.limit)
  }));
  app.post("/api/orders", { schema: { body: CreateOrderBody } }, async (request, reply) => {
    try {
      const order = database.createOrder(request.body || {});
      realtime.broadcast("order.changed", order);
      realtime.broadcast("print.queued", { orderId: order.id });
      return reply.code(201).send({ order });
    } catch (error) {
      return errorReply(reply, error);
    }
  });
  app.patch("/api/orders/:id/status", { preHandler: requireAdmin, schema: { params: IdParams, body: OrderStatusBody } }, async (request, reply) => {
    try {
      const order = database.updateOrder(request.params.id, request.body?.status);
      if (!order) return errorReply(reply, new Error("Order not found"), 404);
      realtime.broadcast("order.changed", order);
      return { order };
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  app.get("/api/service-requests", { preHandler: requireAdmin, schema: { querystring: LimitQuery } }, async (request) => ({
    requests: database.listServiceRequests(request.query.limit)
  }));
  app.post("/api/service-requests", { schema: { body: ServiceRequestBody } }, async (request, reply) => {
    try {
      const serviceRequest = database.createServiceRequest(request.body || {});
      realtime.broadcast("service.changed", serviceRequest);
      return reply.code(201).send({ request: serviceRequest });
    } catch (error) {
      return errorReply(reply, error);
    }
  });
  app.patch("/api/service-requests/:id/status", { preHandler: requireAdmin, schema: { params: IdParams, body: ServiceStatusBody } }, async (request, reply) => {
    try {
      const serviceRequest = database.updateServiceRequest(request.params.id, request.body?.status);
      if (!serviceRequest) return errorReply(reply, new Error("Service request not found"), 404);
      realtime.broadcast("service.changed", serviceRequest);
      return { request: serviceRequest };
    } catch (error) {
      return errorReply(reply, error);
    }
  });

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
  app.get("/api/admin/print-jobs", { preHandler: requireAdmin, schema: { querystring: PrintJobsQuery } }, async (request) => ({
    jobs: database.listPrintJobs(request.query.status, request.query.limit)
  }));
  app.post("/api/admin/print-jobs/:id/retry", { preHandler: requireAdmin, schema: { params: IdParams } }, async (request, reply) => {
    if (!database.retryPrintJob(request.params.id)) return errorReply(reply, new Error("Only failed print jobs can be retried"), 409);
    return { ok: true, id: request.params.id };
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "API route not found" });
    const fallback = path.join(config.webDir, request.url === "/admin" ? "admin.html" : "index.html");
    if (existsSync(fallback)) return reply.type("text/html").sendFile(path.basename(fallback), config.webDir);
    return reply.code(404).send({ error: "Run npm run build before using the production web server" });
  });
}

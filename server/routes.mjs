import { createWriteStream, existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";

const MEDIA_TYPES = new Map([
  ["image/jpeg", { type: "image", extension: ".jpg" }],
  ["image/png", { type: "image", extension: ".png" }],
  ["image/webp", { type: "image", extension: ".webp" }],
  ["video/mp4", { type: "video", extension: ".mp4" }],
  ["video/webm", { type: "video", extension: ".webm" }]
]);

function errorReply(reply, error, statusCode = 400) {
  return reply.code(statusCode).send({ error: error.message || "Request failed" });
}

export function registerRoutes(app, { database, realtime, config }) {
  function requireAdmin(request, reply, done) {
    if (request.headers["x-admin-token"] !== config.adminToken) {
      reply.code(401).send({ error: "Admin authentication required" });
      return;
    }
    done();
  }

  app.get("/api/health", async () => ({
    ok: true,
    realtimeClients: realtime.size(),
    timestamp: new Date().toISOString()
  }));

  app.get("/ws", { websocket: true }, (socket) => realtime.connect(socket));

  app.get("/api/catalog", async () => ({ products: database.listProducts(true) }));
  app.get("/api/admin/products", { preHandler: requireAdmin }, async () => ({ products: database.listProducts(false) }));
  app.get("/api/admin/products/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const product = database.getProduct(request.params.id);
    return product || errorReply(reply, new Error("Product not found"), 404);
  });
  app.post("/api/admin/products", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const product = database.saveProduct(request.body || {});
      realtime.broadcast("catalog.changed", { productId: product.id });
      return reply.code(201).send({ product });
    } catch (error) {
      return errorReply(reply, error);
    }
  });
  app.put("/api/admin/products/:id", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const product = database.saveProduct(request.body || {}, request.params.id);
      if (!product) return errorReply(reply, new Error("Product not found"), 404);
      realtime.broadcast("catalog.changed", { productId: product.id });
      return { product };
    } catch (error) {
      return errorReply(reply, error);
    }
  });
  app.delete("/api/admin/products/:id", { preHandler: requireAdmin }, async (request, reply) => {
    if (!database.deleteProduct(request.params.id)) return errorReply(reply, new Error("Product not found"), 404);
    realtime.broadcast("catalog.changed", { productId: request.params.id });
    return reply.code(204).send();
  });

  app.post("/api/admin/products/:id/media", { preHandler: requireAdmin }, async (request, reply) => {
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
      if (part.file.truncated) return errorReply(reply, new Error("Media file exceeds 50 MB"), 413);
      const product = database.addMedia(request.params.id, {
        type: accepted.type,
        url: `/media/${filename}`
      });
      if (!product) return errorReply(reply, new Error("Product not found"), 404);
      realtime.broadcast("catalog.changed", { productId: product.id });
      return reply.code(201).send({ product });
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  app.get("/api/orders", { preHandler: requireAdmin }, async (request) => ({
    orders: database.listOrders(request.query.limit)
  }));
  app.post("/api/orders", async (request, reply) => {
    try {
      const order = database.createOrder(request.body || {});
      realtime.broadcast("order.changed", order);
      realtime.broadcast("print.queued", { orderId: order.id });
      return reply.code(201).send({ order });
    } catch (error) {
      return errorReply(reply, error);
    }
  });
  app.patch("/api/orders/:id/status", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const order = database.updateOrder(request.params.id, request.body?.status);
      if (!order) return errorReply(reply, new Error("Order not found"), 404);
      realtime.broadcast("order.changed", order);
      return { order };
    } catch (error) {
      return errorReply(reply, error);
    }
  });

  app.get("/api/service-requests", { preHandler: requireAdmin }, async (request) => ({
    requests: database.listServiceRequests(request.query.limit)
  }));
  app.post("/api/service-requests", async (request, reply) => {
    try {
      const serviceRequest = database.createServiceRequest(request.body || {});
      realtime.broadcast("service.changed", serviceRequest);
      return reply.code(201).send({ request: serviceRequest });
    } catch (error) {
      return errorReply(reply, error);
    }
  });
  app.patch("/api/service-requests/:id/status", { preHandler: requireAdmin }, async (request, reply) => {
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
  app.post("/api/admin/printers", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      return reply.code(201).send({ printer: database.savePrinter(request.body || {}) });
    } catch (error) {
      return errorReply(reply, error);
    }
  });
  app.put("/api/admin/printers/:id", { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const printer = database.savePrinter(request.body || {}, request.params.id);
      return printer ? { printer } : errorReply(reply, new Error("Printer not found"), 404);
    } catch (error) {
      return errorReply(reply, error);
    }
  });
  app.delete("/api/admin/printers/:id", { preHandler: requireAdmin }, async (request, reply) => {
    if (!database.deletePrinter(request.params.id)) return errorReply(reply, new Error("Printer not found"), 404);
    return reply.code(204).send();
  });
  app.get("/api/admin/print-jobs", { preHandler: requireAdmin }, async (request) => ({
    jobs: database.listPrintJobs(request.query.status, request.query.limit)
  }));

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "API route not found" });
    const fallback = path.join(config.webDir, request.url === "/admin" ? "admin.html" : "index.html");
    if (existsSync(fallback)) return reply.type("text/html").sendFile(path.basename(fallback), config.webDir);
    return reply.code(404).send({ error: "Run npm run build before using the production web server" });
  });
}

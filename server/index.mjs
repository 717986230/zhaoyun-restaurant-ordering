import { mkdirSync, existsSync } from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { assertRoleTokens, config } from "./config.mjs";
import { createDatabase } from "./database.mjs";
import { createRealtimeHub } from "./realtime.mjs";
import { registerRoutes } from "./routes.mjs";

export async function buildServer(overrides = {}) {
  const settings = { ...config, ...overrides };
  if (settings.isProduction && (settings.adminToken === "local-dev-admin" || typeof settings.adminToken !== "string" || settings.adminToken.length < 32)) {
    throw new Error("Production ADMIN_TOKEN must be at least 32 characters and must not use the development token");
  }

  assertRoleTokens(settings);

  mkdirSync(settings.uploadDir, { recursive: true });
  const app = Fastify({ logger: overrides.logger ?? true, bodyLimit: 2 * 1024 * 1024, requestIdHeader: "x-request-id", trustProxy: settings.trustProxy ?? false });
  const database = createDatabase(settings.databasePath);
  const realtime = createRealtimeHub();

  await app.register(cors, {
    origin: settings.isProduction ? settings.corsOrigin : true,
    allowedHeaders: ["content-type", "x-admin-token", "x-table-token"]
  });
  await app.register(websocket);
  await app.register(multipart);
  await app.register(fastifyStatic, {
    root: settings.uploadDir,
    prefix: "/media/",
    decorateReply: true
  });
  if (existsSync(settings.webDir)) {
    await app.register(fastifyStatic, {
      root: settings.webDir,
      prefix: "/",
      decorateReply: false,
      wildcard: false
    });
  }

  // Uploaded media is user-controlled: never let a browser sniff it into an active document.
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "SAMEORIGIN");
    if (request.url.startsWith("/media/")) {
      reply.header("content-security-policy", "default-src 'none'; img-src 'self'; media-src 'self'; sandbox");
    }
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode = error.validation ? 400 : (error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500);
    request.log.error({ err: error, requestId: request.id }, "request failed");
    return reply.code(statusCode).send({
      error: statusCode === 500 ? "Internal server error" : (error.validation ? "Invalid request" : error.message),
      requestId: request.id
    });
  });

  registerRoutes(app, { database, realtime, config: settings });
  app.addHook("onClose", async () => database.close());
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildServer();
  try {
    await app.listen({ host: config.host, port: config.port });
    if (!config.isProduction && config.adminToken === "local-dev-admin") {
      app.log.warn("Development admin token: local-dev-admin");
    }
    const shutdown = async (signal) => {
      app.log.info({ signal }, "shutting down");
      await app.close();
      process.exit(0);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

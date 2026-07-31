import { mkdirSync, existsSync } from "node:fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { config } from "./config.mjs";
import { createDatabase } from "./database.mjs";
import { createRealtimeHub } from "./realtime.mjs";
import { registerRoutes } from "./routes.mjs";

export async function buildServer(overrides = {}) {
  const settings = { ...config, ...overrides };
  if (settings.isProduction && settings.adminToken === "local-dev-admin") {
    throw new Error("ADMIN_TOKEN must be set in production");
  }

  mkdirSync(settings.uploadDir, { recursive: true });
  const app = Fastify({ logger: overrides.logger ?? true, bodyLimit: 2 * 1024 * 1024 });
  const database = createDatabase(settings.databasePath);
  const realtime = createRealtimeHub();

  await app.register(cors, {
    origin: settings.isProduction ? false : true,
    allowedHeaders: ["content-type", "x-admin-token"]
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
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}


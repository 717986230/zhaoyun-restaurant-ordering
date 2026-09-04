import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(serverDir, "..");

export const config = {
  host: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT || 8787),
  isProduction: process.env.NODE_ENV === "production",
  // One shared token per role. A restaurant has no user directory; what matters
  // is that a waiter's tablet cannot edit prices or delete dishes.
  adminToken: process.env.ADMIN_TOKEN || "local-dev-admin",
  staffToken: process.env.STAFF_TOKEN || "",
  kitchenToken: process.env.KITCHEN_TOKEN || "",
  corsOrigin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean) : false,
  databasePath: process.env.DATABASE_PATH || path.join(serverDir, "data", "restaurant.sqlite"),
  uploadDir: process.env.UPLOAD_DIR || path.join(serverDir, "uploads"),
  webDir: path.join(projectDir, "dist", "web"),
  // Guest devices post orders and service calls without a token: cap the burst per client IP.
  publicRateLimitWindowMs: Number(process.env.PUBLIC_RATE_LIMIT_WINDOW_MS || 60_000),
  orderRateLimitMax: Number(process.env.ORDER_RATE_LIMIT_MAX || 60),
  serviceRateLimitMax: Number(process.env.SERVICE_RATE_LIMIT_MAX || 20)
};

if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

if (config.isProduction && (config.adminToken === "local-dev-admin" || config.adminToken.length < 32)) {
  throw new Error("Production ADMIN_TOKEN must be at least 32 characters and must not use the development token");
}

export function assertRoleTokens(settings) {
  const optional = [["STAFF_TOKEN", settings.staffToken], ["KITCHEN_TOKEN", settings.kitchenToken]];
  for (const [name, token] of optional) {
    if (!token) continue;
    if (settings.isProduction && token.length < 32) throw new Error(`Production ${name} must be at least 32 characters`);
    if (token === settings.adminToken) throw new Error(`${name} must differ from ADMIN_TOKEN`);
  }
  if (settings.staffToken && settings.staffToken === settings.kitchenToken) {
    throw new Error("STAFF_TOKEN must differ from KITCHEN_TOKEN");
  }
}

assertRoleTokens(config);

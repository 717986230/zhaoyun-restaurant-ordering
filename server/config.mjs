import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(serverDir, "..");

/**
 * Only an explicit list of trusted proxy addresses is accepted.
 *
 * A hop count (`TRUST_PROXY=2`) silently stops resolving forwarded addresses on fastify >= 5.12
 * — the hardening for GHSA-3m5p-2c4r-xxw2 — so accepting it would leave every request looking
 * like it came from the proxy and keep the auth rate limiter locking out all admins at once.
 * `true` is worse: it takes the leftmost X-Forwarded-For entry, which any client can set.
 * Both fail loudly here rather than appearing to work.
 */
function parseTrustProxy(value) {
  if (value === undefined || value.trim() === "") return false;
  const normalized = value.trim();
  if (normalized === "false") return false;
  if (normalized === "true" || /^\d+$/.test(normalized)) {
    throw new Error("TRUST_PROXY must list trusted proxy addresses or subnets (for example 10.0.0.0/8,127.0.0.1); 'true' and hop counts are not supported");
  }
  return normalized.split(",").map((entry) => entry.trim()).filter(Boolean);
}

export const config = {
  host: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT || 8787),
  isProduction: process.env.NODE_ENV === "production",
  adminToken: process.env.ADMIN_TOKEN || "local-dev-admin",
  corsOrigin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean) : false,
  databasePath: process.env.DATABASE_PATH || path.join(serverDir, "data", "restaurant.sqlite"),
  uploadDir: process.env.UPLOAD_DIR || path.join(serverDir, "uploads"),
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  webDir: path.join(projectDir, "dist", "web")
};

if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

if (config.isProduction && (config.adminToken === "local-dev-admin" || config.adminToken.length < 32)) {
  throw new Error("Production ADMIN_TOKEN must be at least 32 characters and must not use the development token");
}

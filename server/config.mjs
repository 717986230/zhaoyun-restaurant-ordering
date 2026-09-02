import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(serverDir, "..");

function parseTrustProxy(value) {
  if (!value) return false;
  const normalized = value.trim();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  if (/^\d+$/.test(normalized)) return Number(normalized);
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

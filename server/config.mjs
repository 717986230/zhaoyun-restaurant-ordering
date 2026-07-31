import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(serverDir, "..");

export const config = {
  host: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT || 8787),
  isProduction: process.env.NODE_ENV === "production",
  adminToken: process.env.ADMIN_TOKEN || "local-dev-admin",
  databasePath: process.env.DATABASE_PATH || path.join(serverDir, "data", "restaurant.sqlite"),
  uploadDir: process.env.UPLOAD_DIR || path.join(serverDir, "uploads"),
  webDir: path.join(projectDir, "dist", "web")
};


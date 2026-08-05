import { mkdirSync, cpSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.mjs";

const backupRoot = process.env.BACKUP_DIR || path.join(path.dirname(config.databasePath), "backups");
const timestamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "-");
const target = path.join(backupRoot, timestamp);
const databaseTarget = path.join(target, "restaurant.sqlite");

try {
  mkdirSync(backupRoot, { recursive: true });
  mkdirSync(target, { recursive: true });
  const source = new DatabaseSync(config.databasePath, { readOnly: true });
  try {
    source.exec(`VACUUM INTO '${databaseTarget.replaceAll("'", "''")}'`);
  } finally {
    source.close();
  }
  const verify = new DatabaseSync(databaseTarget, { readOnly: true });
  try {
    const integrity = verify.prepare("PRAGMA integrity_check").get().integrity_check;
    if (integrity !== "ok") throw new Error(`Backup integrity check failed: ${integrity}`);
    const products = verify.prepare("SELECT COUNT(*) AS count FROM products").get().count;
    console.log(JSON.stringify({ backup: target, products, integrity }));
  } finally {
    verify.close();
  }
  mkdirSync(config.uploadDir, { recursive: true });
  cpSync(config.uploadDir, path.join(target, "uploads"), { recursive: true, force: true, errorOnExist: false });
} catch (error) {
  rmSync(target, { recursive: true, force: true });
  console.error(error);
  process.exitCode = 1;
}

/**
 * Writes the catalogue a fresh server would serve into the customer app, so a
 * tablet that has never reached the server still shows the real menu.
 *
 * It seeds a throwaway database and reads it back through the same code path
 * `GET /api/catalog` uses, rather than transforming the seed a second time by
 * hand. A second transformation is a second thing to keep in step, and the
 * product ids have to match the server's exactly — an order naming a dish the
 * server has never heard of is rejected for good once the tablet reconnects.
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../server/database.mjs";

const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "apps", "customer-app", "src", "app", "bundled-catalog.json");

export function generate() {
  const directory = mkdtempSync(path.join(tmpdir(), "zy-catalog-"));
  try {
    const database = createDatabase(path.join(directory, "catalog.sqlite"));
    const products = database.listProducts(true);
    database.close();
    // Row timestamps are the moment this ran, so keeping them would make the
    // file differ on every generation and never settle. They also say nothing
    // true about a copy that ships inside the app, and nothing reads them.
    const withoutTimestamps = products.map(({ createdAt, updatedAt, ...product }) => product);
    return `${JSON.stringify(withoutTimestamps, null, 2)}\n`;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function committed() {
  return readFileSync(target, "utf8");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const contents = generate();
  writeFileSync(target, contents);
  console.log(`wrote ${JSON.parse(contents).length} products to ${path.relative(process.cwd(), target)}`);
}

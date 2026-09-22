import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "../index.mjs";
import { contractChecks } from "../../shared/contract-suite.mjs";

const TOKENS = {
  manager: "contract-admin-token-contract-admin-token",
  staff: "contract-staff-token-contract-staff-token",
  kitchen: "contract-kitchen-token-contract-kitchen-tok"
};

/**
 * The shared contract, run against the Fastify server.
 *
 * The same file runs against the Worker on D1 via `npm run worker:test`, which
 * boots `wrangler dev` and points this suite at it. Both must pass: they are two
 * implementations of one API, and the apps cannot tell them apart.
 */
test("Node server satisfies the API contract", async (context) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-contract-"));
  const app = await buildServer({
    databasePath: path.join(directory, "restaurant.sqlite"),
    uploadDir: path.join(directory, "media"),
    adminToken: TOKENS.manager,
    staffToken: TOKENS.staff,
    kitchenToken: TOKENS.kitchen,
    logger: false
  });
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const call = async (method, url, options = {}) => {
    const response = await app.inject({
      method,
      url,
      headers: {
        // `token` is a session token the suite signed in for; `admin`/`role`
        // are the configured shared tokens. Both travel in the same header.
        ...(options.token ? { "x-admin-token": options.token } : {}),
        ...(options.admin || options.role ? { "x-admin-token": TOKENS[options.role || "manager"] } : {}),
        ...(options.tableToken ? { "x-table-token": options.tableToken } : {})
      },
      ...(options.body ? { payload: options.body } : {})
    });
    let json = {};
    try { json = response.body ? response.json() : {}; } catch { json = {}; }
    return { status: response.statusCode, json };
  };

  for (const [name, check] of contractChecks(call, assert)) {
    await context.test(name, check);
  }
});

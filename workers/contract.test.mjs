import assert from "node:assert/strict";
import test from "node:test";
import { contractChecks } from "../shared/contract-suite.mjs";

/**
 * The same contract, against the Worker on D1.
 *
 * `npm run worker:test` starts `wrangler dev` on a throwaway local D1 — the
 * engine D1 runs in production, not a stand-in — applies the migrations, and
 * points this at it. Run directly without WORKER_URL, it skips rather than
 * pretending to have checked anything.
 */
const baseUrl = process.env.WORKER_URL;
const tokens = {
  manager: process.env.WORKER_ADMIN_TOKEN,
  staff: process.env.WORKER_STAFF_TOKEN,
  kitchen: process.env.WORKER_KITCHEN_TOKEN
};

test("Worker on D1 satisfies the API contract", { skip: baseUrl ? false : "set WORKER_URL (npm run worker:test)" }, async (context) => {
  const call = async (method, url, options = {}) => {
    const response = await fetch(`${baseUrl}${url}`, {
      method,
      headers: {
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.raw ? { "content-type": options.raw.contentType } : {}),
        // `token` is a session token the suite signed in for; `admin`/`role`
        // are the configured shared tokens. Both travel in the same header.
        ...(options.token ? { "x-admin-token": options.token } : {}),
        ...(options.admin || options.role ? { "x-admin-token": tokens[options.role || "manager"] } : {}),
        ...(options.tableToken ? { "x-table-token": options.tableToken } : {}),
        ...(options.deviceToken ? { "x-device-token": options.deviceToken } : {})
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      ...(options.raw ? { body: options.raw.body } : {})
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    let json = {};
    try { json = bytes.length ? JSON.parse(bytes.toString("utf8")) : {}; } catch { json = {}; }
    return { status: response.status, json, bytes, headers: Object.fromEntries(response.headers) };
  };

  for (const [name, check] of contractChecks(call, assert)) {
    await context.test(name, check);
  }
});

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
        ...(options.admin || options.role ? { "x-admin-token": tokens[options.role || "manager"] } : {})
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {})
    });
    const text = await response.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
    return { status: response.status, json };
  };

  for (const [name, check] of contractChecks(call, assert)) {
    await context.test(name, check);
  }
});

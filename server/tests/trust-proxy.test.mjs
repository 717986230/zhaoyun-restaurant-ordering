import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildServer } from "../index.mjs";

async function clientIp(context, trustProxy, forwardedFor) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "zhaoyun-proxy-"));
  const app = await buildServer({
    databasePath: path.join(directory, "restaurant.sqlite"),
    uploadDir: path.join(directory, "media"),
    adminToken: "test-admin-token",
    trustProxy,
    logger: false
  });
  app.get("/test-client-ip", async (request) => ({ ip: request.ip }));
  context.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const response = await app.inject({ method: "GET", url: "/test-client-ip", headers: { "x-forwarded-for": forwardedFor } });
  return response.json().ip;
}

test("auth rate limiting sees the real client only with a trusted proxy list", async (context) => {
  const chain = "9.9.9.9, 203.0.113.5";

  // Without a trusted list the forwarded chain must not be believed at all.
  assert.equal(await clientIp(context, false, chain), "127.0.0.1");

  // A trusted list resolves to the right-most address outside that list, which is the
  // address the proxy actually observed. Anything a client prepends is ignored.
  assert.equal(await clientIp(context, ["127.0.0.0/8"], chain), "203.0.113.5");
  assert.equal(await clientIp(context, ["loopback"], chain), "203.0.113.5");
});

test("TRUST_PROXY rejects the forms that silently fail to resolve a client", async () => {
  const { execFileSync } = await import("node:child_process");
  const load = (value) => execFileSync(process.execPath, ["-e", "import('./server/config.mjs').then(() => process.exit(0), (error) => { console.error(error.message); process.exit(1); })"], {
    env: { ...process.env, TRUST_PROXY: value, NODE_ENV: "development" },
    cwd: path.resolve(import.meta.dirname, "..", ".."),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  // A hop count no longer resolves forwarded addresses on fastify >= 5.12 (GHSA-3m5p-2c4r-xxw2),
  // and `true` trusts a client-controlled left-most entry. Both must fail loudly, not silently.
  for (const value of ["1", "2", "true"]) {
    assert.throws(() => load(value), /Command failed/, `TRUST_PROXY=${value} must be rejected`);
  }

  // The supported forms still load.
  for (const value of ["", "false", "10.0.0.0/8,127.0.0.1"]) {
    assert.doesNotThrow(() => load(value), `TRUST_PROXY=${value} must be accepted`);
  }
});

/**
 * Runs the shared API contract against the Worker.
 *
 * Starts `wrangler dev` on a local D1 — workerd and the real D1 engine, not a
 * stand-in — against a throwaway state directory so each run begins from the
 * migrations and nothing leaks between runs. Deploying is a separate matter and
 * needs credentials; this needs none, which is why it can run in CI.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.WORKER_TEST_PORT || 8798);
const ADMIN_TOKEN = "worker-contract-admin-token-worker-contract";
const BASE_URL = `http://127.0.0.1:${PORT}`;

const state = mkdtempSync(path.join(tmpdir(), "zy-worker-"));
let devLog = "";
const children = [];

function cleanup() {
  for (const child of children) {
    try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
  }
  rmSync(state, { recursive: true, force: true });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "pipe", ...options });
    let output = "";
    // With stdio "inherit" there are no pipes to read; attaching to them anyway
    // throws, and the rejection used to tear the Worker down mid-test.
    child.stdout?.on("data", (chunk) => { output += chunk; });
    child.stderr?.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(output) : reject(new Error(`${command} ${args.join(" ")} exited ${code}\n${output}`))));
  });
}

async function waitForHealth(deadlineMs = 120_000) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      const response = await fetch(`${BASE_URL}/api/health`);
      if (response.ok) return;
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("wrangler dev never became healthy");
}

try {
  // A dev var file rather than an environment variable: wrangler only passes
  // these through to the Worker, and this is the mechanism the real deployment
  // uses too (there it is `wrangler secret put ADMIN_TOKEN`).
  writeFileSync(path.join(state, ".dev.vars"), `ADMIN_TOKEN = "${ADMIN_TOKEN}"\n`);

  const wranglerArgs = ["wrangler", "d1", "migrations", "apply", "zhaoyun-ordering", "--local", `--persist-to=${state}`];
  await run("npx", wranglerArgs);

  const dev = spawn("npx", [
    "wrangler", "dev", "--local", "--port", String(PORT), "--ip", "127.0.0.1",
    `--persist-to=${state}`, "--var", `ADMIN_TOKEN:${ADMIN_TOKEN}`
  ], { cwd: root, stdio: ["ignore", "pipe", "pipe"], detached: true });
  children.push(dev);
  dev.stdout.on("data", (chunk) => { devLog += chunk; });
  dev.stderr.on("data", (chunk) => { devLog += chunk; });

  await waitForHealth().catch((error) => { throw new Error(`${error.message}\n${devLog.slice(-4000)}`); });

  await run(process.execPath, ["--test", "workers/contract.test.mjs"], {
    stdio: "inherit",
    env: { ...process.env, WORKER_URL: BASE_URL, WORKER_ADMIN_TOKEN: ADMIN_TOKEN }
  });
  console.log("Worker contract passed");
} catch (error) {
  console.error(error.message);
  if (devLog) console.error(`--- wrangler dev ---\n${devLog.slice(-4000)}`);
  cleanup();
  process.exit(1);
}

cleanup();
process.exit(0);

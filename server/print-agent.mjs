/**
 * The print bridge: the one program that runs in the restaurant, on any
 * computer in the same network as the printers (the till PC, a Raspberry Pi),
 * and turns the queue of tickets into paper.
 *
 * It is how the mature systems do it (Odoo's IoT box, Lightspeed's printer
 * bridge, the 打印助手 of the Chinese POS vendors): the orders live in the
 * cloud, the printers in the shop's own network, and one small program in
 * between reaches out to the first and talks to the second. So nothing in the
 * restaurant has to be reachable from the internet.
 *
 *  - Online: `--url` (the Cloudflare deployment, or a Node server elsewhere)
 *    and `--token`, the token the console shows when it pairs the bridge, or
 *    PRINT_BRIDGE_URL and PRINT_BRIDGE_TOKEN. The first run keeps them in
 *    print-bridge.config.json, so the next start needs neither. It is woken by
 *    the live channel the moment a ticket is queued and polls as a safety net.
 *  - Local: `DATABASE_PATH`, the Node server's own database on this computer.
 *
 * One bridge serves every enabled network printer (or the stations named in
 * `PRINTER_ROLE`, comma-separated). Each ticket goes to the first printer of
 * its station that answers, then to the backup that printer names, in that
 * printer's own language, paper and encoding (server/tickets.mjs). It checks
 * each printer once a minute and tells the console which ones answer.
 *
 * Before it sends a ticket it asks the printer how it is (paper, cover), so
 * a printer out of paper is passed over for its backup instead of taking a
 * ticket it cannot print; and every ten minutes it looks for printers on the
 * shop's network, so the console can offer them without anyone typing an
 * address.
 */
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { printerOptions } from "../shared/printing.mjs";
import { renderTickets } from "./tickets.mjs";

export { renderTickets, renderTickets as renderReceipt };

export const BRIDGE_VERSION = "3";
const log = (event) => console.log(JSON.stringify({ at: new Date().toISOString(), ...event }));

// ——— Where the tickets come from.

/** The API, over HTTPS: the Cloudflare deployment or a Node server. */
export function apiSource({ baseUrl, token, staffToken = "", fetch = globalThis.fetch, timeoutMs = 15_000 }) {
  const base = String(baseUrl).replace(/\/+$/, "");
  const headers = {
    "content-type": "application/json",
    ...(token ? { "x-device-token": token } : {}),
    ...(staffToken ? { "x-admin-token": staffToken } : {})
  };
  async function call(method, path, body) {
    const response = await fetch(`${base}${path}`, {
      method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeoutMs)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${json.error ?? ""}`.trim());
    return json;
  }
  return {
    live: `${base.replace(/^http/, "ws")}/ws?role=staff`,
    printers: async () => (await call("GET", "/api/print-bridge/printers")).printers,
    claim: async (roles, workerId, max) => (await call("POST", "/api/print-bridge/claim", { workerId, roles, max })).jobs,
    complete: async (id, workerId) => (await call("POST", `/api/print-bridge/jobs/${encodeURIComponent(id)}/complete`, { workerId })).ok,
    fail: async (id, workerId, error) => (await call("POST", `/api/print-bridge/jobs/${encodeURIComponent(id)}/fail`, { workerId, error: String(error).slice(0, 1000) })).ok,
    report: async (report) => call("POST", "/api/print-bridge/status", report)
  };
}

/** The Node server's database on this computer. */
export function localSource(database, { leaseMs = 30_000, maxAttempts = 5 } = {}) {
  return {
    live: null,
    printers: async () => (await database.listPrinters()).filter((printer) => printer.enabled),
    claim: (roles, workerId, max) => database.claimPrintJobs(roles, workerId, leaseMs, max),
    complete: (id, workerId) => database.completePrintJob(id, workerId),
    fail: (id, workerId, error) => database.failPrintJob(id, workerId, error, maxAttempts),
    report: (report) => database.recordBridgeReport(report)
  };
}

// ——— How the bytes reach a printer.

/**
 * What a printer says about itself (ESC/POS real-time status, DLE EOT 1, 2
 * and 4): out of paper, cover open, offline, or paper running low. Each
 * answer is one byte whose bits 1 and 4 are always set and 0 and 7 never;
 * anything else is a printer that does not answer this way, and is not
 * held against it.
 */
export const STATUS_QUERY = Buffer.from([0x10, 0x04, 0x01, 0x10, 0x04, 0x02, 0x10, 0x04, 0x04]);
const isStatusByte = (byte) => (byte & 0x93) === 0x12;

export function readPrinterStatus(bytes) {
  if (!bytes || bytes.length < 3 || ![...bytes.subarray(0, 3)].every(isStatusByte)) return { known: false, problem: null, paperLow: false };
  const [printer, cause, paper] = bytes;
  const problem = paper & 0x60 ? "paper-out"
    : cause & 0x04 ? "cover-open"
    : cause & 0x40 ? "error"
    : printer & 0x08 ? "offline"
    : null;
  return { known: true, problem, paperLow: !problem && Boolean(paper & 0x0c) };
}

export class PrinterProblem extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function createLanTransport({ connectTimeoutMs = 3500, statusTimeoutMs = 700 } = {}) {
  /**
   * One connection: ask the printer how it is, give up before sending if it
   * cannot print, otherwise send. A printer that does not answer the question
   * is printed to all the same.
   */
  async function open(printer, payload) {
    const net = await import("node:net");
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const answer = [];
      let settled = false;
      const done = (error, value) => {
        if (settled) return;
        settled = true;
        if (error) {
          socket.destroy();
          reject(error);
        } else {
          socket.end(() => resolve(value));
        }
      };
      socket.setTimeout(connectTimeoutMs, () => done(new Error("Printer connection timed out")));
      socket.once("error", (error) => done(error));
      socket.on("data", (chunk) => answer.push(chunk));
      socket.connect(printer.port || 9100, printer.address, () => {
        socket.write(STATUS_QUERY);
        setTimeout(() => {
          const status = readPrinterStatus(Buffer.concat(answer));
          if (status.problem) return done(new PrinterProblem(status.problem));
          if (!payload) return done(null, status);
          socket.write(payload, (error) => (error ? done(error) : done(null, status)));
        }, statusTimeoutMs);
      });
    });
  }
  return {
    /** Prints, unless the printer says it cannot; what it said. */
    send: (printer, payload) => open(printer, payload),
    /** Whether the printer answers and can print; nothing is printed. */
    probe: (printer) => open(printer, null)
  };
}

/**
 * The network printers in the shop: every address on this computer's own
 * networks (at most a /24 each) that takes a connection on the raw printing
 * port, and whether it answers like a receipt printer. An office printer
 * listens on 9100 too; that is what `escpos` tells apart.
 */
export async function discoverPrinters({ port = 9100, timeoutMs = 400, concurrency = 64, interfaces = null } = {}) {
  const [net, os] = await Promise.all([import("node:net"), import("node:os")]);
  const hosts = new Set();
  for (const entries of Object.values(interfaces ?? os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      const [a, b, c] = entry.address.split(".");
      for (let d = 1; d < 255; d += 1) {
        const host = `${a}.${b}.${c}.${d}`;
        if (host !== entry.address) hosts.add(host);
      }
    }
  }
  const probe = (address) => new Promise((resolve) => {
    const socket = new net.Socket();
    const answer = [];
    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => finish(null));
    socket.once("error", () => finish(null));
    socket.on("data", (chunk) => answer.push(chunk));
    socket.connect(port, address, () => {
      // Connected is found; the wait from here is only for its answer.
      socket.setTimeout(0);
      socket.write(STATUS_QUERY);
      setTimeout(() => finish({ address, port, escpos: readPrinterStatus(Buffer.concat(answer)).known }), timeoutMs);
    });
  });
  const queue = [...hosts];
  const found = [];
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const result = await probe(queue.shift());
      if (result) found.push(result);
    }
  }));
  return found.sort((left, right) => left.address.localeCompare(right.address, "en", { numeric: true }));
}

// ——— The bridge.

const isNetworkPrinter = (printer) => printer.enabled && printer.transport === "lan";

/**
 * The printers a job may go to, in order: a test page to its own printer
 * only; a ticket to its station's printers, then the backup the first of
 * them names.
 */
export function printersFor(job, printers) {
  const byId = new Map(printers.map((printer) => [printer.id, printer]));
  if (job.payload?.kind === "test") return [byId.get(job.payload.printerId)].filter((printer) => printer && isNetworkPrinter(printer));
  const own = printers.filter((printer) => printer.role === job.printerRole && isNetworkPrinter(printer));
  const backup = own.length ? byId.get(printerOptions(own[0].capabilities).backupPrinterId) : null;
  return backup && isNetworkPrinter(backup) && !own.includes(backup) ? [...own, backup] : own;
}

export function createBridge({ source, transport = createLanTransport(), bridgeId, name = bridgeId, stations = null, batch = 5, retryDelayMs = 1_000, discover = discoverPrinters }) {
  const found = new Map();
  let changed = false;
  let discovered = null;

  /** What a printer did, and a note (paper running low) when it printed all the same. */
  function mark(printer, error = null, note = null) {
    const before = found.get(printer.id);
    const ok = !error;
    const detail = error ? String(error.code ?? error.message ?? error).slice(0, 300) : note ?? undefined;
    if (!before || before.ok !== ok || before.error !== detail) changed = true;
    found.set(printer.id, { ok, error: detail });
  }

  /** A call to the server tried again a few times before it is given up on. */
  async function settle(call, attempts = 3) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await call();
      } catch (error) {
        if (attempt >= attempts) {
          log({ event: "bridge_error", error: error instanceof Error ? error.message : String(error) });
          return null;
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
      }
    }
  }

  /** One job to the first of its printers that takes it. */
  async function deliver(job, printers) {
    const candidates = printersFor(job, printers);
    if (!candidates.length) {
      const error = job.payload?.kind === "test" ? "The printer is not an enabled network printer" : `No enabled network printer for the ${job.printerRole} station`;
      await source.fail(job.id, bridgeId, error);
      return { processed: true, status: "not-printed", jobId: job.id, error };
    }
    const errors = [];
    for (const [index, printer] of candidates.entries()) {
      let status;
      try {
        const bytes = renderTickets(job.payload, printer, { station: job.printerRole, standInFor: index ? candidates[0].name : null });
        status = await transport.send(printer, bytes);
      } catch (error) {
        mark(printer, error);
        errors.push(`${printer.name}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      mark(printer, null, status?.paperLow ? "paper-low" : null);
      // Printed: saying so must not fail over a moment's network trouble, or
      // the lease runs out and the kitchen gets the ticket twice.
      await settle(() => source.complete(job.id, bridgeId));
      return { processed: true, status: "printed", jobId: job.id, printerId: printer.id, ...(index ? { standIn: true } : {}) };
    }
    const error = errors.join("; ");
    await source.fail(job.id, bridgeId, error);
    return { processed: true, status: "not-printed", jobId: job.id, error };
  }

  async function servedStations(printers) {
    const own = [...new Set(printers.filter(isNetworkPrinter).map((printer) => printer.role))];
    return stations ? own.filter((role) => stations.includes(role)) : own;
  }

  /** At most `max` jobs, taken and printed; what happened to each. */
  async function processBatch(max = batch) {
    const printers = await source.printers();
    const roles = await servedStations(printers);
    if (!roles.length) return [];
    const jobs = await source.claim(roles, bridgeId, max);
    const results = [];
    for (const job of jobs) results.push(await deliver(job, printers));
    return results;
  }

  /** Everything waiting, until the queue is empty. */
  async function drain() {
    const results = [];
    for (;;) {
      const done = await processBatch();
      results.push(...done);
      if (done.length < batch) return results;
    }
  }

  /** Each printer asked whether it answers; the console told what was found. */
  async function check() {
    const printers = (await source.printers()).filter(isNetworkPrinter);
    const served = stations ? printers.filter((printer) => stations.includes(printer.role)) : printers;
    for (const printer of served) {
      try {
        const status = await transport.probe(printer);
        mark(printer, null, status?.paperLow ? "paper-low" : null);
      } catch (error) {
        mark(printer, error);
      }
    }
    await report(served);
  }

  /** The shop's network searched for printers; the console offers them to add. */
  async function scan() {
    discovered = (await discover()).slice(0, 50);
    changed = true;
    return discovered;
  }

  async function report(printers = null) {
    const ids = printers ? new Set(printers.map((printer) => printer.id)) : null;
    const entries = [...found].filter(([id]) => !ids || ids.has(id)).map(([id, status]) => ({ id, ok: status.ok, ...(status.error ? { error: status.error } : {}) }));
    changed = false;
    return source.report({ bridgeId, name, version: BRIDGE_VERSION, printers: entries, ...(discovered ? { discovered } : {}) });
  }

  return {
    deliver, processBatch, drain, check, report, scan,
    get statusChanged() { return changed; },
    status: () => Object.fromEntries(found)
  };
}

/** The old one-station, one-job entry point, kept for scripts that call it. */
export async function processPrintJob({ database, role, workerId, transport = createLanTransport(), leaseMs = 30_000, maxAttempts = 5 }) {
  const bridge = createBridge({ source: localSource(database, { leaseMs, maxAttempts }), transport, bridgeId: workerId, stations: [role], batch: 1 });
  const [result] = await bridge.processBatch(1);
  return result ?? { processed: false, reason: "No queued job" };
}

// ——— Running it.

/**
 * Keeps the bridge going: woken by the live channel when there is one,
 * polling in any case (faster while the channel is down), checking the
 * printers every minute and whenever one stops or starts answering.
 */
export function run(bridge, { live = null, pollMs = 5_000, livePollMs = 20_000, checkMs = 60_000, scanMs = 10 * 60_000, WebSocketImpl = globalThis.WebSocket } = {}) {
  let stopped = false;
  let scannedAt = 0;
  let busy = false;
  let again = false;
  let socketOpen = false;
  let socket = null;
  let pollTimer;
  let checkTimer;

  async function work() {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      do {
        again = false;
        for (const result of await bridge.drain()) log({ event: "print_job", ...result });
        if (bridge.statusChanged) await bridge.report();
      } while (again && !stopped);
    } catch (error) {
      log({ event: "bridge_error", error: error instanceof Error ? error.message : String(error) });
    } finally {
      busy = false;
    }
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (stopped) return;
    pollTimer = setTimeout(async () => {
      await work();
      schedulePoll();
    }, socketOpen ? livePollMs : pollMs);
  }

  async function checkNow() {
    try {
      // The shop's network searched now and then, so a printer plugged in shows up on the console.
      if (scanMs && Date.now() - scannedAt >= scanMs) {
        scannedAt = Date.now();
        const printers = await bridge.scan();
        log({ event: "printers_found", count: printers.length });
      }
      await bridge.check();
    } catch (error) {
      log({ event: "check_error", error: error instanceof Error ? error.message : String(error) });
    }
    if (!stopped) checkTimer = setTimeout(checkNow, checkMs);
  }

  function connect() {
    if (!live || !WebSocketImpl || stopped) return;
    socket = new WebSocketImpl(live);
    socket.onopen = () => {
      socketOpen = true;
      log({ event: "live_connected" });
      void work();
    };
    socket.onmessage = (message) => {
      try {
        const { type } = JSON.parse(String(message.data));
        if (type === "floor.changed" || type === "print.queued") void work();
      } catch { /* Not ours to read. */ }
    };
    socket.onclose = () => {
      if (socketOpen) log({ event: "live_closed" });
      socketOpen = false;
      if (!stopped) setTimeout(connect, 5_000);
    };
    socket.onerror = () => { /* onclose follows. */ };
  }

  connect();
  void work();
  schedulePoll();
  void checkNow();
  return {
    stop() {
      stopped = true;
      clearTimeout(pollTimer);
      clearTimeout(checkTimer);
      socket?.close();
    }
  };
}

const CONFIG_FILE = path.join(process.cwd(), "print-bridge.config.json");
// Named, not written in the import, so the single-file build leaves the server's database out.
const LOCAL_DATABASE = "./database.mjs";
const LOCAL_CONFIG = "./config.mjs";

/** `--url=… --token=…` over the environment over what the last run kept; given ones are kept. */
export function bridgeSettings(argv = process.argv.slice(2), env = process.env, file = CONFIG_FILE) {
  const args = Object.fromEntries(argv.filter((arg) => arg.startsWith("--") && arg.includes("=")).map((arg) => {
    const [key, ...value] = arg.slice(2).split("=");
    return [key, value.join("=")];
  }));
  let saved = {};
  try { saved = JSON.parse(readFileSync(file, "utf8")); } catch { /* Nothing kept yet. */ }
  const url = args.url || env.PRINT_BRIDGE_URL || saved.url || "";
  const token = args.token || env.PRINT_BRIDGE_TOKEN || saved.token || "";
  if (args.url || args.token) writeFileSync(file, `${JSON.stringify({ url, token }, null, 2)}\n`, { mode: 0o600 });
  return { url, token, staffToken: env.PRINT_BRIDGE_STAFF_TOKEN || "" };
}

async function main() {
  const stations = process.env.PRINTER_ROLE ? process.env.PRINTER_ROLE.split(",").map((role) => role.trim()).filter(Boolean) : null;
  const bridgeId = process.env.PRINT_AGENT_ID || `bridge-${os.hostname()}`;
  const name = process.env.PRINT_BRIDGE_NAME || os.hostname();
  const once = process.argv.includes("--once");
  const settings = bridgeSettings();
  let source;
  let close = () => {};
  if (settings.url) {
    if (!settings.token && !settings.staffToken) throw new Error("A token is required: pair the bridge on the console (Printers → Connect a print bridge)");
    source = apiSource({ baseUrl: settings.url, token: settings.token, staffToken: settings.staffToken });
  } else {
    // Only in the repository: the single-file bridge (print-bridge.mjs) is always online.
    const [{ createDatabase }, { config }] = await Promise.all([import(LOCAL_DATABASE), import(LOCAL_CONFIG)]);
    const database = createDatabase(config.databasePath);
    source = localSource(database);
    close = () => database.close();
  }
  const bridge = createBridge({ source, bridgeId, name, stations });
  log({ event: "bridge_started", bridgeId, mode: settings.url ? `online ${settings.url}` : "local", stations: stations ?? "all" });
  if (once) {
    try {
      await bridge.check();
      for (const result of await bridge.drain()) log({ event: "print_job", ...result });
    } finally {
      close();
    }
    return;
  }
  const pollMs = Math.max(500, Number(process.env.PRINT_POLL_MS || (source.live ? 5_000 : 1_500)));
  const running = run(bridge, { live: source.live, pollMs });
  const stop = () => {
    running.stop();
    close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}

import { createDatabase } from "./database.mjs";
import { config } from "./config.mjs";

const ESC = 0x1b;
const GS = 0x1d;

function line(value = "") {
  return `${String(value).replace(/[\u0000-\u001f]/g, "")}\n`;
}

export function renderReceipt(payload) {
  const lines = [
    "ZHAO YUN RESTAURANT",
    `Order ${payload.orderNo || ""}  Table ${payload.table || ""}`,
    "--------------------------------"
  ];
  for (const item of payload.items || []) {
    lines.push(`${item.quantity} x ${item.name || item.sku || "Item"}`);
    for (const modifier of item.modifiers || []) lines.push(`  - ${modifier.name}${modifier.price ? ` (+${Number(modifier.price).toFixed(2)})` : ""}`);
  }
  if (payload.note) lines.push(`Note: ${payload.note}`);
  lines.push("--------------------------------", "\n");
  return Buffer.concat([
    Buffer.from([ESC, 0x40]),
    Buffer.from(lines.map(line).join(""), "utf8"),
    Buffer.from([GS, 0x56, 0x00])
  ]);
}

export function createLanTransport({ connectTimeoutMs = 3500 } = {}) {
  return {
    async send(printer, payload) {
      const net = await import("node:net");
      await new Promise((resolve, reject) => {
        const socket = new net.Socket();
        const fail = (error) => { socket.destroy(); reject(error); };
        socket.setTimeout(connectTimeoutMs, () => fail(new Error("Printer connection timed out")));
        socket.once("error", fail);
        socket.connect(printer.port || 9100, printer.address, () => {
          socket.write(payload, (error) => {
            if (error) { fail(error); return; }
            socket.end(resolve);
          });
        });
      });
    }
  };
}

export async function processPrintJob({ database, role, workerId, transport = createLanTransport(), leaseMs = 30_000, maxAttempts = 5 }) {
  const printer = database.printerForRole(role);
  if (!printer || printer.transport !== "lan") return { processed: false, reason: "No enabled LAN printer configured for role" };
  const job = database.claimPrintJob(role, workerId, leaseMs);
  if (!job) return { processed: false, reason: "No queued job" };
  try {
    await transport.send(printer, renderReceipt(job.payload));
    database.completePrintJob(job.id, workerId);
    return { processed: true, status: "printed", jobId: job.id };
  } catch (error) {
    database.failPrintJob(job.id, workerId, error instanceof Error ? error.message : String(error), maxAttempts);
    return { processed: true, status: "retry-wait", jobId: job.id, error: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  const role = process.env.PRINTER_ROLE;
  if (!role) throw new Error("PRINTER_ROLE is required");
  const database = createDatabase(config.databasePath);
  const workerId = process.env.PRINT_AGENT_ID || `${role}-${process.pid}`;
  const intervalMs = Math.max(500, Number(process.env.PRINT_POLL_MS || 1500));
  const once = process.argv.includes("--once");
  const run = async () => processPrintJob({ database, role, workerId });
  try {
    do {
      const result = await run();
      if (result.processed) console.log(JSON.stringify({ event: "print_job", ...result, role, workerId }));
      if (!once) await new Promise((resolve) => setTimeout(resolve, intervalMs));
    } while (!once);
  } finally {
    database.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}

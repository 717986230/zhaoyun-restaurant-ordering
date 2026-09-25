import { createDatabase } from "./database.mjs";
import { config } from "./config.mjs";
import iconv from "iconv-lite";

const ESC = 0x1b;
const GS = 0x1d;

function line(value = "") {
  return `${String(value).replace(/[\u0000-\u001f]/g, "")}\n`;
}

const labels = {
  zh: {
    title: "赵云餐厅", order: "订单", table: "桌号", note: "备注",
    bill: "账单", total: "合计", net: "净额", vat: "增值税", rate: "税率",
    disclaimer: "内部账单，不是税务收据",
    kitchen: "后厨单 · 不是收据"
  },
  de: {
    title: "ZHAO YUN RESTAURANT", order: "Bestellung", table: "Tisch", note: "Notiz",
    bill: "Rechnung", total: "Gesamt", net: "Netto", vat: "MwSt", rate: "Satz",
    disclaimer: "Interne Rechnung, kein Kassenbeleg",
    kitchen: "KÜCHENBON – KEIN BELEG"
  },
  en: {
    title: "ZHAO YUN RESTAURANT", order: "Order", table: "Table", note: "Note",
    bill: "Bill", total: "Total", net: "Net", vat: "VAT", rate: "Rate",
    disclaimer: "Internal bill, not a fiscal receipt",
    kitchen: "Kitchen ticket – not a receipt"
  }
};

const RULE = "--------------------------------";

function money(value) {
  return Number(value || 0).toFixed(2);
}

/** A kitchen ticket: what to cook, for which table. No price and no tax —
 *  it is not a receipt, and says so on its first line. */
function orderLines(payload, copy, language) {
  const lines = [
    copy.kitchen,
    copy.title,
    `${copy.order} ${payload.orderNo || ""}  ${copy.table} ${payload.table || ""}`,
    RULE
  ];
  for (const item of payload.items || []) {
    lines.push(`${item.quantity} x ${item.names?.[language] || item.name || item.sku || "Item"}`);
    for (const modifier of item.modifiers || []) lines.push(`  - ${modifier.names?.[language] || modifier.name}`);
  }
  if (payload.note) lines.push(`${copy.note}: ${payload.note}`);
  lines.push(RULE, "\n");
  return lines;
}

function billLines(payload, copy, language) {
  const lines = [
    copy.title,
    `${copy.bill}  ${copy.table} ${payload.table || ""}`,
    payload.issuedAt ? new Date(payload.issuedAt).toLocaleString("de-AT") : "",
    RULE
  ];
  for (const item of payload.items || []) {
    lines.push(`${item.qty} x ${item.names?.[language] || item.name || "Item"}`);
    for (const modifier of item.modifiers || []) lines.push(`  - ${modifier.names?.[language] || modifier.name}`);
    // A set menu over two rates shows both.
    const rates = item.vatSplit ? item.vatSplit.map((part) => `${part.percent}%`).join("/") : `${item.vatPercent}%`;
    lines.push(`      ${money(item.lineTotal)}  ${rates}`);
  }
  lines.push(RULE, `${copy.total}: EUR ${money(payload.total)}`);
  for (const group of payload.vatBreakdown || []) {
    lines.push(`${copy.rate} ${group.percent}%  ${copy.net} ${money(group.net)}  ${copy.vat} ${money(group.vat)}`);
  }
  lines.push(RULE, copy.disclaimer, "\n");
  return lines;
}

export function renderReceipt(payload, printer = {}) {
  const capabilities = printer.capabilities || {};
  const language = ["zh", "de", "en"].includes(capabilities.printLanguage) ? capabilities.printLanguage : "zh";
  const encoding = ["utf8", "gb18030", "shift_jis", "cp437"].includes(capabilities.encoding) ? capabilities.encoding : "utf8";
  const copy = labels[language];
  const lines = payload.kind === "bill" ? billLines(payload, copy, language) : orderLines(payload, copy, language);
  return Buffer.concat([
    Buffer.from([ESC, 0x40]),
    iconv.encode(lines.filter((value) => value !== "").map(line).join(""), encoding),
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
    await transport.send(printer, renderReceipt(job.payload, printer));
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

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
    kitchen: "后厨单 · 不是收据",
    unsigned: "测试小票 · 未签名（RKSV）", receipt: "小票", register: "收银机", storno: "冲销", stornoOf: "冲销小票 {no}",
    sum: "合计", cash: "现金", card: "银行卡", voucher: "代金券", tendered: "收", change: "找零", gross: "含税",
    voucherCode: "代金券码", closing: "日结", sales: "销售", stornos: "冲销", receipts: "小票", vouchersSold: "售出代金券", uid: "UID"
  },
  de: {
    title: "ZHAO YUN RESTAURANT", order: "Bestellung", table: "Tisch", note: "Notiz",
    bill: "Rechnung", total: "Gesamt", net: "Netto", vat: "MwSt", rate: "Satz",
    disclaimer: "Interne Rechnung, kein Kassenbeleg",
    kitchen: "KÜCHENBON – KEIN BELEG",
    unsigned: "TESTBELEG – NICHT SIGNIERT", receipt: "Beleg", register: "Kasse", storno: "STORNO", stornoOf: "Storno zu Beleg {no}",
    sum: "SUMME", cash: "Bar", card: "Karte", voucher: "Gutschein", tendered: "gegeben", change: "Rückgeld", gross: "Brutto",
    voucherCode: "Gutschein-Code", closing: "TAGESABSCHLUSS", sales: "Verkäufe", stornos: "Stornos", receipts: "Belege", vouchersSold: "Gutscheine verkauft", uid: "UID"
  },
  en: {
    title: "ZHAO YUN RESTAURANT", order: "Order", table: "Table", note: "Note",
    bill: "Bill", total: "Total", net: "Net", vat: "VAT", rate: "Rate",
    disclaimer: "Internal bill, not a fiscal receipt",
    kitchen: "Kitchen ticket – not a receipt",
    unsigned: "TEST RECEIPT – NOT SIGNED", receipt: "Receipt", register: "Register", storno: "CANCELLATION", stornoOf: "Cancels receipt {no}",
    sum: "TOTAL", cash: "Cash", card: "Card", voucher: "Voucher", tendered: "given", change: "change", gross: "Gross",
    voucherCode: "Voucher code", closing: "DAY CLOSING", sales: "sales", stornos: "cancellations", receipts: "Receipts", vouchersSold: "Vouchers sold", uid: "UID"
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

const WIDTH = RULE.length;
const euros = (cents) => (Number(cents || 0) / 100).toFixed(2);
/** Text on the left, an amount on the right, on one 32-column line. */
function row(left, right) {
  const text = String(left);
  const room = WIDTH - String(right).length - 1;
  return `${text.length > room ? text.slice(0, room) : text.padEnd(room)} ${right}`;
}
const at = (iso) => (iso ? new Date(iso).toLocaleString("de-AT", { timeZone: "Europe/Vienna" }) : "");

function companyLines(company = {}, copy) {
  return [company.name, company.address, company.uid ? `${copy.uid}: ${company.uid}` : ""].filter(Boolean);
}

/**
 * A register receipt (shared/register.mjs): who issued it, its number, the
 * register and the time, each line, the amount per VAT rate, and how it was
 * paid. Until the receipt is signed (fiskaly) it says, at its head and its
 * foot, that it is a test receipt.
 */
function receiptLines(payload, copy) {
  const receipt = payload.receipt;
  const unsigned = receipt.fiscalStatus !== "signed";
  const lines = [
    ...(unsigned ? [copy.unsigned] : []),
    ...companyLines(payload.company, copy),
    RULE,
    `${copy.receipt} ${receipt.receiptNo}  ${copy.register} ${receipt.cashRegisterId}`,
    `${at(receipt.createdAt)}${receipt.table ? `  ${copy.table} ${receipt.table}` : ""}`
  ];
  if (receipt.type === "storno") lines.push(copy.storno, copy.stornoOf.replace("{no}", String(receipt.refersToNo ?? "")), receipt.reason || "");
  lines.push(RULE);
  for (const line of receipt.lines) {
    lines.push(row(`${line.quantity} x ${line.name}`, euros(line.totalCents)));
    for (const modifier of line.modifiers || []) lines.push(`  - ${modifier}`);
    lines.push(`    ${line.vatSplit.map((part) => `${part.percent}%`).join("/")}${line.quantity !== 1 && line.quantity !== -1 ? `  à ${euros(line.unitPriceCents)}` : ""}`);
  }
  lines.push(RULE, row(`${copy.sum} EUR`, euros(receipt.totalCents)));
  // Per rate on one line: rate, net and tax on the left, the gross amount
  // (what § 11 RKSV asks per rate) in the amount column.
  for (const group of receipt.vat) lines.push(row(`${group.percent}% ${copy.net} ${euros(group.netCents)} ${copy.vat} ${euros(group.vatCents)}`, euros(group.grossCents)));
  lines.push(RULE);
  for (const payment of receipt.payments) {
    lines.push(row(`${copy[payment.type] ?? payment.type}${payment.voucherCode ? ` ${payment.voucherCode}` : ""}`, euros(payment.amountCents)));
    if (payment.tenderedCents) lines.push(`  ${copy.tendered} ${euros(payment.tenderedCents)}  ${copy.change} ${euros(payment.changeCents)}`);
  }
  for (const line of receipt.lines) if (line.kind === "voucher" && receipt.type === "sale") lines.push(RULE, `${copy.voucherCode}: ${line.code}`, row(copy.voucher, euros(line.totalCents)));
  lines.push(RULE, ...(unsigned ? [copy.unsigned] : []), "\n");
  return lines;
}

/** The day's closing (Z report): the run of receipts and what they add up to. */
function closingLines(payload, copy) {
  const { closing } = payload;
  const totals = closing.totals;
  const lines = [
    `${copy.closing} ${closing.closingNo}`,
    ...companyLines(payload.company, copy),
    `${copy.register} ${payload.cashRegisterId}  ${at(closing.createdAt)}`,
    RULE,
    `${copy.receipts} ${totals.firstReceiptNo}–${totals.lastReceiptNo}: ${totals.sales} ${copy.sales}, ${totals.stornos} ${copy.stornos}`,
    row(`${copy.sum} EUR`, euros(totals.grossCents))
  ];
  for (const group of totals.vat) lines.push(row(`${group.percent}% ${copy.net} ${euros(group.netCents)} ${copy.vat} ${euros(group.vatCents)}`, euros(group.grossCents)));
  lines.push(RULE);
  for (const [type, amount] of Object.entries(totals.payments)) lines.push(row(copy[type] ?? type, euros(amount)));
  if (totals.vouchersSoldCents) lines.push(row(copy.vouchersSold, euros(totals.vouchersSoldCents)));
  lines.push(RULE, "\n");
  return lines;
}

export function renderReceipt(payload, printer = {}) {
  const capabilities = printer.capabilities || {};
  const language = ["zh", "de", "en"].includes(capabilities.printLanguage) ? capabilities.printLanguage : "zh";
  const encoding = ["utf8", "gb18030", "shift_jis", "cp437"].includes(capabilities.encoding) ? capabilities.encoding : "utf8";
  const copy = labels[language];
  const lines = payload.kind === "bill" ? billLines(payload, copy, language)
    : payload.kind === "receipt" ? receiptLines(payload, copy)
    : payload.kind === "closing" ? closingLines(payload, copy)
    : orderLines(payload, copy, language);
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

/**
 * Printers and print jobs: the stations a ticket goes to, how a printer is
 * reached and what it prints like, how a failed job backs off before it gives
 * up, and what the print bridge in the restaurant last said about each
 * printer.
 *
 * Nothing here may import `node:` anything, so it runs unchanged on Workers.
 */

import { bool, parseJson, uuid } from "./core.mjs";

export const PRINT_STATIONS = new Set(["kitchen", "bar", "sushi", "front"]);
export const PRINTER_TRANSPORTS = new Set(["lan", "bluetooth", "usb"]);

/**
 * How each printer prints, set per printer the way the mature POS systems do
 * it (Loyverse, Lightspeed, Odoo, 客如云): one ticket language for the cook
 * who reads it and an optional second one under each dish for whoever helps
 * out, the paper it has (58 mm is 32 characters a line, 80 mm is 48), how
 * many copies, dishes in large type, a beep for a kitchen too loud to notice
 * a ticket, one ticket per dish for a kitchen that splits the work (一菜一单),
 * and another printer to use when this one does not answer.
 */
export const PRINT_LANGUAGES = ["zh", "de", "en"];
/** `auto` is what a thermal printer is set to out of the box: GB18030 in Chinese
 *  mode where Chinese is printed, code page 437 (umlauts, no Chinese) where not. */
export const PRINT_ENCODINGS = ["auto", "gb18030", "cp437", "utf8", "shift_jis"];
export const PAPER_WIDTHS = [58, 80];
export const PRINTER_OPTION_DEFAULTS = Object.freeze({
  printLanguage: "zh", secondLanguage: null, encoding: "auto", paperWidth: 58,
  copies: 1, largeText: false, beep: false, splitItems: false, backupPrinterId: null
});
const MAX_COPIES = 3;

/** The encoding bytes are written in: `auto` settled by the languages printed. */
export function resolvedEncoding(options) {
  if (options.encoding !== "auto") return options.encoding;
  return options.printLanguage === "zh" || options.secondLanguage === "zh" ? "gb18030" : "cp437";
}

/** What a printer's stored options mean, leniently: anything unreadable is its default. */
export function printerOptions(capabilities = {}) {
  const value = capabilities && typeof capabilities === "object" ? capabilities : {};
  const printLanguage = PRINT_LANGUAGES.includes(value.printLanguage) ? value.printLanguage : PRINTER_OPTION_DEFAULTS.printLanguage;
  return {
    printLanguage,
    secondLanguage: PRINT_LANGUAGES.includes(value.secondLanguage) && value.secondLanguage !== printLanguage ? value.secondLanguage : null,
    encoding: PRINT_ENCODINGS.includes(value.encoding) ? value.encoding : PRINTER_OPTION_DEFAULTS.encoding,
    paperWidth: PAPER_WIDTHS.includes(Number(value.paperWidth)) ? Number(value.paperWidth) : PRINTER_OPTION_DEFAULTS.paperWidth,
    copies: Number.isInteger(Number(value.copies)) ? Math.min(MAX_COPIES, Math.max(1, Number(value.copies))) : 1,
    largeText: value.largeText === true,
    beep: value.beep === true,
    splitItems: value.splitItems === true,
    backupPrinterId: typeof value.backupPrinterId === "string" && value.backupPrinterId ? value.backupPrinterId : null
  };
}

/** The options to store: the known ones checked, anything else a device reported kept as it is. */
export function normalizePrinterOptions(input = {}) {
  const value = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const has = (key) => value[key] !== undefined && value[key] !== null && value[key] !== "";
  if (has("printLanguage") && !PRINT_LANGUAGES.includes(value.printLanguage)) throw new Error("Print language is zh, de or en");
  if (has("secondLanguage") && !PRINT_LANGUAGES.includes(value.secondLanguage)) throw new Error("Second print language is zh, de, en or none");
  if (has("encoding") && !PRINT_ENCODINGS.includes(value.encoding)) throw new Error("Unsupported printer encoding");
  if (has("paperWidth") && !PAPER_WIDTHS.includes(Number(value.paperWidth))) throw new Error("Paper is 58 or 80 mm wide");
  if (has("copies") && !(Number.isInteger(Number(value.copies)) && Number(value.copies) >= 1 && Number(value.copies) <= MAX_COPIES)) throw new Error(`Copies are 1 to ${MAX_COPIES}`);
  for (const flag of ["largeText", "beep", "splitItems"]) {
    if (has(flag) && typeof value[flag] !== "boolean") throw new Error(`${flag} is true or false`);
  }
  const options = printerOptions(value);
  const kept = Object.fromEntries(Object.entries(value).filter(([key]) => !(key in PRINTER_OPTION_DEFAULTS)));
  return { ...kept, ...options };
}

export function printerView(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    transport: row.transport,
    address: row.address,
    port: row.port,
    role: row.role,
    enabled: Boolean(row.enabled),
    capabilities: parseJson(row.capabilities_json, {}),
    // What the print bridge last found, when a query joined printer_status.
    ...(row.status_checked_at ? { status: { online: Boolean(row.status_ok), error: row.status_error ?? null, checkedAt: row.status_checked_at, bridgeId: row.status_bridge_id } } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function normalizePrinter(input, current = null) {
  const printer = {
    id: String(input.id || current?.id || uuid()),
    name: String(input.name ?? current?.name ?? "").trim(),
    transport: String(input.transport ?? current?.transport ?? "lan"),
    address: String(input.address ?? current?.address ?? "").trim(),
    port: input.port === null ? null : Number(input.port ?? current?.port ?? 9100),
    role: String(input.role ?? current?.role ?? "front"),
    enabled: bool(input.enabled, current ? Boolean(current.enabled) : true),
    capabilities: JSON.stringify(normalizePrinterOptions(input.capabilities ?? parseJson(current?.capabilities_json, {})))
  };
  if (!printer.name || !printer.address) throw new Error("Printer name and address are required");
  if (!PRINTER_TRANSPORTS.has(printer.transport)) throw new Error("Unsupported printer transport");
  if (!PRINT_STATIONS.has(printer.role)) throw new Error("Unsupported printer role");
  if (printer.port !== null && (!Number.isInteger(printer.port) || printer.port < 1 || printer.port > 65535)) throw new Error("Printer port must be between 1 and 65535");
  if (JSON.parse(printer.capabilities).backupPrinterId === printer.id) throw new Error("A printer cannot be its own backup");
  return printer;
}

export function printJobView(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.order_id,
    printerRole: row.printer_role,
    status: row.status,
    attempts: row.attempts,
    error: row.error,
    claimedBy: row.claimed_by,
    leaseUntil: row.lease_until,
    nextAttemptAt: row.next_attempt_at,
    payload: parseJson(row.payload_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** Backoff for a print job that failed, shared so both backends give up and
 *  retry on the same schedule. */
export function planPrintFailure(attemptsSoFar, maxAttempts = 5) {
  const attempts = Number(attemptsSoFar || 0) + 1;
  const status = attempts >= maxAttempts ? "failed" : "retry-wait";
  const nextAttemptAt = status === "failed" ? null : new Date(Date.now() + Math.min(300_000, 2_000 * 2 ** Math.min(attempts, 7))).toISOString();
  return { status, nextAttemptAt };
}

/**
 * A test page for one printer, queued like any ticket so it goes the way a
 * real one would: through the print bridge, to that printer and no other.
 */
export function planTestPrint(printer, at) {
  return {
    id: uuid(),
    printerRole: printer.role,
    payloadJson: JSON.stringify({ kind: "test", printerId: printer.id, printerName: printer.name, station: printer.role, at })
  };
}

/**
 * What a print bridge says about itself and the printers it reached. Only
 * printers are recorded that exist; an error is kept short.
 */
export function normalizeBridgeReport(input = {}) {
  const id = String(input.bridgeId ?? "").trim().slice(0, 80);
  if (!id) throw new Error("A print bridge names itself (bridgeId)");
  return {
    id,
    name: String(input.name ?? id).trim().slice(0, 80) || id,
    version: String(input.version ?? "").trim().slice(0, 40),
    printers: (Array.isArray(input.printers) ? input.printers : []).slice(0, 50).map((printer) => ({
      id: String(printer?.id ?? ""),
      ok: printer?.ok === true,
      // An error when it cannot print; a note (paper running low) when it can.
      error: printer?.error ? String(printer.error).slice(0, 300) : printer?.ok === true ? null : "No answer"
    })).filter((printer) => printer.id),
    // Only when the bridge searched: what it found on the shop's network.
    discovered: Array.isArray(input.discovered)
      ? input.discovered.slice(0, 50).map((entry) => ({ address: String(entry?.address ?? "").trim().slice(0, 64), port: Number(entry?.port) || 9100, escpos: entry?.escpos === true })).filter((entry) => entry.address)
      : null
  };
}

export function discoveredPrinterView(row) {
  return { address: row.address, port: row.port, escpos: Boolean(row.escpos), bridgeId: row.bridge_id, seenAt: row.seen_at };
}

export function printBridgeView(row) {
  return { id: row.id, name: row.name, version: row.version, lastSeenAt: row.last_seen_at };
}

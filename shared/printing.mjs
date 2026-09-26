/**
 * Printers and print jobs: the stations a ticket goes to, how a printer is
 * reached, and how a failed job backs off before it gives up.
 *
 * Nothing here may import `node:` anything, so it runs unchanged on Workers.
 */

import { bool, parseJson, uuid } from "./core.mjs";

export const PRINT_STATIONS = new Set(["kitchen", "bar", "sushi", "front"]);
export const PRINTER_TRANSPORTS = new Set(["lan", "bluetooth", "usb"]);

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
    capabilities: JSON.stringify(input.capabilities ?? parseJson(current?.capabilities_json, {}))
  };
  if (!printer.name || !printer.address) throw new Error("Printer name and address are required");
  if (!PRINTER_TRANSPORTS.has(printer.transport)) throw new Error("Unsupported printer transport");
  if (!PRINT_STATIONS.has(printer.role)) throw new Error("Unsupported printer role");
  if (printer.port !== null && (!Number.isInteger(printer.port) || printer.port < 1 || printer.port > 65535)) throw new Error("Printer port must be between 1 and 65535");
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

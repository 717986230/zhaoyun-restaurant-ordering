import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { TableOverview } from "@zhaoyun/api-client";
import type { ApiPrintJob, ApiServiceRequest, PosClaim } from "@zhaoyun/contracts";
import { api, useLiveReload } from "./App";
import type { Pos, Screen } from "./App";
import type { PosKey } from "./i18n";

const TAKEAWAY = /^TA-/i;
/** The poll under the live channel: quick while it is down, slow while it is up. */
const REFRESH_MS = 8000;
const REFRESH_LIVE_MS = 30_000;

/**
 * Opens a table on this device: locked to it (shared/pos.mjs) until it is
 * closed or left alone. Held by another device, it says who has it; the
 * manager may take it over.
 */
export async function openTable(pos: Pos, table: string, go: (screen: Screen) => void, claims: PosClaim[] = []) {
  try {
    await api.claim(table);
    go({ name: "order", table: table.toUpperCase() });
  } catch (error) {
    const held = (error as { status?: number })?.status === 409;
    // Locked to the device that has it open: a waiter is told whose it is; the manager may take it over.
    if (!held) return pos.failed(error);
    const holderOf = (list: PosClaim[]) => list.find((claim) => claim.table === table.toUpperCase())?.staffName;
    // A number typed in may be one the floor on screen did not know was taken yet.
    const holder = holderOf(claims) ?? holderOf(await api.floor().then((floor) => floor.claims, () => [])) ?? "?";
    if (pos.staff.role !== "manager" || !window.confirm(pos.t("forceConfirm", { name: holder }))) {
      return pos.notify(pos.t("claimedBy", { table: table.toUpperCase(), name: holder }), "error");
    }
    try {
      await api.release(table, true);
      await api.claim(table);
      go({ name: "order", table: table.toUpperCase() });
    } catch (failure) { pos.failed(failure); }
  }
}

/** Tickets given up on this long ago are the manager's to look into, not the floor's. */
const FAILED_PRINT_WINDOW_MS = 12 * 60 * 60 * 1000;
const STATION_KEYS: Record<string, PosKey> = { kitchen: "stationKitchen", bar: "stationBar", sushi: "stationSushi", front: "stationFront" };

/** Why a ticket did not print, in words, from what the print bridge said. */
function printReason(error: string | null): PosKey {
  const text = error ?? "";
  if (text.includes("paper-out")) return "printWhyPaperOut";
  if (text.includes("cover-open")) return "printWhyCoverOpen";
  if (/offline|error/.test(text) && !/timed out|ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH/.test(text)) return "printWhyOffline";
  if (text.startsWith("No enabled network printer")) return "printWhyNone";
  return "printWhyUnreachable";
}

/**
 * The tickets that did not print, where the waiters look: a kitchen that never
 * got an order is the one failure a restaurant cannot absorb quietly. Each
 * can be sent again once the paper is in.
 */
function FailedPrints({ pos }: { pos: Pos }) {
  const { t } = pos;
  const [jobs, setJobs] = useState<ApiPrintJob[]>([]);
  const load = useCallback(async () => {
    try {
      const since = Date.now() - FAILED_PRINT_WINDOW_MS;
      setJobs((await api.failedPrints()).jobs.filter((job) => Date.parse(job.updatedAt ?? job.createdAt) >= since));
    } catch { /* The floor says what went wrong with the floor; this waits for the next round. */ }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_LIVE_MS);
    return () => window.clearInterval(timer);
  }, [load]);
  useLiveReload(pos, (event) => event.type === "floor.changed", () => void load());

  async function retry(job: ApiPrintJob) {
    try {
      await api.retryPrint(job.id);
      pos.notify(t("printRetried"));
      await load();
    } catch (error) { pos.failed(error); }
  }

  if (!jobs.length) return null;
  const tableOf = (job: ApiPrintJob) => String((job.payload as { table?: string; receipt?: { table?: string } }).table ?? (job.payload as { receipt?: { table?: string } }).receipt?.table ?? "");
  return <section className="pos-print-failed" role="alert">
    <h2>⚠ {t("printFailed", { count: jobs.length })}</h2>
    <ul>{jobs.map((job) => <li key={job.id}>
      <span><b>{t(STATION_KEYS[job.printerRole] ?? "stationFront")}{tableOf(job) ? ` · ${tableOf(job)}` : ""}</b><small>{t(printReason(job.error))}</small></span>
      <button type="button" onClick={() => void retry(job)}>{t("printRetry")}</button>
    </li>)}</ul>
  </section>;
}

const CALL_KEYS: Record<string, PosKey> = { waiter: "callWaiter", pay: "callPay", water: "callWater", utensils: "callUtensils", napkin: "callNapkin", takeaway: "callTakeaway", clear: "callClear" };

/**
 * Guests calling from their table's menu, oldest first, on every waiter's
 * floor at once. Whoever goes deals with it, and it is gone from all of them.
 */
function ServiceCalls({ pos, requests, onDone }: { pos: Pos; requests: ApiServiceRequest[]; onDone: () => void }) {
  const { t } = pos;
  if (!requests.length) return null;
  async function done(request: ApiServiceRequest) {
    try {
      await api.finishServiceRequest(request.id);
      onDone();
    } catch (error) { pos.failed(error); }
  }
  const minutes = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return <section className="pos-calls" role="alert" aria-label={t("calls")}>
    <h2>🔔 {t("calls")}</h2>
    <ul>{requests.map((request) => <li key={request.id} data-call={request.id}>
      <span><b>{t("table", { table: request.table })}</b> · {CALL_KEYS[request.type] ? t(CALL_KEYS[request.type]!) : request.type}<small>{t("minutesAgo", { n: minutes(request.createdAt) })}</small></span>
      <button type="button" onClick={() => void done(request)}>{t("callDone")}</button>
    </li>)}</ul>
  </section>;
}

/** The room: every table and what is open on it, and the takeaways waiting. */
export function Floor({ pos, go }: { pos: Pos; go: (screen: Screen) => void }) {
  const { t, money } = pos;
  const [tables, setTables] = useState<TableOverview[]>([]);
  const [claims, setClaims] = useState<PosClaim[]>([]);
  const [requests, setRequests] = useState<ApiServiceRequest[]>([]);
  // This device: the tables it has open are its own, every other device's are locked to it.
  const [deviceId, setDeviceId] = useState("");

  const load = useCallback(async () => {
    try {
      const floor = await api.floor();
      setTables(floor.tables);
      setClaims(floor.claims);
      setDeviceId(floor.deviceId ?? "");
      setRequests(floor.requests ?? []);
    } catch (error) { pos.failed(error); }
  }, [pos.failed]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), pos.live ? REFRESH_LIVE_MS : REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load, pos.live]);
  useLiveReload(pos, (event) => event.type !== "catalog.changed" && event.type !== "print.queued", () => void load());

  const claimOf = (table: string) => claims.find((claim) => claim.table === table.toUpperCase());
  const calling = new Set(requests.map((request) => request.table.toUpperCase()));
  const room = tables.filter((table) => !TAKEAWAY.test(table.table));
  const takeaways = tables.filter((table) => TAKEAWAY.test(table.table) && table.state !== "free");

  async function newTakeaway() {
    try {
      const { table, pickupNo } = await api.takeaway();
      go({ name: "order", table, pickupNo });
    } catch (error) { pos.failed(error); }
  }

  function openTyped(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const table = String(new FormData(event.currentTarget).get("table") || "").trim().toUpperCase();
    if (table) void openTable(pos, table, go, claims);
  }

  const tile = (table: TableOverview) => {
    const claim = claimOf(table.table);
    const mine = claim && (deviceId ? claim.deviceId === deviceId : claim.staffId === pos.staff.id);
    const busy = claim && !mine;
    return <button key={table.table} type="button" data-table={table.table}
      className={`pos-table ${table.state} ${busy ? "claimed" : ""}`}
      title={busy ? t("claimedBy", { table: table.table, name: claim.staffName ?? "?" }) : undefined}
      onClick={() => void openTable(pos, table.table, go, claims)}>
      <b>{busy && <i className="pos-lock" aria-label={t("lockedHere")}>🔒</i>}{table.table}</b>
      <span>{table.total > 0 ? money(Math.round(table.total * 100)) : t(table.state === "locked" ? "lockedByGuest" : "free")}</span>
      {busy && <small>{t("openOn", { name: claim.staffName ?? "?" })}</small>}
      {calling.has(table.table.toUpperCase()) && <em className="pos-call-badge">🔔 {t("calling")}</em>}
      {table.orderingUntil && <em className="pos-qr-badge">{t("qrBadge")}</em>}
      {table.orders.some((order) => order.channel === "pickup") && <em className="pos-qr-badge">{t("pickupBadge")}</em>}
    </button>;
  };

  return <section className="pos-floor">
    <FailedPrints pos={pos} />
    <ServiceCalls pos={pos} requests={requests} onDone={() => void load()} />
    <div className="pos-floor-bar">
      <form onSubmit={openTyped} className="pos-open-table">
        <input name="table" placeholder={t("openTable")} aria-label={t("openTable")} maxLength={8} autoCapitalize="characters" />
        <button type="submit">{t("open")}</button>
      </form>
      <button type="button" className="pos-primary" onClick={() => void newTakeaway()}>{t("newTakeaway")}</button>
    </div>
    <h2>{t("tables")}</h2>
    <div className="pos-table-grid">{room.map(tile)}</div>
    {takeaways.length > 0 && <>
      <h2>{t("takeaways")}</h2>
      <div className="pos-table-grid">{takeaways.map(tile)}</div>
    </>}
  </section>;
}

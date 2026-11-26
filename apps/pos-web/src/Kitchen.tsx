import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { openLive } from "@zhaoyun/api-client";
import type { ApiCatalogProduct, ApiOrder, PrintStationName, RealtimeEnvelope } from "@zhaoyun/contracts";
import { initialLanguage, translator } from "./i18n";
import type { PosKey, PosLanguage } from "./i18n";

/**
 * The kitchen display (KDS): a board for an old tablet bolted to the pass.
 *
 * Entry: pos.html?view=kitchen — the same POS bundle, no new vite entry, no
 * new route on the server. It asks for one of the three shared role tokens
 * (KITCHEN_TOKEN first; a staff or manager token also works) and then reads
 * the orders the kitchen already gets — GET /api/orders, gated at "kitchen"
 * — and moves them along the same state machine the POS and the console use,
 * new → preparing → ready → completed, PATCH /api/orders/:id/status. The
 * printer is untouched and stays the backup: every ticket still prints, and
 * on a network outage the paper ticket rules.
 *
 * Live: the same /ws channel as the POS (?role=staff), so a new order, a
 * fire (叫起) or a void lands without a reload. While the socket is down the
 * board polls every 15 s and says so, showing the time of the data it has.
 *
 * Sold out: /api/pos/catalog (available / leftToday, shared/stock.mjs) needs
 * at least the staff role, so a kitchen token cannot read it — the board then
 * shows the orders only, and says the sold-out list needs a waiter or owner
 * token. A staff token entered here unlocks it.
 */

export const KDS_OVERDUE_MINUTES = 20;
export const KDS_STATIONS: PrintStationName[] = ["kitchen", "bar", "sushi", "front"];
/** The orders the kitchen still has work in, oldest first. */
export const KDS_OPEN_STATUSES: ApiOrder["status"][] = ["new", "preparing", "ready"];

const TOKEN_KEY = "zy_kitchen_token";

function baseUrl(): string {
  try {
    const stored = localStorage.getItem("zy_api_base");
    if (stored) return stored;
  } catch { /* private mode */ }
  if (typeof location !== "undefined" && location.port === "5173") return "http://127.0.0.1:8787";
  return typeof location !== "undefined" ? location.origin : "";
}

export function nextStatus(status: ApiOrder["status"]): ApiOrder["status"] | null {
  return status === "new" ? "preparing" : status === "preparing" ? "ready" : status === "ready" ? "completed" : null;
}

/** Whole minutes since the order came in. */
export function minutesWaiting(order: ApiOrder, nowMs: number = Date.now()): number {
  return Math.max(0, Math.floor((nowMs - Date.parse(order.createdAt)) / 60_000));
}

/** Red: still waiting to be cooked past the pass's patience. Ready orders
 *  are called, not cooked, so they never go red for waiting. */
export function isOverdue(order: ApiOrder, nowMs: number = Date.now()): boolean {
  return (order.status === "new" || order.status === "preparing") && minutesWaiting(order, nowMs) > KDS_OVERDUE_MINUTES;
}

export function openOrders(orders: ApiOrder[]): ApiOrder[] {
  return orders
    .filter((order) => (KDS_OPEN_STATUSES as string[]).includes(order.status))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export interface StationCard {
  order: ApiOrder;
  items: ApiOrder["items"];
}

/** One card per station an order touches: a sushi roll does not wait behind
 *  the grill's queue. A line with no station cooks at the kitchen. Held
 *  (等叫) lines stay on the card, marked — they are on the bill but the
 *  kitchen must not cook them until 叫起 fires them. */
export function groupByStation(orders: ApiOrder[]): Array<{ station: PrintStationName; cards: StationCard[] }> {
  const byStation = new Map<PrintStationName, StationCard[]>();
  for (const order of openOrders(orders)) {
    const itemsByStation = new Map<PrintStationName, ApiOrder["items"]>();
    for (const item of order.items) {
      const station = item.printStation ?? "kitchen";
      itemsByStation.set(station, [...(itemsByStation.get(station) ?? []), item]);
    }
    for (const [station, items] of itemsByStation) {
      byStation.set(station, [...(byStation.get(station) ?? []), { order, items }]);
    }
  }
  return KDS_STATIONS.filter((station) => byStation.has(station)).map((station) => ({ station, cards: byStation.get(station) ?? [] }));
}

/** Sum active (new/preparing, non-held) quantities per dish for batch cooking. */
export function batchSummary(columns: Array<{ station: PrintStationName; cards: StationCard[] }>): Array<{ name: string; qty: number }> {
  const counts = new Map<string, number>();
  for (const column of columns) {
    for (const { order, items } of column.cards) {
      if (order.status !== "new" && order.status !== "preparing") continue;
      for (const item of items) {
        if (item.held) continue;
        const label = item.name?.trim();
        if (!label) continue;
        counts.set(label, (counts.get(label) ?? 0) + item.qty);
      }
    }
  }
  return [...counts.entries()]
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, "zh-CN"));
}

/** Sold out, in red: switched off (available) or counted down to zero today
 *  (leftToday, shared/stock.mjs). A dish with no limit never lands here. */
export function soldOutProducts(products: ApiCatalogProduct[]): ApiCatalogProduct[] {
  return products.filter((product) => product.available === false || product.leftToday === 0);
}

const STATION_KEY: Record<PrintStationName, "stationKitchen" | "stationBar" | "stationSushi" | "stationFront"> = {
  kitchen: "stationKitchen", bar: "stationBar", sushi: "stationSushi", front: "stationFront"
};

export function Kitchen() {
  const [language] = useState<PosLanguage>(initialLanguage);
  const t = translator(language);
  const [token, setToken] = useState(() => {
    try { return sessionStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; }
  });
  const [authed, setAuthed] = useState(() => {
    try { return Boolean(sessionStorage.getItem(TOKEN_KEY)); } catch { return false; }
  });
  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [soldOut, setSoldOut] = useState<ApiCatalogProduct[] | null>(null);
  const [soldOutBlocked, setSoldOutBlocked] = useState(false);
  const [live, setLive] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [station, setStation] = useState<PrintStationName | "all">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const load = useCallback(async () => {
    const current = tokenRef.current;
    if (!current) return;
    const headers = { "x-admin-token": current };
    const ordersResponse = await fetch(`${baseUrl()}/api/orders?limit=100`, { headers });
    if (ordersResponse.status === 401) {
      setAuthed(false);
      setError("kitchenWrongToken");
      try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* not kept */ }
      return;
    }
    if (!ordersResponse.ok) throw new Error(`Request failed (${ordersResponse.status})`);
    const { orders: fresh } = (await ordersResponse.json()) as { orders: ApiOrder[] };
    setOrders(fresh);
    setUpdatedAt(new Date().toISOString());
    // Sold out needs the staff role; a kitchen token gets a 403 here and the
    // board carries on with the orders alone (see the header comment).
    const catalogResponse = await fetch(`${baseUrl()}/api/pos/catalog`, { headers });
    if (catalogResponse.status === 403) { setSoldOut(null); setSoldOutBlocked(true); return; }
    if (!catalogResponse.ok) throw new Error(`Request failed (${catalogResponse.status})`);
    const { products } = (await catalogResponse.json()) as { products: ApiCatalogProduct[] };
    setSoldOut(soldOutProducts(products));
    setSoldOutBlocked(false);
  }, []);

  const enter = useCallback(async (entered: string) => {
    const trimmed = entered.trim();
    if (!trimmed) return;
    tokenRef.current = trimmed;
    setToken(trimmed);
    setError("");
    try {
      const response = await fetch(`${baseUrl()}/api/orders?limit=1`, { headers: { "x-admin-token": trimmed } });
      if (response.status === 401 || response.status === 403) { setError("kitchenWrongToken"); return; }
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      try { sessionStorage.setItem(TOKEN_KEY, trimmed); } catch { /* not kept */ }
      setAuthed(true);
    } catch {
      setError("kitchenWrongToken");
    }
  }, []);

  // One live channel while signed in, plus a clock for the waiting minutes.
  useEffect(() => {
    if (!authed) return undefined;
    void load().catch(() => setError("liveOff"));
    const stop = openLive(baseUrl(), { role: "staff" }, (event: RealtimeEnvelope) => {
      if (event.type === "floor.changed" || event.type === "catalog.changed" || event.type === "connected") void load().catch(() => undefined);
    }, setLive);
    const clock = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => { stop(); window.clearInterval(clock); setLive(false); };
  }, [authed, load]);

  // While the socket is down, poll: the board must not freeze on a tablet
  // whose Wi-Fi dropped, it must say so and keep refreshing.
  useEffect(() => {
    if (!authed || live) return undefined;
    const timer = window.setInterval(() => { void load().catch(() => undefined); }, 15_000);
    return () => window.clearInterval(timer);
  }, [authed, live, load]);

  async function advance(order: ApiOrder) {
    const next = nextStatus(order.status);
    if (!next || busy) return;
    setBusy(order.id);
    try {
      const response = await fetch(`${baseUrl()}/api/orders/${encodeURIComponent(order.id)}/status`, {
        method: "PATCH",
        headers: { "x-admin-token": tokenRef.current, "content-type": "application/json" },
        body: JSON.stringify({ status: next })
      });
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      await load();
    } catch {
      setError("liveOff");
    } finally {
      setBusy(null);
    }
  }

  if (!authed) {
    return <div className="pos-shell">
      <main className="pos-main">
        <form className="pos-card pos-signin" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void enter(new FormData(event.currentTarget).get("token") as string); }}>
          <h1>{t("kitchenTitle")}</h1>
          <p>{t("kitchenTokenHint")}</p>
          <label><span>{t("kitchenToken")}</span><input name="token" type="password" autoComplete="current-password" autoCapitalize="none" spellCheck={false} /></label>
          {error && <p className="pos-error" role="alert">{t(error as PosKey)}</p>}
          <button className="pos-primary" type="submit">{t("kitchenEnter")}</button>
          <p className="pos-muted">{t("kitchenPrinterNote")}</p>
        </form>
      </main>
    </div>;
  }

  const columns = groupByStation(orders);
  const shown = station === "all" ? columns : columns.filter((column) => column.station === station);
  const batch = batchSummary(shown);
  const open = openOrders(orders);
  const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("de-AT", { timeZone: "Europe/Vienna", hour: "2-digit", minute: "2-digit" }) : "—");

  return <div className="pos-shell">
    <header className="pos-head">
      <strong>{t("kitchenTitle")}</strong>
      <i className={`pos-live ${live ? "on" : ""}`} role="img" aria-label={t(live ? "liveOn" : "liveOff")} title={t(live ? "liveOn" : "liveOff")} />
      <span className="pos-head-actions">
        <span>{t("kitchenUpdated", { time: time(updatedAt) })}</span>
        <button type="button" onClick={() => { location.search = ""; }}>POS</button>
        <button type="button" onClick={() => { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* not kept */ } setToken(""); setAuthed(false); }}>{t("signOut")}</button>
      </span>
    </header>
    <main className="pos-main">
      {!live && <p className="pos-error" role="status">{t("kitchenOffline", { time: time(updatedAt) })}</p>}
      {soldOutBlocked && <p className="pos-muted">{t("kitchenSoldOutNote")}</p>}
      {soldOut && soldOut.length > 0 && <p className="pos-error" role="status">
        {t("kitchenSoldOut")}: {soldOut.map((product) => product.names?.zh || product.names?.de || product.sku).join(" · ")}
      </p>}
      <div role="group" aria-label={t("kitchenAll")} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {(["all", ...KDS_STATIONS] as const).map((choice) => <button
          key={choice} type="button" className={station === choice ? "pos-primary" : ""} aria-pressed={station === choice}
          onClick={() => setStation(choice)}
        >{choice === "all" ? t("kitchenAll") : t(STATION_KEY[choice])}</button>)}
        <button type="button" onClick={() => void load().catch(() => setError("liveOff"))}>⟳</button>
      </div>
      {batch.length > 0 && <div data-testid="kds-batch-summary" aria-label={t("kitchenBatch")}
        style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 12, padding: "8px 10px", border: "1px solid #888", borderRadius: 8 }}>
        <strong style={{ marginRight: 4 }}>{t("kitchenBatch")}:</strong>
        {batch.map((entry) => <span key={entry.name} style={{ border: "1px solid #ccc", borderRadius: 6, padding: "2px 8px", fontSize: 15 }}>
          {entry.name} ×{entry.qty}
        </span>)}
      </div>}
      {open.length === 0
        ? <p className="pos-muted">{t("kitchenNoOrders")}</p>
        : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {shown.map((column) => <section key={column.station} aria-label={t(STATION_KEY[column.station])}>
            <h2 style={{ margin: "0 0 8px" }}>{t(STATION_KEY[column.station])}</h2>
            {column.cards.map(({ order, items }) => {
              const waiting = minutesWaiting(order, nowMs);
              const overdue = isOverdue(order, nowMs);
              const next = nextStatus(order.status);
              const allHeld = items.every((item) => item.held);
              return <article key={`${column.station}-${order.id}`} data-testid={`kds-card-${order.id}`}
                style={{ border: `3px solid ${overdue ? "#c00" : "#888"}`, borderRadius: 8, padding: 12, marginBottom: 12, background: overdue ? "#fff0f0" : "#fff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <b style={{ fontSize: 28 }}>{order.pickupNo ? `#${order.pickupNo}` : `桌 ${order.table}`}</b>
                  <span style={{ color: overdue ? "#c00" : "inherit", fontWeight: overdue ? 700 : 400 }}>
                    {waiting}′{overdue ? ` · ${t("kitchenOverdue", { min: waiting - KDS_OVERDUE_MINUTES })}` : ""}
                  </span>
                </div>
                <div className="pos-muted">{order.no}{order.staffName ? ` · ${order.staffName}` : ""} · {order.status}</div>
                {allHeld && <p><b>{t("kitchenHeld")}</b></p>}
                <ul style={{ listStyle: "none", padding: 0, margin: "8px 0", fontSize: 20 }}>
                  {items.map((item) => <li key={item.id} style={{ opacity: item.held ? 0.55 : 1 }}>
                    {item.qty} × {item.name ?? item.id}
                    {item.held && <> <b>· {t("kitchenHeld")}</b></>}
                    {item.modifiers?.length ? <small> ({item.modifiers.map((m) => m.name).join(" · ")})</small> : null}
                  </li>)}
                </ul>
                {order.note && <p><b>备注：</b>{order.note}</p>}
                {next && <button type="button" className="pos-primary" disabled={busy === order.id} style={{ width: "100%", fontSize: 18, padding: "10px 0" }}
                  onClick={() => void advance(order)}>
                  {t(next === "preparing" ? "kitchenStart" : next === "ready" ? "kitchenReady" : "kitchenDone")}
                </button>}
              </article>;
            })}
          </section>)}
        </div>}
      <p className="pos-muted">{t("kitchenPrinterNote")}</p>
    </main>
  </div>;
}

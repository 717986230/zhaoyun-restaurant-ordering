import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { PosApi, toProduct } from "@zhaoyun/api-client";
import type { CreateOrderCommand, PosStaff, RealtimeEnvelope } from "@zhaoyun/contracts";
import type { Product } from "@zhaoyun/domain";
import { serverErrorText } from "@zhaoyun/domain";
import { formatEuro, initialLanguage, POS_LANGUAGES, translator } from "./i18n";
import type { PosKey, PosLanguage } from "./i18n";
import { enqueue, flushOutbox, readOutbox } from "./offline-queue";
import { Floor } from "./Floor";
import { OrderScreen } from "./OrderScreen";
import { PayScreen } from "./PayScreen";
import { Records } from "./Records";
import { TopUp } from "./TopUp";

export const api = new PosApi();

/** What every screen gets: the language, the signed-in waiter, the menu and a way to say something. */
export interface Pos {
  t: ReturnType<typeof translator>;
  language: PosLanguage;
  money: (cents: number) => string;
  staff: PosStaff;
  products: Product[];
  notify: (message: string, kind?: "ok" | "error") => void;
  failed: (error: unknown) => void;
  /** Whether the live channel is open: screens poll slowly while it is. */
  live: boolean;
  /** Hears every change on the floor as it happens; returns the way to stop. */
  onLive: (listener: (event: RealtimeEnvelope) => void) => () => void;
  /** Loads the menu again (a dish sold out here, say). */
  refreshMenu: () => void;
  /** 断网补发: an order that could not reach the server, kept on this device to send again once it is back online. */
  queueOffline: (command: CreateOrderCommand, count: number) => void;
}

type LiveListener = (event: RealtimeEnvelope) => void;

/**
 * Calls `reload` once shortly after the events `wanted` picks out — several
 * writes in a row (an order and its tickets) make one reload, not several.
 */
export function useLiveReload(pos: Pos, wanted: (event: RealtimeEnvelope) => boolean, reload: () => void) {
  const latest = useRef({ wanted, reload });
  latest.current = { wanted, reload };
  useEffect(() => {
    let pending: number | undefined;
    const stop = pos.onLive((event) => {
      if (!latest.current.wanted(event)) return;
      window.clearTimeout(pending);
      pending = window.setTimeout(() => latest.current.reload(), 250);
    });
    return () => { window.clearTimeout(pending); stop(); };
  }, [pos.onLive]);
}

export type Screen =
  | { name: "floor" }
  | { name: "order"; table: string; pickupNo?: number }
  | { name: "pay"; table: string }
  | { name: "topup" }
  | { name: "records" };

const LANGUAGE_NAMES: Record<PosLanguage, string> = { zh: "中文", de: "Deutsch", en: "English" };

/**
 * The standalone screens (no table) are kept in the URL hash, so a deep link
 * opens straight to one. A cashier can save pos.html#topup to the home screen
 * and, once signed in, land on 会员充值 every time. Table screens aren't
 * deep-linked — they need a table picked on the floor.
 */
function screenFromHash(): Screen | null {
  const key = (typeof location === "undefined" ? "" : location.hash.replace(/^#/, ""));
  return key === "topup" || key === "records" || key === "floor" ? { name: key } : null;
}

/**
 * The POS: what the waiters and the counter work with.
 *
 * A device first has to be paired by the manager; then a waiter picks their
 * name and types their PIN; then it is the floor — the tables, each opened
 * on one device at a time, ordered on, sent to the kitchen and paid, together
 * or separately — and each waiter's settlement at the end of the shift.
 */
export function App() {
  const [language, setLanguage] = useState<PosLanguage>(initialLanguage);
  const [paired, setPaired] = useState(Boolean(api.deviceToken));
  const [staff, setStaff] = useState<PosStaff | null>(api.session?.staff ?? null);
  const [products, setProducts] = useState<Product[]>([]);
  const [screen, setScreen] = useState<Screen>(() => screenFromHash() ?? { name: "floor" });
  const [toast, setToast] = useState<{ message: string; kind: "ok" | "error" } | null>(null);
  const [live, setLive] = useState(false);
  const listeners = useRef(new Set<LiveListener>());
  const t = translator(language);
  const unpair = useCallback(() => { api.unpair(); setPaired(false); }, []);
  const onLive = useCallback((listener: LiveListener) => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  }, []);

  // One timer for the toast: a new message restarts it, so an earlier toast's
  // timer never wipes a newer message before it can be read.
  const toastTimer = useRef<number | undefined>(undefined);
  const notify = useCallback((message: string, kind: "ok" | "error" = "ok") => {
    setToast({ message, kind });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);
  const failed = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    // A session that ran out, or a waiter switched off: back to the names.
    if (/401|authentication required/i.test(message) || (error as { status?: number })?.status === 401) setStaff(null);
    notify(message ? serverErrorText(message, language) : translator(language)("failed"), "error");
  }, [notify, language]);

  // 断网补发: orders that could not reach the server wait in this device's
  // outbox and go out on their own once it is back online.
  const [pending, setPending] = useState(() => readOutbox(localStorage).length);
  const queueOffline = useCallback((command: CreateOrderCommand, count: number) => {
    setPending(enqueue(localStorage, { ...command, count, queuedAt: Date.now() }).length);
  }, []);
  const flush = useCallback(async () => {
    const translate = translator(language);
    await flushOutbox(localStorage, (command) => api.order(command), (outcome) => {
      if (outcome.kind === "sent") notify(translate("queueResent", { table: outcome.order.table, count: outcome.order.count }));
      else if (outcome.kind === "dropped") notify(translate("queueDropped", { table: outcome.order.table, count: outcome.order.count, reason: outcome.reason }), "error");
    });
    setPending(readOutbox(localStorage).length);
  }, [notify, language]);

  // Try the outbox on sign-in, the moment the device comes back online, when
  // the live channel reconnects, and every 20 s while anything still waits.
  useEffect(() => {
    if (!staff) return undefined;
    void flush();
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(() => { if (readOutbox(localStorage).length) void flush(); }, 20_000);
    return () => { window.removeEventListener("online", onOnline); window.clearInterval(timer); };
  }, [staff, flush]);
  useEffect(() => { if (staff && live) void flush(); }, [staff, live, flush]);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : language;
    try { localStorage.setItem("zy_pos_language", language); } catch { /* not kept */ }
  }, [language]);

  // Keep the hash in step with the standalone screens, so #topup is a saveable
  // deep link; table screens (order/pay) carry no table in the URL, so clear it.
  useEffect(() => {
    try { location.hash = screen.name === "topup" || screen.name === "records" ? screen.name : ""; } catch { /* no history here */ }
  }, [screen.name]);
  // A deep link or back/forward changing the hash navigates to that screen.
  useEffect(() => {
    const onHash = () => { const next = screenFromHash(); if (next) setScreen((current) => (current.name === next.name ? current : next)); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const loadCatalog = useCallback(() => {
    api.catalog().then(({ products: list }) => setProducts(list.map(toProduct))).catch(failed);
  }, [failed]);
  useEffect(() => {
    if (staff) loadCatalog();
  }, [staff, loadCatalog]);

  // One live channel for the device while a waiter is signed in: the menu
  // reloads when a dish changes (sold out, say), and each screen hears the floor.
  useEffect(() => {
    if (!staff) return undefined;
    const stop = api.live((event) => {
      if (event.type === "catalog.changed" || event.type === "connected") loadCatalog();
      for (const listener of listeners.current) listener(event);
    }, setLive);
    return () => { stop(); setLive(false); };
  }, [staff, loadCatalog]);

  const languages = <div className="pos-languages" role="group" aria-label="Language">{POS_LANGUAGES.map((option) => <button
    key={option} type="button" className={option === language ? "on" : ""} aria-pressed={option === language} onClick={() => setLanguage(option)}
  >{LANGUAGE_NAMES[option]}</button>)}</div>;

  let body;
  if (!paired) body = <Pair t={t} onPaired={() => setPaired(true)} />;
  else if (!staff) body = <SignIn t={t} onSignedIn={setStaff} onUnpair={unpair} failed={failed} />;
  else {
    const pos: Pos = { t, language, money: (cents) => formatEuro(cents, language), staff, products, notify, failed, live, onLive, refreshMenu: loadCatalog, queueOffline };
    body = screen.name === "order" ? <OrderScreen pos={pos} table={screen.table} pickupNo={screen.pickupNo} go={setScreen} />
      : screen.name === "pay" ? <PayScreen pos={pos} table={screen.table} go={setScreen} />
      : screen.name === "topup" ? <TopUp pos={pos} go={setScreen} />
      : screen.name === "records" ? <Records pos={pos} go={setScreen} />
      : <Floor pos={pos} go={setScreen} />;
  }

  return <div className="pos-shell">
    <header className="pos-head">
      <strong>POS</strong>
      {staff && <span className="pos-who">{staff.name}{staff.role === "manager" ? " ★" : ""}</span>}
      {staff && <i className={`pos-live ${live ? "on" : ""}`} role="img" aria-label={t(live ? "liveOn" : "liveOff")} title={t(live ? "liveOn" : "liveOff")} />}
      <span className="pos-head-actions">
        {staff && pending > 0 && <span className="pos-queue" role="status" title={t(pending === 1 ? "queuePendingOne" : "queuePendingMany", { count: pending })}>⟳ {pending}</span>}
        {staff && screen.name === "floor" && <button type="button" onClick={() => setScreen({ name: "records" })}>{t("records")}</button>}
        {languages}
        {staff && <button type="button" onClick={() => { void api.signOut().finally(() => { setStaff(null); setScreen({ name: "floor" }); }); }}>{t("signOut")}</button>}
      </span>
    </header>
    <main className="pos-main">{body}</main>
    <div className={`pos-toast ${toast ? `show ${toast.kind}` : ""}`} role="status">{toast?.message ?? ""}</div>
  </div>;
}

/** Pairing, once per device, with the restaurant's account. */
function Pair({ t, onPaired }: { t: (key: PosKey) => string; onPaired: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api.pair(String(data.get("base") || "").trim(), String(data.get("login") || "").trim().toLowerCase(), String(data.get("password") || ""), String(data.get("name") || "").trim());
      onPaired();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("pairFailed"));
    } finally {
      setBusy(false);
    }
  }
  return <form className="pos-card pos-pair" onSubmit={submit}>
    <h1>{t("pairTitle")}</h1>
    <p>{t("pairLead")}</p>
    <label><span>{t("deviceName")}</span><input name="name" required maxLength={32} /></label>
    <label><span>{t("accountLogin")}</span><input name="login" required autoComplete="username" autoCapitalize="none" spellCheck={false} /></label>
    <label><span>{t("managerPassword")}</span><input name="password" type="password" required autoComplete="current-password" /></label>
    <label><span>{t("apiBase")}</span><input name="base" inputMode="url" placeholder="https://…" /></label>
    {error && <p className="pos-error" role="alert">{error}</p>}
    <button className="pos-primary" type="submit" disabled={busy}>{t("pair")}</button>
  </form>;
}

/** A waiter's name, then their PIN on a keypad big enough for a thumb. */
function SignIn({ t, onSignedIn, onUnpair, failed }: { t: ReturnType<typeof translator>; onSignedIn: (staff: PosStaff) => void; onUnpair: () => void; failed: (error: unknown) => void }) {
  const [staff, setStaff] = useState<PosStaff[] | null>(null);
  const [chosen, setChosen] = useState<PosStaff | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.staff().then(({ staff: list }) => setStaff(list)).catch((failure) => {
      // The manager unpaired this device: back to pairing.
      if ((failure as { status?: number })?.status === 401) onUnpair();
      else { failed(failure); setStaff([]); }
    });
  }, [failed, onUnpair]);

  async function enter(code: string) {
    if (!chosen) return;
    try {
      onSignedIn(await api.signIn(chosen.id, code));
    } catch {
      setError(t("wrongPin"));
      setPin("");
    }
  }
  const press = (digit: string) => {
    setError("");
    const next = `${pin}${digit}`.slice(0, 6);
    setPin(next);
  };

  if (!chosen) {
    return <section className="pos-card pos-signin">
      <h1>{t("whoAreYou")}</h1>
      {staff && !staff.length && <p>{t("noStaff")}</p>}
      <div className="pos-names">{(staff ?? []).map((person) => <button key={person.id} type="button" onClick={() => { setChosen(person); setPin(""); setError(""); }}>{person.name}</button>)}</div>
      <button type="button" className="pos-link" onClick={() => { if (window.confirm(t("unpairConfirm"))) onUnpair(); }}>{t("unpair")}</button>
    </section>;
  }
  return <section className="pos-card pos-signin">
    <h1>{t("enterPin", { name: chosen.name })}</h1>
    <div className="pos-pin" aria-label="PIN">{Array.from({ length: Math.max(4, pin.length) }, (_, index) => <i key={index} className={index < pin.length ? "on" : ""} />)}</div>
    {error && <p className="pos-error" role="alert">{error}</p>}
    <div className="pos-keypad">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => <button key={digit} type="button" onClick={() => press(digit)}>{digit}</button>)}
      <button type="button" onClick={() => setChosen(null)}>{t("back")}</button>
      <button type="button" onClick={() => press("0")}>0</button>
      <button type="button" className="pos-primary" disabled={pin.length < 4} onClick={() => void enter(pin)}>OK</button>
    </div>
  </section>;
}

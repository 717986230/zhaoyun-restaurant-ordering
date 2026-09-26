import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { PosApi, toProduct } from "@zhaoyun/api-client";
import type { PosStaff } from "@zhaoyun/contracts";
import type { Product } from "@zhaoyun/domain";
import { formatEuro, initialLanguage, POS_LANGUAGES, translator } from "./i18n";
import type { PosKey, PosLanguage } from "./i18n";
import { Floor } from "./Floor";
import { OrderScreen } from "./OrderScreen";
import { PayScreen } from "./PayScreen";
import { Records } from "./Records";

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
}

export type Screen =
  | { name: "floor" }
  | { name: "order"; table: string; pickupNo?: number }
  | { name: "pay"; table: string }
  | { name: "records" };

const LANGUAGE_NAMES: Record<PosLanguage, string> = { zh: "中文", de: "Deutsch", en: "English" };

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
  const [screen, setScreen] = useState<Screen>({ name: "floor" });
  const [toast, setToast] = useState<{ message: string; kind: "ok" | "error" } | null>(null);
  const t = translator(language);
  const unpair = useCallback(() => { api.unpair(); setPaired(false); }, []);

  const notify = useCallback((message: string, kind: "ok" | "error" = "ok") => {
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 2600);
  }, []);
  const failed = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    // A session that ran out, or a waiter switched off: back to the names.
    if (/401|authentication required/i.test(message) || (error as { status?: number })?.status === 401) setStaff(null);
    notify(message || translator(language)("failed"), "error");
  }, [notify, language]);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : language;
    try { localStorage.setItem("zy_pos_language", language); } catch { /* not kept */ }
  }, [language]);

  useEffect(() => {
    if (!staff) return;
    api.catalog().then(({ products: list }) => setProducts(list.map(toProduct))).catch(failed);
  }, [staff, failed]);

  const languages = <div className="pos-languages" role="group" aria-label="Language">{POS_LANGUAGES.map((option) => <button
    key={option} type="button" className={option === language ? "on" : ""} aria-pressed={option === language} onClick={() => setLanguage(option)}
  >{LANGUAGE_NAMES[option]}</button>)}</div>;

  let body;
  if (!paired) body = <Pair t={t} onPaired={() => setPaired(true)} />;
  else if (!staff) body = <SignIn t={t} onSignedIn={setStaff} onUnpair={unpair} failed={failed} />;
  else {
    const pos: Pos = { t, language, money: (cents) => formatEuro(cents, language), staff, products, notify, failed };
    body = screen.name === "order" ? <OrderScreen pos={pos} table={screen.table} pickupNo={screen.pickupNo} go={setScreen} />
      : screen.name === "pay" ? <PayScreen pos={pos} table={screen.table} go={setScreen} />
      : screen.name === "records" ? <Records pos={pos} go={setScreen} />
      : <Floor pos={pos} go={setScreen} />;
  }

  return <div className="pos-shell">
    <header className="pos-head">
      <strong>POS</strong>
      {staff && <span className="pos-who">{staff.name}{staff.role === "manager" ? " ★" : ""}</span>}
      <span className="pos-head-actions">
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

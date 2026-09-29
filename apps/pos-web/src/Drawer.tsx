import { useCallback, useEffect, useState } from "react";
import type { PosDrawer } from "@zhaoyun/contracts";
import { api } from "./App";
import type { Pos } from "./App";

/** Euro notes and coins, in cents, largest first (shared/drawer.mjs). */
const DENOMINATIONS = [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
const toCents = (text: string) => Math.round(Number(String(text).replace(",", ".")) * 100) || 0;
const label = (cents: number) => (cents >= 100 ? `${cents / 100} €` : `${cents} ct`);

/**
 * The cash drawer (钱箱): opened with the float, money put in or taken out
 * with why, and counted at the end of the shift — note by note, coin by
 * coin — against what should be there. The manager sees the last counts.
 */
export function DrawerCard({ pos }: { pos: Pos }) {
  const { t, money } = pos;
  const manager = pos.staff.role === "manager";
  const [drawer, setDrawer] = useState<PosDrawer | null>(null);
  const [history, setHistory] = useState<PosDrawer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [float, setFloat] = useState("150");
  const [move, setMove] = useState<{ kind: "in" | "out"; amount: string; reason: string }>({ kind: "out", amount: "", reason: "" });
  const [counting, setCounting] = useState(false);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [total, setTotal] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDrawer((await api.drawer()).drawer);
      if (manager) setHistory((await api.drawers(5)).drawers);
    } catch (error) { pos.failed(error); }
    setLoaded(true);
  }, [manager, pos.failed]);
  useEffect(() => { void load(); }, [load]);

  const act = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      pos.notify(done);
      await load();
    } catch (error) { pos.failed(error); } finally { setBusy(false); }
  };

  const countedCents = DENOMINATIONS.reduce((sum, cents) => sum + cents * (Math.max(0, Math.floor(Number(counts[cents]) || 0))), 0);
  const byNotes = countedCents > 0;
  const counted = byNotes ? countedCents : toCents(total);
  const expected = drawer?.totals.expectedCents ?? 0;
  const difference = counted - expected;

  if (!loaded) return <article className="pos-card pos-drawer"><h2>{t("drawer")}</h2></article>;

  if (!drawer) {
    return <article className="pos-card pos-drawer">
      <h2>{t("drawer")}</h2>
      <p className="pos-muted">{t("drawerClosed")}</p>
      <label><span>{t("drawerFloat")}</span><input inputMode="decimal" value={float} onChange={(event) => setFloat(event.target.value)} /></label>
      <button type="button" className="pos-primary" data-action="open-drawer" disabled={busy} onClick={() => void act(() => api.openDrawer(toCents(float) / 100), t("drawerOpened"))}>{t("drawerOpen")}</button>
      {manager && history.length > 0 && <History pos={pos} drawers={history} />}
    </article>;
  }

  const totals = drawer.totals;
  return <article className="pos-card pos-drawer" data-drawer="open">
    <h2>{t("drawer")}</h2>
    <p className="pos-muted">{t("drawerOpenSince", { time: new Date(drawer.openedAt).toLocaleTimeString(pos.language === "zh" ? "zh-CN" : pos.language, { hour: "2-digit", minute: "2-digit" }), name: drawer.openedBy ?? "" })}</p>
    <dl className="pos-figures">
      <dt>{t("drawerFloat")}</dt><dd>{money(totals.floatCents)}</dd>
      <dt>+ {t("drawerCashSales")}</dt><dd>{money(totals.cashSalesCents)}</dd>
      {totals.inCents ? <><dt>+ {t("drawerIn")}</dt><dd>{money(totals.inCents)}</dd></> : null}
      {totals.outCents ? <><dt>− {t("drawerOut")}</dt><dd>{money(-totals.outCents)}</dd></> : null}
      {totals.cardTipsCents ? <><dt>− {t("drawerCardTips")}</dt><dd>{money(-totals.cardTipsCents)}</dd></> : null}
      <dt><b>{t("drawerExpected")}</b></dt><dd><b data-figure="expected">{money(totals.expectedCents)}</b></dd>
    </dl>
    {totals.cashTipsCents ? <p className="pos-muted">{t("drawerCashTips", { amount: money(totals.cashTipsCents) })}</p> : null}

    {drawer.movements.length > 0 && <ul className="pos-movements">{drawer.movements.map((movement) => <li key={movement.id} className={movement.kind}>
      <span>{movement.reason}{movement.staffName ? <small> · {movement.staffName}</small> : null}</span>
      <b>{money(movement.kind === "in" ? movement.amountCents : -movement.amountCents)}</b>
    </li>)}</ul>}

    <form className="pos-move" onSubmit={(event) => {
      event.preventDefault();
      void act(async () => {
        await api.moveCash(move.kind, toCents(move.amount) / 100, move.reason);
        setMove({ kind: move.kind, amount: "", reason: "" });
      }, t(move.kind === "in" ? "drawerPutIn" : "drawerTookOut"));
    }}>
      <div className="pos-mode" role="group">
        <button type="button" className={move.kind === "out" ? "on" : ""} aria-pressed={move.kind === "out"} onClick={() => setMove({ ...move, kind: "out" })}>{t("drawerOut")}</button>
        <button type="button" className={move.kind === "in" ? "on" : ""} aria-pressed={move.kind === "in"} onClick={() => setMove({ ...move, kind: "in" })}>{t("drawerIn")}</button>
      </div>
      <label><span>{t("amount")}</span><input inputMode="decimal" required value={move.amount} onChange={(event) => setMove({ ...move, amount: event.target.value })} /></label>
      <label><span>{t("drawerReason")}</span><input required maxLength={120} placeholder={t(move.kind === "in" ? "drawerReasonIn" : "drawerReasonOut")} value={move.reason} onChange={(event) => setMove({ ...move, reason: event.target.value })} /></label>
      <button type="submit" disabled={busy || !toCents(move.amount) || !move.reason.trim()}>{t("drawerRecord")}</button>
    </form>

    {!counting ? <button type="button" className="pos-primary" data-action="count-drawer" onClick={() => setCounting(true)}>{t("drawerCount")}</button> : <div className="pos-count">
      <p className="pos-muted">{t("drawerCountLead")}</p>
      <div className="pos-denominations">{DENOMINATIONS.map((cents) => <label key={cents}>
        <span>{label(cents)}</span>
        <input inputMode="numeric" aria-label={label(cents)} data-denomination={cents} value={counts[cents] ?? ""} onChange={(event) => setCounts({ ...counts, [cents]: event.target.value.replace(/\D/g, "") })} />
      </label>)}</div>
      {!byNotes && <label><span>{t("drawerOrTotal")}</span><input inputMode="decimal" value={total} onChange={(event) => setTotal(event.target.value)} /></label>}
      <dl className="pos-figures">
        <dt>{t("drawerExpected")}</dt><dd>{money(expected)}</dd>
        <dt>{t("drawerCounted")}</dt><dd data-figure="counted">{money(counted)}</dd>
        <dt><b>{t("drawerDifference")}</b></dt><dd><b className={difference === 0 ? "pos-even" : difference > 0 ? "pos-over" : "pos-short"} data-figure="difference">{difference > 0 ? "+" : ""}{money(difference)}</b></dd>
      </dl>
      <label><span>{t("drawerNote")}</span><input maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <div className="pos-modal-actions">
        <button type="button" onClick={() => setCounting(false)}>{t("cancel")}</button>
        <button type="button" className="pos-primary" data-action="close-drawer" disabled={busy || (!byNotes && total.trim() === "")} onClick={() => {
          if (difference !== 0 && !window.confirm(t("drawerConfirmDifference", { amount: `${difference > 0 ? "+" : ""}${money(difference)}` }))) return;
          void act(async () => {
            await api.closeDrawer({
              ...(byNotes ? { counts: Object.fromEntries(DENOMINATIONS.flatMap((cents) => (Number(counts[cents]) > 0 ? [[String(cents), Math.floor(Number(counts[cents]))]] : []))) } : { amount: counted / 100 }),
              ...(note.trim() ? { note: note.trim() } : {})
            });
            setCounting(false);
            setCounts({});
            setTotal("");
            setNote("");
          }, t("drawerClosedDone"));
        }}>{t("drawerCloseShift")}</button>
      </div>
    </div>}
  </article>;
}

/** The last counts, for the manager: when, who, and how far off. */
function History({ pos, drawers }: { pos: Pos; drawers: PosDrawer[] }) {
  const { t, money } = pos;
  return <>
    <h3>{t("drawerHistory")}</h3>
    <ul className="pos-movements">{drawers.map((drawer) => {
      const difference = drawer.totals.differenceCents ?? 0;
      return <li key={drawer.id}>
        <span>{drawer.closedAt ? new Date(drawer.closedAt).toLocaleString(pos.language === "zh" ? "zh-CN" : pos.language, { dateStyle: "short", timeStyle: "short" }) : ""}{drawer.closedBy ? <small> · {drawer.closedBy}</small> : null}{drawer.note ? <small> · {drawer.note}</small> : null}</span>
        <b className={difference === 0 ? "pos-even" : difference > 0 ? "pos-over" : "pos-short"}>{difference > 0 ? "+" : ""}{money(difference)}</b>
      </li>;
    })}</ul>
  </>;
}

import { Fragment, useCallback, useEffect, useState } from "react";
import type { ApiClosingTotals, ApiJournalExport, ApiReceipt, PaymentType, PosSettlement, PosStaff } from "@zhaoyun/contracts";
import { api } from "./App";
import type { Pos, Screen } from "./App";

const PAYMENTS: PaymentType[] = ["cash", "card", "voucher"];

/** A local date (YYYY-MM-DD), today or some days on. */
function day(offset = 0) {
  const date = new Date(Date.now() + offset * 86_400_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function download(name: string, type: string, text: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function journalCsv(exported: ApiJournalExport) {
  const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return ["seq,at,kind,ref,prev_hash,hash,payload", ...exported.entries.map((entry) => [entry.seq, entry.at, entry.kind, entry.ref, entry.prevHash, entry.hash, JSON.stringify(entry.payload)].map(cell).join(","))].join("\r\n");
}

/**
 * The records of the shift: the receipts (the manager may cancel one by a
 * storno), each waiter's settlement — their own for a waiter, anyone's for
 * the manager — the day's closing, and the journal the tax office asks for.
 */
export function Records({ pos, go }: { pos: Pos; go: (screen: Screen) => void }) {
  const { t, money } = pos;
  const manager = pos.staff.role === "manager";
  const [receipts, setReceipts] = useState<ApiReceipt[]>([]);
  const [staff, setStaff] = useState<PosStaff[]>([pos.staff]);
  const [whose, setWhose] = useState(pos.staff.id);
  const [mine, setMine] = useState<PosSettlement["totals"] | null>(null);
  const [closing, setClosing] = useState<ApiClosingTotals | null>(null);
  const [range, setRange] = useState({ from: day(), to: day(1) });
  const [verified, setVerified] = useState<(ApiJournalExport["verification"] & { count: number }) | null>(null);

  const load = useCallback(async () => {
    try {
      setReceipts((await api.receipts(40)).receipts);
      setMine((await api.settlement(whose === pos.staff.id ? undefined : whose)).totals);
      if (manager) {
        setStaff((await api.staff()).staff);
        setClosing((await api.closingPreview()).totals);
      }
    } catch (error) { pos.failed(error); }
  }, [whose, manager, pos.staff.id, pos.failed]);
  useEffect(() => { void load(); }, [load]);

  async function storno(receipt: ApiReceipt) {
    const reason = window.prompt(t("stornoReason"))?.trim();
    if (!reason) return;
    try {
      await api.stornoReceipt(receipt.id, reason);
      pos.notify(t("stornoDone", { no: receipt.receiptNo }));
      await load();
    } catch (error) { pos.failed(error); }
  }
  async function reprint(receipt: ApiReceipt) {
    try {
      await api.reprintReceipt(receipt.id);
      pos.notify(t("reprinted", { no: receipt.receiptNo }));
    } catch (error) { pos.failed(error); }
  }
  async function settle() {
    try {
      const { settlement } = await api.settle(whose === pos.staff.id ? undefined : whose);
      pos.notify(t("settled", { name: settlement.staffName }));
      await load();
    } catch (error) { pos.failed(error); }
  }
  async function closeDay() {
    if (!window.confirm(t("closeConfirm"))) return;
    try {
      const { closing: done } = await api.closeDay();
      pos.notify(t("closed", { no: done.closingNo }));
      await load();
    } catch (error) { pos.failed(error); }
  }
  async function exportJournal(format: "json" | "csv") {
    try {
      // The days as this device's clock has them (the restaurant's), not UTC's.
      const midnight = (date: string) => new Date(`${date}T00:00:00`).toISOString();
      const exported = await api.journal(midnight(range.from), midnight(range.to));
      setVerified({ ...exported.verification, count: exported.entries.length });
      const name = `journal-${range.from}-${range.to}`;
      if (format === "json") download(`${name}.json`, "application/json", JSON.stringify(exported, null, 2));
      else download(`${name}.csv`, "text/csv", journalCsv(exported));
    } catch (error) { pos.failed(error); }
  }

  const figures = (totals: ApiClosingTotals) => <dl className="pos-figures">
    <dt>{t("takings")}</dt><dd>{money(totals.grossCents)}</dd>
    {totals.vat.map((group) => <Fragment key={group.percent}><dt>{group.percent}%</dt><dd>{money(group.grossCents)}</dd></Fragment>)}
    {PAYMENTS.map((type) => <Fragment key={type}><dt>{t(type)}</dt><dd>{money(totals.payments[type])}</dd></Fragment>)}
  </dl>;
  const whoseName = staff.find((person) => person.id === whose)?.name ?? pos.staff.name;

  return <section className="pos-records">
    <div className="pos-ticket-head">
      <button type="button" onClick={() => go({ name: "floor" })}>← {t("back")}</button>
      <h1>{t("records")}</h1>
    </div>

    <div className="pos-records-grid">
      <article className="pos-card">
        <h2>{manager ? t("waiters") : t("mySettlement")}</h2>
        {manager && <select value={whose} onChange={(event) => setWhose(event.target.value)} aria-label={t("waiters")}>
          {staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
        </select>}
        {mine && mine.receipts ? <>
          <p>{t("settlementOf", { name: whoseName })} · {t("settlementLead", { count: mine.receipts, first: mine.firstReceiptNo ?? "", last: mine.lastReceiptNo ?? "" })}</p>
          {figures(mine)}
          {mine.voids?.count ? <p className="pos-voids">{t("voidsLine", { count: mine.voids.count, amount: money(mine.voids.cents) })}</p> : null}
          <p className="pos-cash">{t("cashToHandIn")}: <b>{money(mine.payments.cash)}</b></p>
          <button type="button" className="pos-primary" onClick={() => void settle()}>{t("settle")}</button>
        </> : <p className="pos-muted">{t("settlementNothing")}</p>}
      </article>

      {manager && <article className="pos-card">
        <h2>{t("closing")}</h2>
        {closing && (closing.sales || closing.stornos) ? <>
          <p>{t("closingLead", { sales: closing.sales, stornos: closing.stornos, first: closing.firstReceiptNo ?? "", last: closing.lastReceiptNo ?? "" })}</p>
          {figures(closing)}
          <button type="button" className="pos-primary" onClick={() => void closeDay()}>{t("closeDay")}</button>
        </> : <p className="pos-muted">{t("closingNothing")}</p>}
      </article>}

      {manager && <article className="pos-card">
        <h2>{t("journal")}</h2>
        <div className="pos-range">
          <label><span>{t("from")}</span><input type="date" value={range.from} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} /></label>
          <label><span>{t("to")}</span><input type="date" value={range.to} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} /></label>
        </div>
        <div className="pos-range">
          <button type="button" onClick={() => void exportJournal("json")}>{t("exportJson")}</button>
          <button type="button" onClick={() => void exportJournal("csv")}>{t("exportCsv")}</button>
        </div>
        {verified && <p className={`pos-journal ${verified.ok ? "ok" : "broken"}`} role="status">{verified.ok ? t("journalOk", { count: verified.count }) : t("journalBroken", { seq: verified.brokenAt ?? "" })}</p>}
      </article>}
    </div>

    <article className="pos-card">
      <h2>{t("receipts")}</h2>
      <ul className="pos-receipts">{receipts.map((receipt) => <li key={receipt.id} data-receipt={receipt.receiptNo} className={`${receipt.type} ${receipt.cancelledBy ? "cancelled" : ""}`}>
        <b>{t("receiptNo", { no: receipt.receiptNo })}</b>
        <span>
          {new Date(receipt.createdAt).toLocaleTimeString(pos.language === "zh" ? "zh-CN" : pos.language, { hour: "2-digit", minute: "2-digit" })}
          {receipt.table ? ` · ${receipt.table}` : ""}{receipt.staffName ? ` · ${receipt.staffName}` : ""}
          {" · "}{receipt.payments.map((payment) => t(payment.type)).join(" + ")}
          {receipt.type === "storno" && <em>{t("stornoOf", { no: receipt.refersToNo ?? "" })}{receipt.reason ? ` · ${receipt.reason}` : ""}</em>}
          {receipt.cancelledBy && <em>{t("cancelled")}</em>}
        </span>
        <strong>{money(receipt.totalCents)}</strong>
        <span className="pos-receipt-actions">
          <button type="button" onClick={() => void reprint(receipt)}>{t("reprint")}</button>
          {manager && receipt.type === "sale" && !receipt.cancelledBy ? <button type="button" onClick={() => void storno(receipt)}>{t("storno")}</button> : null}
        </span>
      </li>)}</ul>
    </article>
  </section>;
}

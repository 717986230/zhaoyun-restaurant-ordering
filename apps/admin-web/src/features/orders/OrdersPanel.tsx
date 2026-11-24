import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminApi } from "@zhaoyun/api-client";
import type { ApiReceipt, PaymentType } from "@zhaoyun/contracts";
import { formatMoney, useI18n } from "../../app/i18n";
import type { CopyKey } from "../../app/i18n";

interface Props {
  api: AdminApi;
  /** The restaurant's time zone: a bill's day and time are its clock, not the browser's. */
  timeZone: string;
  failed: (error: unknown) => void;
  notify: (message: string) => void;
}

type Preset = "today" | "yesterday" | "week" | "month";
const PRESETS: Array<[Preset, CopyKey]> = [["today", "reportToday"], ["yesterday", "reportYesterday"], ["week", "reportWeek"], ["month", "reportMonth"]];
const PAYMENTS: PaymentType[] = ["cash", "card", "voucher", "balance"];
const PAY_KEY: Record<PaymentType, CopyKey> = { cash: "reportCash", card: "reportCard", voucher: "reportVoucher", balance: "reportBalance" };

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Today in the restaurant's time zone, as YYYY-MM-DD. */
function todayIn(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function rangeOf(preset: Preset, timeZone: string): [string, string] {
  const today = todayIn(timeZone);
  const at = Date.parse(`${today}T00:00:00Z`);
  switch (preset) {
    case "today": return [today, today];
    case "yesterday": return [isoDay(at - DAY_MS), isoDay(at - DAY_MS)];
    case "week": return [isoDay(at - 6 * DAY_MS), today];
    case "month": return [`${today.slice(0, 8)}01`, today];
  }
}

interface Filter { from: string; to: string; table: string; payment: string; type: string; q: string }

export function OrdersPanel({ api, timeZone, failed, notify }: Props) {
  const { t, language } = useI18n();
  const money = (cents: number) => formatMoney(cents, language);
  const [initialFrom, initialTo] = rangeOf("today", timeZone);
  const [filter, setFilter] = useState<Filter>({ from: initialFrom, to: initialTo, table: "", payment: "", type: "", q: "" });
  const [receipts, setReceipts] = useState<ApiReceipt[]>([]);
  const [open, setOpen] = useState<ApiReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [reprinting, setReprinting] = useState<string | null>(null);

  const stamp = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

  const load = useCallback(async (current: Filter) => {
    setBusy(true);
    try {
      const query: { from?: string; to?: string; table?: string; payment?: string; type?: string; q?: string } = {};
      if (current.from) query.from = current.from;
      if (current.to) query.to = current.to;
      if (current.table.trim()) query.table = current.table.trim();
      if (current.payment) query.payment = current.payment;
      if (current.type) query.type = current.type;
      if (current.q.trim()) query.q = current.q.trim();
      setReceipts((await api.receipts(query)).receipts);
    } catch (error) { failed(error); } finally { setBusy(false); }
  }, [api, failed]);

  // The first load, and whenever a preset button rewrites the dates.
  const last = useRef("");
  useEffect(() => {
    const key = `${filter.from}_${filter.to}_${filter.payment}_${filter.type}`;
    if (key === last.current) return;
    last.current = key;
    void load(filter);
  }, [filter, load]);

  async function reprint(receipt: ApiReceipt) {
    setReprinting(receipt.id);
    try {
      await api.reprintReceipt(receipt.id);
      notify(t("ordersReprinted", { no: receipt.receiptNo }));
    } catch (error) { failed(error); } finally { setReprinting(null); }
  }

  const payLabel = (type: PaymentType) => t(PAY_KEY[type] ?? "reportCash");
  const paySummary = (receipt: ApiReceipt) => [...new Set(receipt.payments.map((payment) => payLabel(payment.type)))].join(" + ");

  return <section id="ordersPanel" className="admin-panel active"><div className="settings-page">
    <div className="list-head">
      <h1 className="settings-title">{t("ordersTitle")}</h1>
      <p className="settings-hint">{t("ordersHint")}</p>
    </div>

    <form className="report-dates res-filter" onSubmit={(event) => { event.preventDefault(); last.current = ""; void load(filter); }}>
      <label><span>{t("reportFrom")}</span><input name="from" type="date" value={filter.from} onChange={(event) => setFilter({ ...filter, from: event.target.value })} /></label>
      <label><span>{t("reportTo")}</span><input name="to" type="date" value={filter.to} onChange={(event) => setFilter({ ...filter, to: event.target.value })} /></label>
      <label><span>{t("ordersTable")}</span><input name="table" maxLength={16} placeholder={t("ordersTablePlaceholder")} value={filter.table} onChange={(event) => setFilter({ ...filter, table: event.target.value })} /></label>
      <label><span>{t("ordersPayment")}</span><select name="payment" value={filter.payment} onChange={(event) => setFilter({ ...filter, payment: event.target.value })}>
        <option value="">{t("ordersAnyPayment")}</option>
        {PAYMENTS.map((payment) => <option key={payment} value={payment}>{payLabel(payment)}</option>)}
      </select></label>
      <label><span>{t("ordersType")}</span><select name="type" value={filter.type} onChange={(event) => setFilter({ ...filter, type: event.target.value })}>
        <option value="">{t("ordersAnyType")}</option>
        <option value="sale">{t("ordersTypeSale")}</option>
        <option value="storno">{t("ordersTypeStorno")}</option>
      </select></label>
      <label className="orders-search"><span>{t("ordersSearch")}</span><input name="q" maxLength={64} placeholder={t("ordersSearchPlaceholder")} value={filter.q} onChange={(event) => setFilter({ ...filter, q: event.target.value })} /></label>
      <div className="filter-actions">
        <button type="submit" className="ghost-action" disabled={busy}>{t("reportShow")}</button>
        {PRESETS.map(([preset, key]) => <button key={preset} type="button" className="ghost-action" onClick={() => { const [from, to] = rangeOf(preset, timeZone); setFilter({ ...filter, from, to }); }}>{t(key)}</button>)}
      </div>
    </form>

    <p className="settings-hint" aria-live="polite">{t("ordersCount", { n: receipts.length })}</p>

    {!receipts.length ? <div className="admin-empty">{busy ? "…" : t("ordersEmpty")}</div> : <div className="res-table-wrap"><table className="report-table res-records-table">
      <thead><tr><th>{t("ordersNo")}</th><th>{t("ordersTime")}</th><th>{t("ordersTable")}</th><th>{t("ordersTotal")}</th><th>{t("ordersPayment")}</th><th>{t("reportStaff")}</th><th aria-label={t("ordersActions")}></th></tr></thead>
      <tbody>{receipts.map((receipt) => <tr key={receipt.id} data-storno={receipt.type === "storno" ? "1" : undefined}>
        <td>#{receipt.receiptNo}{receipt.type === "storno" ? <em className="res-warn"> · {t("ordersTypeStorno")}</em> : receipt.cancelledBy ? <em className="res-warn"> · {t("ordersCancelled")}</em> : null}</td>
        <td>{stamp(receipt.createdAt)}</td>
        <td>{receipt.table ?? "—"}</td>
        <td>{money(receipt.totalCents)}</td>
        <td>{paySummary(receipt)}</td>
        <td>{receipt.staffName ?? t("reportConsole")}</td>
        <td className="orders-row-actions">
          <button type="button" className="ghost-action" onClick={() => setOpen(receipt)}>{t("ordersDetail")}</button>
          <button type="button" className="ghost-action" disabled={reprinting === receipt.id} onClick={() => void reprint(receipt)}>{t("ordersReprint")}</button>
        </td>
      </tr>)}</tbody>
    </table></div>}

    {open && <div className="res-dialog" role="dialog" aria-modal="true" aria-label={t("ordersDetail")} onClick={(event) => { if (event.target === event.currentTarget) setOpen(null); }}>
      <article className="res-print" id="ordersRecord">
        <header className="orders-detail-head">
          <h2>#{open.receiptNo} · {money(open.totalCents)}</h2>
          <small>{stamp(open.createdAt)}{open.table ? ` · ${t("ordersTable")} ${open.table}` : ""} · {open.staffName ?? t("reportConsole")}</small>
          {open.type === "storno" && <p className="res-warn">{t("ordersTypeStorno")}{open.refersToNo ? ` #${open.refersToNo}` : ""}{open.reason ? ` · ${open.reason}` : ""}</p>}
          {open.type !== "storno" && open.cancelledBy && <p className="res-warn">{t("ordersCancelled")}</p>}
        </header>
        <ul className="orders-lines">{open.lines.map((line, index) => <li key={index}>
          <span className="orders-line-name">{line.quantity > 1 ? `${line.quantity}× ` : ""}{line.name}{line.modifiers?.length ? <small> · {line.modifiers.join(" · ")}</small> : null}</span>
          <span className="orders-line-total">{money(line.totalCents)}</span>
        </li>)}</ul>
        <dl className="orders-detail-grid">
          {open.vat.map((row) => <div key={row.percent}><dt>{t("reportVat")} {row.percent}%</dt><dd>{money(row.grossCents)}</dd></div>)}
          <div className="orders-detail-total"><dt>{t("ordersTotal")}</dt><dd>{money(open.totalCents)}</dd></div>
          {open.payments.map((payment, index) => <div key={index}><dt>{payLabel(payment.type)}</dt><dd>{money(payment.amountCents)}{payment.tipCents ? ` (+${money(payment.tipCents)} ${t("reportTips")})` : ""}{payment.changeCents ? ` · ${t("ordersChange")} ${money(payment.changeCents)}` : ""}</dd></div>)}
        </dl>
        <div className="res-actions res-no-print">
          <button type="button" className="primary-action" disabled={reprinting === open.id} onClick={() => void reprint(open)}>{t("ordersReprint")}</button>
          <button type="button" className="ghost-action" onClick={() => setOpen(null)}>{t("ordersClose")}</button>
        </div>
      </article>
    </div>}
  </div></section>;
}

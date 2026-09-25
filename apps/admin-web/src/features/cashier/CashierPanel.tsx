import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { AdminApi, StaffRole, TableOverview } from "@zhaoyun/api-client";
import type { ApiBill, ApiClosing, ApiClosingTotals, ApiJournalExport, ApiReceipt, PaymentType } from "@zhaoyun/contracts";
import { formatMoney, formatTime, useI18n } from "../../app/i18n";
import type { CopyKey } from "../../app/i18n";

interface Props {
  api: AdminApi;
  role: StaffRole | null;
  tables: TableOverview[];
  /** The table the waiter came from ("结账" on the tables page). */
  initialTable: string | null;
  /** The tables page and the board are out of date once a receipt is issued. */
  onChanged: () => Promise<void>;
  notify: (message: string) => void;
  failed: (error: unknown, fallback: CopyKey) => void;
}

interface PaymentDraft { type: PaymentType; amount: string; tendered: string; voucherCode: string; balanceCents: number | null }

const PAY_KEYS: Record<PaymentType, CopyKey> = { cash: "payCash", card: "payCard", voucher: "payVoucher" };
const toCents = (text: string) => Math.round(Number(String(text).replace(",", ".")) * 100) || 0;
const toAmount = (cents: number) => (cents / 100).toFixed(2);
/** A local date (YYYY-MM-DD), today or some days on. */
const day = (offset = 0) => {
  const date = new Date(Date.now() + offset * 86_400_000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

function download(name: string, type: string, text: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function journalCsv(exported: ApiJournalExport) {
  const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows = exported.entries.map((entry) => [entry.seq, entry.at, entry.kind, entry.ref, entry.prevHash, entry.hash, JSON.stringify(entry.payload)].map(cell).join(","));
  return ["seq,at,kind,ref,prev_hash,hash,payload", ...rows].join("\r\n");
}

/**
 * The register, for the tablet at the counter and the computer in the
 * office alike.
 *
 * A receipt is one table's lines, all or some of them — a guest who pays for
 * their own dishes is a receipt of those, the next guest's another — plus
 * any voucher sold, paid in cash (with change worked out), by card or with a
 * voucher, in any mix that adds up. Below: the receipts, each of which the
 * manager can cancel by a storno; the day's closing; and the journal the tax
 * office asks for.
 *
 * Until fiskaly signs them the receipts are test receipts, and this says so.
 */
export function CashierPanel(props: Props) {
  const { t, language } = useI18n();
  const money = (cents: number) => formatMoney(cents, language);
  const manager = props.role === "manager";
  const open = props.tables.filter((table) => table.total > 0);

  const [table, setTable] = useState<string | null>(props.initialTable);
  const [bill, setBill] = useState<ApiBill | null>(null);
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [vouchers, setVouchers] = useState<number[]>([]);
  const [voucherInput, setVoucherInput] = useState("");
  const [payments, setPayments] = useState<PaymentDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [receipts, setReceipts] = useState<ApiReceipt[]>([]);
  const [preview, setPreview] = useState<ApiClosingTotals | null>(null);
  const [closings, setClosings] = useState<ApiClosing[]>([]);
  const [range, setRange] = useState({ from: day(), to: day(1) });
  const [verified, setVerified] = useState<ApiJournalExport["verification"] & { count: number } | null>(null);
  // A new receipt's id per attempt: a retried tap is the same receipt, not a second.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  const loadBill = useCallback(async (which: string | null) => {
    if (!which) { setBill(null); setPicks({}); return; }
    try {
      const { bill: loaded } = await props.api.bill(which);
      setBill(loaded);
      setPicks(Object.fromEntries(loaded.items.map((item) => [item.orderItemId, item.qty])));
    } catch (error) { props.failed(error, "cashierFailed"); }
  }, [props.api, props.failed]);

  const loadRecords = useCallback(async () => {
    try {
      setReceipts((await props.api.receipts(30)).receipts);
      if (manager) {
        setPreview((await props.api.closingPreview()).totals);
        setClosings((await props.api.closings(10)).closings);
      }
    } catch (error) { props.failed(error, "cashierFailed"); }
  }, [props.api, props.failed, manager]);

  useEffect(() => { void loadBill(table); }, [table, loadBill]);
  useEffect(() => { void loadRecords(); }, [loadRecords]);
  useEffect(() => { if (props.initialTable) setTable(props.initialTable); }, [props.initialTable]);

  const lines = bill?.items ?? [];
  const itemsCents = lines.reduce((sum, item) => sum + Math.round(item.unitPrice * 100) * (picks[item.orderItemId] ?? 0), 0);
  const vouchersCents = vouchers.reduce((sum, cents) => sum + cents, 0);
  const totalCents = itemsCents + vouchersCents;
  const paidCents = payments.reduce((sum, payment) => sum + toCents(payment.amount), 0);
  const remaining = totalCents - paidCents;
  const cash = payments.find((payment) => payment.type === "cash" && payment.tendered);
  const change = cash ? toCents(cash.tendered) - toCents(cash.amount) : 0;
  const canIssue = totalCents > 0 && remaining === 0 && !busy && change >= 0 && !(vouchers.length && payments.some((payment) => payment.type === "voucher"));

  const pick = (id: string, quantity: number, max: number) => setPicks((current) => ({ ...current, [id]: Math.max(0, Math.min(max, quantity)) }));
  const addPayment = (type: PaymentType) => setPayments((current) => [...current, { type, amount: toAmount(Math.max(0, totalCents - current.reduce((sum, payment) => sum + toCents(payment.amount), 0))), tendered: "", voucherCode: "", balanceCents: null }]);
  const editPayment = (index: number, change: Partial<PaymentDraft>) => setPayments((current) => current.map((payment, at) => (at === index ? { ...payment, ...change } : payment)));
  const choose = (next: string | null) => { setTable(next); setPayments([]); setVouchers([]); };

  async function checkVoucher(index: number) {
    const code = payments[index]?.voucherCode;
    if (!code) return;
    try {
      const { voucher } = await props.api.voucher(code);
      editPayment(index, { voucherCode: voucher.code, balanceCents: voucher.voided ? 0 : voucher.balanceCents });
    } catch (error) { props.failed(error, "cashierFailed"); }
  }

  async function issue() {
    setBusy(true);
    try {
      const { receipt } = await props.api.checkout({
        clientRequestId: requestId,
        ...(table ? { table } : {}),
        items: lines.filter((item) => (picks[item.orderItemId] ?? 0) > 0).map((item) => ({ orderItemId: item.orderItemId, quantity: picks[item.orderItemId] ?? 0 })),
        vouchers: vouchers.map((cents) => ({ amount: cents / 100 })),
        payments: payments.map((payment) => ({
          type: payment.type,
          amount: toCents(payment.amount) / 100,
          ...(payment.type === "cash" && payment.tendered ? { tendered: toCents(payment.tendered) / 100 } : {}),
          ...(payment.type === "voucher" ? { voucherCode: payment.voucherCode } : {})
        }))
      });
      const given = receipt.payments.find((payment) => payment.changeCents);
      props.notify(t("cashierIssued", { no: receipt.receiptNo, change: given?.changeCents ? t("cashierIssuedChange", { amount: money(given.changeCents) }) : "" }));
      setRequestId(crypto.randomUUID());
      setPayments([]);
      setVouchers([]);
      await Promise.all([loadBill(table), loadRecords(), props.onChanged()]);
    } catch (error) {
      props.failed(error, "cashierFailed");
    } finally {
      setBusy(false);
    }
  }

  async function storno(receipt: ApiReceipt) {
    const reason = window.prompt(t("receiptStornoReason"))?.trim();
    if (!reason) return;
    try {
      await props.api.stornoReceipt(receipt.id, reason);
      props.notify(t("receiptStornoDone", { no: receipt.receiptNo }));
      await Promise.all([loadBill(table), loadRecords(), props.onChanged()]);
    } catch (error) { props.failed(error, "cashierFailed"); }
  }

  async function closeDay() {
    if (!preview?.sales && !preview?.stornos) return;
    if (!window.confirm(t("closingConfirm"))) return;
    try {
      const { closing } = await props.api.closeDay();
      props.notify(t("closingDone", { no: closing.closingNo }));
      await loadRecords();
    } catch (error) { props.failed(error, "cashierFailed"); }
  }

  async function exportJournal(format: "json" | "csv") {
    try {
      // The days as this device's clock has them (the restaurant's), not UTC's.
      const midnight = (date: string) => new Date(`${date}T00:00:00`).toISOString();
      const exported = await props.api.journal(midnight(range.from), midnight(range.to));
      setVerified({ ...exported.verification, count: exported.entries.length });
      const name = `journal-${range.from}-${range.to}`;
      if (format === "json") download(`${name}.json`, "application/json", JSON.stringify(exported, null, 2));
      else download(`${name}.csv`, "text/csv", journalCsv(exported));
    } catch (error) { props.failed(error, "cashierFailed"); }
  }

  const receiptNos = useMemo(() => new Map(receipts.map((receipt) => [receipt.id, receipt.receiptNo])), [receipts]);

  return <section id="cashierPanel" className="admin-panel active">
    <div className="list-head">
      <div>
        <h1>{t("cashierTitle")}</h1>
        <p>{t("cashierLead")}</p>
      </div>
    </div>
    <p className="cashier-unsigned" role="note">{t("cashierUnsigned")}</p>

    <div className="cashier-layout">
      <section className="cashier-tables" aria-label={t("cashierTables")}>
        <h2>{t("cashierTables")}</h2>
        <div className="cashier-table-list">
          {open.map((entry) => <button key={entry.table} type="button" className={table === entry.table ? "on" : ""} aria-pressed={table === entry.table} onClick={() => choose(entry.table)}>
            <b>{t("table", { table: entry.table })}</b><span>{money(Math.round(entry.total * 100))}</span>
          </button>)}
          <button type="button" className={table === null ? "on" : ""} aria-pressed={table === null} onClick={() => choose(null)}><b>{t("cashierNoTable")}</b></button>
        </div>
        {!open.length && <p className="settings-hint">{t("cashierNoOpen")}</p>}
      </section>

      <section className="cashier-lines" aria-label={t("cashierLines")}>
        <div className="cashier-lines-head">
          <h2>{t("cashierLines")}</h2>
          {lines.length > 0 && <span>
            <button type="button" className="ghost-action" onClick={() => setPicks(Object.fromEntries(lines.map((item) => [item.orderItemId, item.qty])))}>{t("cashierAll")}</button>
            <button type="button" className="ghost-action" onClick={() => setPicks({})}>{t("cashierNone")}</button>
          </span>}
        </div>
        {table && !lines.length && <p className="settings-hint">{t("cashierPaid")}</p>}
        <ul className="cashier-line-list">{lines.map((item) => {
          const count = picks[item.orderItemId] ?? 0;
          return <li key={item.orderItemId} className={count ? "picked" : ""}>
            <span className="cashier-line-name">{item.name}{item.modifiers?.length ? <small>{item.modifiers.map((modifier) => modifier.name).join(" · ")}</small> : null}</span>
            <span className="cashier-stepper">
              <button type="button" aria-label={t("cashierLess", { name: item.name })} disabled={!count} onClick={() => pick(item.orderItemId, count - 1, item.qty)}>−</button>
              <b>{count}/{item.qty}</b>
              <button type="button" aria-label={t("cashierMore", { name: item.name })} disabled={count >= item.qty} onClick={() => pick(item.orderItemId, count + 1, item.qty)}>+</button>
            </span>
            <span className="cashier-line-amount">{money(Math.round(item.unitPrice * 100) * count)}</span>
          </li>;
        })}
          {vouchers.map((cents, index) => <li key={`voucher-${index}`} className="picked voucher">
            <span className="cashier-line-name">{t("cashierVoucherLine", { amount: money(cents) })}<small>0%</small></span>
            <button type="button" className="ghost-action" onClick={() => setVouchers((current) => current.filter((_, at) => at !== index))}>{t("cashierRemove")}</button>
            <span className="cashier-line-amount">{money(cents)}</span>
          </li>)}
        </ul>
        <form className="cashier-voucher-sale" onSubmit={(event) => { event.preventDefault(); const cents = toCents(voucherInput); if (cents > 0) { setVouchers((current) => [...current, cents]); setVoucherInput(""); } }}>
          <label><span>{t("cashierSellVoucher")}</span><input inputMode="decimal" aria-label={t("cashierVoucherAmount")} placeholder="50.00" value={voucherInput} onChange={(event) => setVoucherInput(event.target.value)} /></label>
          <button type="submit" className="ghost-action" disabled={toCents(voucherInput) <= 0}>{t("cashierAddVoucher")}</button>
        </form>
      </section>

      <section className="cashier-pay" aria-label={t("cashierPayments")}>
        <div className="cashier-total"><span>{t("cashierTotal")}</span><b>{money(totalCents)}</b></div>
        <div className="cashier-pay-types" role="group" aria-label={t("cashierPayments")}>
          {(["cash", "card", "voucher"] as PaymentType[]).map((type) => <button key={type} type="button" className="ghost-action" disabled={!totalCents || (type === "voucher" && vouchers.length > 0)} onClick={() => addPayment(type)}>+ {t(PAY_KEYS[type])}</button>)}
        </div>
        <ul className="cashier-payment-list">{payments.map((payment, index) => <li key={index} data-type={payment.type}>
          <b>{t(PAY_KEYS[payment.type])}</b>
          <label><span>{t("cashierAmount")}</span><input inputMode="decimal" value={payment.amount} onChange={(event) => editPayment(index, { amount: event.target.value })} /></label>
          {payment.type === "cash" && <label><span>{t("cashierTendered")}</span><input inputMode="decimal" placeholder={payment.amount} value={payment.tendered} onChange={(event) => editPayment(index, { tendered: event.target.value })} /></label>}
          {payment.type === "voucher" && <label><span>{t("cashierVoucherCode")}</span><input value={payment.voucherCode} autoCapitalize="characters" onChange={(event) => editPayment(index, { voucherCode: event.target.value.toUpperCase(), balanceCents: null })} onBlur={() => void checkVoucher(index)} /></label>}
          {payment.balanceCents !== null && <small>{t("cashierVoucherBalance", { amount: money(payment.balanceCents) })}</small>}
          <button type="button" className="ghost-action" aria-label={t("cashierRemove")} onClick={() => setPayments((current) => current.filter((_, at) => at !== index))}>✕</button>
        </li>)}</ul>
        {change > 0 && <p className="cashier-change">{t("cashierChange", { amount: money(change) })}</p>}
        {totalCents > 0 && remaining !== 0 && <p className="cashier-remaining">{remaining > 0 ? t("cashierRemaining", { amount: money(remaining) }) : t("cashierOver", { amount: money(-remaining) })}</p>}
        <button type="button" className="primary-action cashier-issue" disabled={!canIssue} onClick={() => void issue()}>{t("cashierIssue")}</button>
      </section>
    </div>

    <section className="cashier-records">
      <h2>{t("cashierReceipts")}</h2>
      {receipts.length ? <ul className="receipt-list">{receipts.map((receipt) => <li key={receipt.id} data-receipt={receipt.receiptNo} className={`${receipt.type} ${receipt.cancelledBy ? "cancelled" : ""}`}>
        <span className="receipt-no">{t("receiptNo", { no: receipt.receiptNo })}</span>
        <span className="receipt-meta">
          {formatTime(receipt.createdAt, language)}{receipt.table ? ` · ${t("table", { table: receipt.table })}` : ""}
          {" · "}{receipt.payments.map((payment) => t(PAY_KEYS[payment.type])).join(" + ")}
          {receipt.type === "storno" && <em>{t("receiptStornoOf", { no: receipt.refersToNo ?? (receipt.refersTo ? receiptNos.get(receipt.refersTo) ?? "" : "") })}{receipt.reason ? ` · ${receipt.reason}` : ""}</em>}
          {receipt.cancelledBy && <em>{t("receiptCancelled")}</em>}
        </span>
        <strong>{money(receipt.totalCents)}</strong>
        {manager && receipt.type === "sale" && !receipt.cancelledBy ? <button type="button" className="ghost-action" onClick={() => void storno(receipt)}>{t("receiptStorno")}</button> : <span />}
      </li>)}</ul> : <p className="settings-hint">{t("cashierNoReceipts")}</p>}
    </section>

    {manager && <div className="cashier-office">
      <section className="cashier-closing">
        <h2>{t("closingTitle")}</h2>
        {preview && (preview.sales || preview.stornos) ? <>
          <p>{t("closingSales", { sales: preview.sales, stornos: preview.stornos, first: preview.firstReceiptNo ?? "", last: preview.lastReceiptNo ?? "" })}</p>
          <dl className="closing-figures">
            <dt>{t("closingGross")}</dt><dd>{money(preview.grossCents)}</dd>
            {preview.vat.map((group) => <Fragment key={group.percent}><dt>{group.percent}%</dt><dd>{money(group.grossCents)} <small>({t("billVat")} {money(group.vatCents)})</small></dd></Fragment>)}
            {(["cash", "card", "voucher"] as PaymentType[]).map((type) => <Fragment key={type}><dt>{t(PAY_KEYS[type])}</dt><dd>{money(preview.payments[type])}</dd></Fragment>)}
            {preview.vouchersSoldCents > 0 && <><dt>{t("closingVouchers")}</dt><dd>{money(preview.vouchersSoldCents)}</dd></>}
          </dl>
          <button type="button" className="primary-action" onClick={() => void closeDay()}>{t("closingDo")}</button>
        </> : <p className="settings-hint">{t("closingNothing")}</p>}
        {closings.length > 0 && <>
          <p className="settings-label">{t("closingHistory")}</p>
          <ul className="closing-list">{closings.map((closing) => <li key={closing.id}><span>Z {closing.closingNo} · {formatTime(closing.createdAt, language)}</span><span>{t("receiptNo", { no: `${closing.totals.firstReceiptNo}–${closing.totals.lastReceiptNo}` })}</span><strong>{money(closing.totals.grossCents)}</strong></li>)}</ul>
        </>}
      </section>

      <section className="cashier-journal">
        <h2>{t("journalTitle")}</h2>
        <p className="settings-hint">{t("journalLead")}</p>
        <div className="journal-range">
          <label><span>{t("journalFrom")}</span><input type="date" value={range.from} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} /></label>
          <label><span>{t("journalTo")}</span><input type="date" value={range.to} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} /></label>
        </div>
        <div className="journal-actions">
          <button type="button" className="ghost-action" onClick={() => void exportJournal("json")}>{t("journalJson")}</button>
          <button type="button" className="ghost-action" onClick={() => void exportJournal("csv")}>{t("journalCsv")}</button>
        </div>
        {verified && <p className={`journal-status ${verified.ok ? "ok" : "broken"}`} role="status">{verified.ok ? t("journalOk", { count: verified.count }) : t("journalBroken", { seq: verified.brokenAt ?? "" })}</p>}
      </section>
    </div>}
  </section>;
}

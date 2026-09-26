import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiBill, PaymentType } from "@zhaoyun/contracts";
import { api, useLiveReload } from "./App";
import type { Pos, Screen } from "./App";

const HOLD_MS = 30_000;
const PAY_KEYS: Record<PaymentType, "cash" | "card" | "voucher"> = { cash: "cash", card: "card", voucher: "voucher" };
interface Payment { type: PaymentType; amount: string; tendered: string; voucherCode: string; balanceCents: number | null }

const toCents = (text: string) => Math.round(Number(String(text).replace(",", ".")) * 100) || 0;
const toAmount = (cents: number) => (cents / 100).toFixed(2);

/**
 * "Zusammen oder getrennt?" — the question every table in Austria is asked.
 * Together: one receipt for everything. Separately: each guest's own lines,
 * one receipt each, until the table is paid. Cash (with the change worked
 * out), card or voucher, in any mix that adds up; a takeaway gets its pickup
 * discount.
 */
export function PayScreen({ pos, table, go }: { pos: Pos; table: string; go: (screen: Screen) => void }) {
  const { t, money, language } = pos;
  const takeaway = /^TA-/i.test(table);
  const [bill, setBill] = useState<ApiBill | null>(null);
  const [separate, setSeparate] = useState(false);
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [discount, setDiscount] = useState(0);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [busy, setBusy] = useState(false);
  const requestId = useRef(crypto.randomUUID());

  /**
   * `picks`: "all" takes every open line (together), "none" starts a guest
   * afresh (separately, after a receipt), "keep" keeps what is picked — a
   * guest's QR order arriving must not undo the waiter's picking.
   */
  const load = useCallback(async (picking: "all" | "none" | "keep") => {
    try {
      const { bill: loaded } = await api.bill(table);
      setBill(loaded);
      setPicks((current) => Object.fromEntries(loaded.items.flatMap((item) => {
        const count = picking === "all" ? item.qty : picking === "keep" ? Math.min(current[item.orderItemId] ?? 0, item.qty) : 0;
        return count ? [[item.orderItemId, count]] : [];
      })));
      return loaded;
    } catch (error) { pos.failed(error); return null; }
  }, [table, pos.failed]);

  useEffect(() => {
    void load("all");
    if (takeaway) api.floor().then((floor) => setDiscount(floor.takeawayDiscountPercent)).catch(() => undefined);
    void api.claim(table).catch(pos.failed);
    const hold = window.setInterval(() => { api.claim(table).catch(pos.failed); }, HOLD_MS);
    return () => { window.clearInterval(hold); void api.release(table).catch(() => undefined); };
  }, [table, takeaway, load, pos.failed]);

  useLiveReload(pos, (event) => event.type === "floor.changed" && event.table === table, () => void load(separate ? "keep" : "all"));

  const lines = bill?.items ?? [];
  const itemsCents = lines.reduce((sum, item) => sum + Math.round(item.unitPrice * 100) * (picks[item.orderItemId] ?? 0), 0);
  // Off each VAT rate in proportion, as the server works it out (shared/register.mjs).
  const byRate = new Map<number, number>();
  for (const item of lines) {
    const cents = Math.round(item.unitPrice * 100) * (picks[item.orderItemId] ?? 0);
    const parts = item.vatSplit?.length ? item.vatSplit.map((part) => ({ percent: part.percent, cents: Math.round((part.amount * 100 * (picks[item.orderItemId] ?? 0)) / item.qty) })) : [{ percent: item.vatPercent, cents }];
    for (const part of parts) byRate.set(part.percent, (byRate.get(part.percent) ?? 0) + part.cents);
  }
  const offCents = [...byRate.values()].reduce((sum, cents) => sum + Math.round((cents * discount) / 100), 0);
  const totalCents = itemsCents - offCents;
  const paidCents = payments.reduce((sum, payment) => sum + toCents(payment.amount), 0);
  const remaining = totalCents - paidCents;
  const cash = payments.find((payment) => payment.type === "cash" && payment.tendered);
  const change = cash ? toCents(cash.tendered) - toCents(cash.amount) : 0;
  const canIssue = totalCents > 0 && remaining === 0 && change >= 0 && !busy;

  const setMode = (next: boolean) => {
    setSeparate(next);
    setPayments([]);
    setPicks(next ? {} : Object.fromEntries(lines.map((item) => [item.orderItemId, item.qty])));
  };
  const pick = (id: string, quantity: number, max: number) => setPicks((current) => ({ ...current, [id]: Math.max(0, Math.min(max, quantity)) }));
  const addPayment = (type: PaymentType) => setPayments((current) => [...current, { type, amount: toAmount(Math.max(0, totalCents - current.reduce((sum, payment) => sum + toCents(payment.amount), 0))), tendered: "", voucherCode: "", balanceCents: null }]);
  const edit = (index: number, change: Partial<Payment>) => setPayments((current) => current.map((payment, at) => (at === index ? { ...payment, ...change } : payment)));

  async function checkVoucher(index: number) {
    const code = payments[index]?.voucherCode;
    if (!code) return;
    try {
      const { voucher } = await api.voucher(code);
      edit(index, { voucherCode: voucher.code, balanceCents: voucher.voided ? 0 : voucher.balanceCents });
    } catch (error) { pos.failed(error); }
  }

  async function issue() {
    setBusy(true);
    try {
      const { receipt } = await api.checkout({
        clientRequestId: requestId.current,
        table,
        items: lines.filter((item) => (picks[item.orderItemId] ?? 0) > 0).map((item) => ({ orderItemId: item.orderItemId, quantity: picks[item.orderItemId] ?? 0 })),
        ...(discount ? { discountPercent: discount } : {}),
        payments: payments.map((payment) => ({
          type: payment.type,
          amount: toCents(payment.amount) / 100,
          ...(payment.type === "cash" && payment.tendered ? { tendered: toCents(payment.tendered) / 100 } : {}),
          ...(payment.type === "voucher" ? { voucherCode: payment.voucherCode } : {})
        }))
      });
      const given = receipt.payments.find((payment) => payment.changeCents);
      pos.notify(t("issued", { no: receipt.receiptNo, change: given?.changeCents ? t("issuedChange", { amount: money(given.changeCents) }) : "" }));
      requestId.current = crypto.randomUUID();
      setPayments([]);
      const left = await load(separate ? "none" : "all");
      if (left && !left.items.length) {
        pos.notify(t("tablePaid", { table }));
        go({ name: "floor" });
      }
    } catch (error) {
      pos.failed(error);
    } finally {
      setBusy(false);
    }
  }

  return <section className="pos-pay-screen">
    <div className="pos-pay-lines">
      <div className="pos-ticket-head">
        <button type="button" onClick={() => go({ name: "order", table })}>← {t("back")}</button>
        <h1>{t("payTitle", { table })}</h1>
      </div>
      <p className="pos-unsigned" role="note">{t("unsigned")}</p>
      <div className="pos-mode" role="group">
        <button type="button" className={separate ? "" : "on"} aria-pressed={!separate} onClick={() => setMode(false)}>{t("together")}</button>
        <button type="button" className={separate ? "on" : ""} aria-pressed={separate} onClick={() => setMode(true)}>{t("separate")}</button>
      </div>
      {separate && <p className="pos-muted">{t("separateHint")}</p>}
      <ul className="pos-lines pay">{lines.map((item) => {
        const count = picks[item.orderItemId] ?? 0;
        return <li key={item.orderItemId} className={count ? "picked" : ""}>
          <span>{item.names?.[language] || item.name}{item.modifiers?.length ? <small>{item.modifiers.map((modifier) => modifier.name).join(" · ")}</small> : null}</span>
          {separate ? <span className="pos-stepper">
            <button type="button" aria-label="−" disabled={!count} onClick={() => pick(item.orderItemId, count - 1, item.qty)}>−</button>
            <b>{count}/{item.qty}</b>
            <button type="button" aria-label="+" disabled={count >= item.qty} onClick={() => pick(item.orderItemId, count + 1, item.qty)}>+</button>
          </span> : <span>{item.qty} ×</span>}
          <b>{money(Math.round(item.unitPrice * 100) * count)}</b>
        </li>;
      })}</ul>
    </div>

    <div className="pos-pay-panel">
      <label className="pos-discount"><span>{t("discount")}</span><input type="number" min={0} max={100} step={1} inputMode="numeric" value={discount} onChange={(event) => setDiscount(Math.max(0, Math.min(100, Math.round(Number(event.target.value) || 0))))} /></label>
      <div className="pos-total"><span>{t("total")}</span><b>{money(totalCents)}</b></div>
      <div className="pos-pay-types">{(["cash", "card", "voucher"] as PaymentType[]).map((type) => <button key={type} type="button" disabled={!totalCents} onClick={() => addPayment(type)}>+ {t(PAY_KEYS[type])}</button>)}</div>
      <ul className="pos-payments">{payments.map((payment, index) => <li key={index}>
        <b>{t(PAY_KEYS[payment.type])}</b>
        <label><span>{t("amount")}</span><input inputMode="decimal" value={payment.amount} onChange={(event) => edit(index, { amount: event.target.value })} /></label>
        {payment.type === "cash" && <label><span>{t("tendered")}</span><input inputMode="decimal" placeholder={payment.amount} value={payment.tendered} onChange={(event) => edit(index, { tendered: event.target.value })} /></label>}
        {payment.type === "voucher" && <label><span>{t("voucherCode")}</span><input value={payment.voucherCode} autoCapitalize="characters" onChange={(event) => edit(index, { voucherCode: event.target.value.toUpperCase(), balanceCents: null })} onBlur={() => void checkVoucher(index)} /></label>}
        {payment.balanceCents !== null && <small>{t("balance", { amount: money(payment.balanceCents) })}</small>}
        <button type="button" aria-label={t("remove")} onClick={() => setPayments((current) => current.filter((_, at) => at !== index))}>✕</button>
      </li>)}</ul>
      {change > 0 && <p className="pos-change">{t("change", { amount: money(change) })}</p>}
      {totalCents > 0 && remaining !== 0 && <p className="pos-remaining">{remaining > 0 ? t("remaining", { amount: money(remaining) }) : t("over", { amount: money(-remaining) })}</p>}
      <button type="button" className="pos-primary pos-issue" disabled={!canIssue} onClick={() => void issue()}>{t("issue")}</button>
    </div>
  </section>;
}

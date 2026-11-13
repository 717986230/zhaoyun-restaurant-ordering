import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiBill, ApiSepaPayment, PaymentType } from "@zhaoyun/contracts";
import { epcQrPayload } from "../../../shared/giro.mjs";
import { api, useLiveReload } from "./App";
import type { Pos, Screen } from "./App";
import { TierChip } from "./TierChip";

const HOLD_MS = 30_000;
const PAY_KEYS: Record<PaymentType, "cash" | "card" | "voucher" | "balance"> = { cash: "cash", card: "card", voucher: "voucher", balance: "balance" };
interface Payment { type: PaymentType; amount: string; tendered: string; voucherCode: string; balanceCents: number | null; tip: string; memberLogin: string; memberId: string; memberName: string; memberTierLevel: number }

const toCents = (text: string) => Math.round(Number(String(text).replace(",", ".")) * 100) || 0;
const toAmount = (cents: number) => (cents / 100).toFixed(2);

/**
 * "Zusammen oder getrennt?" — the question every table in Austria is asked.
 * Together: one receipt for everything. Separately: each guest's own lines,
 * one receipt each, until the table is paid. Cash (with the change worked
 * out), card or voucher, in any mix that adds up; a takeaway gets its pickup
 * discount. Cash and card take a tip beside the amount ("mach 50"): the
 * staff's, not in the total.
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
  const [sepa, setSepa] = useState<ApiSepaPayment | null>(null);
  const [showSepa, setShowSepa] = useState(false);
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
    // The floor also carries the shop's SEPA account, for the pay-by-transfer QR.
    api.floor().then((floor) => {
      if (takeaway) setDiscount(floor.takeawayDiscountPercent);
      setSepa(floor.sepaPayment ?? null);
    }).catch(() => undefined);
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
  // The cash handed over pays the amount and the tip; what is left is the change.
  const change = cash ? toCents(cash.tendered) - toCents(cash.amount) - toCents(cash.tip) : 0;
  const tipCents = payments.reduce((sum, payment) => sum + (payment.type === "voucher" || payment.type === "balance" ? 0 : toCents(payment.tip)), 0);
  // A reward bought with points is a receipt of nothing to pay: no payment on it.
  const picked = Object.values(picks).some((count) => count > 0);
  // A balance payment needs a member found, and may not draw more than their stored value.
  const memberOk = payments.every((payment) => payment.type !== "balance" || (payment.memberId && payment.balanceCents !== null && toCents(payment.amount) <= payment.balanceCents));
  const canIssue = picked && totalCents >= 0 && remaining === 0 && change >= 0 && memberOk && !busy;

  const setMode = (next: boolean) => {
    setSeparate(next);
    setPayments([]);
    setPicks(next ? {} : Object.fromEntries(lines.map((item) => [item.orderItemId, item.qty])));
  };
  const pick = (id: string, quantity: number, max: number) => setPicks((current) => ({ ...current, [id]: Math.max(0, Math.min(max, quantity)) }));
  const addPayment = (type: PaymentType) => setPayments((current) => [...current, { type, amount: toAmount(Math.max(0, totalCents - current.reduce((sum, payment) => sum + toCents(payment.amount), 0))), tendered: "", voucherCode: "", balanceCents: null, tip: "", memberLogin: "", memberId: "", memberName: "", memberTierLevel: 0 }]);
  const edit = (index: number, change: Partial<Payment>) => setPayments((current) => current.map((payment, at) => (at === index ? { ...payment, ...change } : payment)));
  /** Aufrunden: the tip that brings amount and tip to the next whole euro — again for the one after. */
  const roundUp = (index: number) => {
    const payment = payments[index];
    if (!payment) return;
    const amount = toCents(payment.amount);
    const paid = amount + toCents(payment.tip);
    edit(index, { tip: toAmount((Math.floor(paid / 100) + 1) * 100 - amount) });
  };

  async function checkVoucher(index: number) {
    const code = payments[index]?.voucherCode;
    if (!code) return;
    try {
      const { voucher } = await api.voucher(code);
      edit(index, { voucherCode: voucher.code, balanceCents: voucher.voided ? 0 : voucher.balanceCents });
    } catch (error) { pos.failed(error); }
  }

  // A member paying from their stored value (会员储值): looked up at the till by
  // their mobile number or email, their balance read, and the bill drawn from it.
  async function checkMember(index: number) {
    const login = payments[index]?.memberLogin?.trim();
    if (!login) return;
    try {
      const { member } = await api.member(login);
      edit(index, { memberId: member.id, memberName: member.name || member.phone || member.email, balanceCents: member.balanceCents ?? 0, memberTierLevel: member.membership?.tierLevel ?? 0 });
      // 会员价: a member's level earns a discount — offer it, but never below a
      // bigger one already set (a takeaway's, or one the waiter keyed in).
      const memberDiscount = member.membership?.discountPercent ?? 0;
      if (memberDiscount > 0) setDiscount((current) => Math.max(current, memberDiscount));
    } catch (error) {
      edit(index, { memberId: "", memberName: "", balanceCents: null, memberTierLevel: 0 });
      pos.failed(error);
    }
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
          ...(payment.type === "voucher" ? { voucherCode: payment.voucherCode } : {}),
          ...(payment.type === "balance" ? { memberId: payment.memberId } : {}),
          ...(payment.type !== "voucher" && payment.type !== "balance" && toCents(payment.tip) > 0 ? { tip: toCents(payment.tip) / 100 } : {})
        }))
      });
      const given = receipt.payments.find((payment) => payment.changeCents);
      const tipped = receipt.payments.reduce((sum, payment) => sum + (payment.tipCents ?? 0), 0);
      pos.notify(t("issued", { no: receipt.receiptNo, change: (given?.changeCents ? t("issuedChange", { amount: money(given.changeCents) }) : "") + (tipped ? t("issuedTip", { amount: money(tipped) }) : "") }));
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
      <div className="pos-pay-types">{(["cash", "card", "voucher", "balance"] as PaymentType[]).map((type) => <button key={type} type="button" disabled={!totalCents} onClick={() => addPayment(type)}>+ {t(PAY_KEYS[type])}</button>)}</div>
      {sepa?.enabled && sepa.iban && totalCents > 0 && <button type="button" className="pos-sepa-btn" onClick={() => setShowSepa(true)}>⃔ {t("sepaScan")}</button>}
      <ul className="pos-payments">{payments.map((payment, index) => <li key={index}>
        <b>{t(PAY_KEYS[payment.type])}</b>
        <label><span>{t("amount")}</span><input inputMode="decimal" value={payment.amount} onChange={(event) => edit(index, { amount: event.target.value })} /></label>
        {payment.type === "cash" && <label><span>{t("tendered")}</span><input inputMode="decimal" placeholder={toAmount(toCents(payment.amount) + toCents(payment.tip))} value={payment.tendered} onChange={(event) => edit(index, { tendered: event.target.value })} /></label>}
        {payment.type !== "voucher" && payment.type !== "balance" && <label className="pos-tip"><span>{t("tip")}</span><input inputMode="decimal" placeholder="0.00" value={payment.tip} onChange={(event) => edit(index, { tip: event.target.value })} /><button type="button" data-action="round-up" onClick={() => roundUp(index)}>{t("roundUp")}</button></label>}
        {payment.type === "voucher" && <label><span>{t("voucherCode")}</span><input value={payment.voucherCode} autoCapitalize="characters" onChange={(event) => edit(index, { voucherCode: event.target.value.toUpperCase(), balanceCents: null })} onBlur={() => void checkVoucher(index)} /></label>}
        {payment.type === "balance" && <label><span>{t("memberLogin")}</span><input value={payment.memberLogin} inputMode="email" autoCapitalize="none" spellCheck={false} placeholder={t("memberLoginHint")} onChange={(event) => edit(index, { memberLogin: event.target.value, memberId: "", memberName: "", balanceCents: null, memberTierLevel: 0 })} onBlur={() => void checkMember(index)} /></label>}
        {payment.type === "balance" && payment.memberName && <small>{payment.memberTierLevel > 0 && <TierChip level={payment.memberTierLevel} t={t} />} {payment.memberName}</small>}
        {payment.balanceCents !== null && <small>{t("balance", { amount: money(payment.balanceCents) })}</small>}
        {payment.type === "balance" && payment.balanceCents !== null && toCents(payment.amount) > payment.balanceCents && <small className="pos-error">{t("balanceShort")}</small>}
        <button type="button" aria-label={t("remove")} onClick={() => setPayments((current) => current.filter((_, at) => at !== index))}>✕</button>
      </li>)}</ul>
      {tipCents > 0 && <p className="pos-tip-total">{t("tipLine", { amount: money(tipCents), total: money(totalCents + tipCents) })}</p>}
      {change > 0 && <p className="pos-change">{t("change", { amount: money(change) })}</p>}
      {picked && totalCents === 0 && <p className="pos-remaining">{t("payNothing")}</p>}
      {totalCents > 0 && remaining !== 0 && <p className="pos-remaining">{remaining > 0 ? t("remaining", { amount: money(remaining) }) : t("over", { amount: money(-remaining) })}</p>}
      <button type="button" className="pos-primary pos-issue" disabled={!canIssue} onClick={() => void issue()}>{t("issue")}</button>
    </div>

    {showSepa && sepa && <SepaDialog sepa={sepa} amountCents={totalCents} reference={table} money={money} t={t} onClose={() => setShowSepa(false)} />}
  </section>;
}

/**
 * The GiroCode for the amount due: the guest scans it with their bank app and
 * a SEPA transfer opens already filled in. The QR is drawn from the EPC
 * payload (shared/giro.mjs); if the account or amount cannot make a valid code,
 * the dialog says so rather than show something unscannable.
 */
function SepaDialog({ sepa, amountCents, reference, money, t, onClose }: {
  sepa: ApiSepaPayment; amountCents: number; reference: string;
  money: (cents: number) => string; t: Pos["t"]; onClose: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    try {
      const payload = epcQrPayload({ beneficiary: sepa.beneficiary, iban: sepa.iban, bic: sepa.bic, amountCents, reference });
      void import("qrcode").then(({ default: QRCode }) => QRCode.toDataURL(payload, { width: 320, margin: 1 }))
        .then((url: string) => { if (live) setSrc(url); })
        .catch(() => { if (live) setError(true); });
    } catch {
      setError(true);
    }
    return () => { live = false; };
  }, [sepa.beneficiary, sepa.iban, sepa.bic, amountCents, reference]);

  return <div className="pos-sepa-overlay" role="dialog" aria-modal="true" aria-label={t("sepaTitle")} onClick={onClose}>
    <div className="pos-sepa-dialog" onClick={(event) => event.stopPropagation()}>
      <h2>{t("sepaTitle")}</h2>
      <p className="pos-sepa-amount">{money(amountCents)}</p>
      {error ? <p className="pos-sepa-error">{t("sepaError")}</p>
        : src ? <img className="pos-sepa-qr" src={src} alt={t("sepaTitle")} width={320} height={320} />
        : <p className="pos-muted">…</p>}
      <p className="pos-sepa-to">{sepa.beneficiary || "—"}<br /><code>{sepa.iban}</code></p>
      <p className="pos-muted">{t("sepaScanHint")}</p>
      <button type="button" className="pos-primary" onClick={onClose}>{t("close")}</button>
    </div>
  </div>;
}

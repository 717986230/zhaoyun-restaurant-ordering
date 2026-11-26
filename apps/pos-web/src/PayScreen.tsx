import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiBill, ApiSepaPayment, PaymentType } from "@zhaoyun/contracts";
import { epcQrPayload } from "../../../shared/giro.mjs";
import { api, useLiveReload } from "./App";
import type { Pos, Screen } from "./App";
import { BookingScanner } from "./BookingScanner";
import type { Scanned } from "./BookingScanner";
import { TierChip } from "./TierChip";

const HOLD_MS = 30_000;
const PAY_KEYS: Record<PaymentType, "cash" | "card" | "voucher" | "balance"> = { cash: "cash", card: "card", voucher: "voucher", balance: "balance" };
interface Payment { type: PaymentType; amount: string; tendered: string; voucherCode: string; balanceCents: number | null; tip: string; memberLogin: string; memberId: string; memberName: string; memberTierLevel: number }

const toCents = (text: string) => Math.round(Number(String(text).replace(",", ".")) * 100) || 0;
const toAmount = (cents: number) => (cents / 100).toFixed(2);

/**
 * AA 均分: split a total into n equal shares to the cent. The base is the floor
 * of total/n; the odd cents go one each to the first shares, so the shares add
 * back to the total exactly, none differing from another by more than a cent.
 */
export function splitCents(totalCents: number, n: number): number[] {
  const count = Math.max(1, Math.floor(n));
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

/**
 * AA 均分的口径: ONE receipt, N payments — not N receipts. `splitEvenly`
 * below turns one bill into one checkout whose `payments` list has N shares
 * (each switchable to card); the receipt is still issued once, for the whole
 * table. These are the N payment amounts, as euros, in share order.
 */
export function splitPaymentAmounts(totalCents: number, n: number): string[] {
  return splitCents(totalCents, n).map((share) => toAmount(share));
}

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
  // 单品折扣: orderItemId → percent off that one line, and why (one reason per receipt).
  const [itemDiscount, setItemDiscount] = useState<Record<string, number>>({});
  // 赠菜: the lines comped (free); the same reason covers them and the discounts.
  const [comped, setComped] = useState<Record<string, boolean>>({});
  // 单品改价: orderItemId → the new unit price as typed (euros), for this bill.
  const [override, setOverride] = useState<Record<string, string>>({});
  const [discountReason, setDiscountReason] = useState("");
  // 营销活动: the promotion live right now, if any — its percent is offered as the whole-bill discount.
  const [promo, setPromo] = useState<{ name: { zh: string; de: string; en: string }; percent: number } | null>(null);
  // 满减: a fixed cut in cents off the whole bill, and the live 满减 promotion that
  // offers it once the dishes reach its threshold. `amountTouched` stops the
  // promotion from overriding a figure the waiter keyed in by hand.
  const [amountDiscount, setAmountDiscount] = useState(0);
  const [amountPromo, setAmountPromo] = useState<{ name: { zh: string; de: string; en: string }; amountCents: number; minSpendCents: number } | null>(null);
  const amountTouched = useRef(false);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [busy, setBusy] = useState(false);
  const [sepa, setSepa] = useState<ApiSepaPayment | null>(null);
  const [showSepa, setShowSepa] = useState(false);
  const [scanningMember, setScanningMember] = useState(false);
  const [showDiscounts, setShowDiscounts] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  // AA 均分: how many people share this bill equally.
  const [splitN, setSplitN] = useState(2);
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

  const loadMeta = useCallback(() => {
    // The floor also carries the shop's SEPA account, for the pay-by-transfer QR.
    api.floor().then((floor) => {
      if (takeaway) setDiscount((current) => Math.max(current, floor.takeawayDiscountPercent));
      setSepa(floor.sepaPayment ?? null);
    }).catch(() => undefined);
    // Offer the best live promotion as the whole-bill discount, never below a
    // bigger one already set (a takeaway's, or one the waiter keyed in).
    api.activePromotion().then(({ promotion, amountPromotion }) => {
      setPromo(promotion ? { name: promotion.name, percent: promotion.percent } : null);
      if (promotion) setDiscount((current) => Math.max(current, promotion.percent));
      // 满减 is applied once the running bill reaches its threshold (effect below).
      setAmountPromo(amountPromotion ? { name: amountPromotion.name, amountCents: amountPromotion.amountCents, minSpendCents: amountPromotion.minSpendCents } : null);
    }).catch(() => undefined);
  }, [takeaway]);

  useEffect(() => {
    void load("all");
    loadMeta();
    void api.claim(table).catch(pos.failed);
    const hold = window.setInterval(() => { api.claim(table).catch(pos.failed); }, HOLD_MS);
    const releaseNow = () => { void api.release(table).catch(() => undefined); };
    window.addEventListener("pagehide", releaseNow);
    return () => { window.clearInterval(hold); window.removeEventListener("pagehide", releaseNow); releaseNow(); };
  }, [table, load, loadMeta, pos.failed]);

  useLiveReload(pos, (event) => event.type === "floor.changed" && (!event.table || event.table === table), () => void load(separate ? "keep" : "all"));
  useLiveReload(pos, (event) => event.type === "catalog.changed", () => void loadMeta());

  const lines = bill?.items ?? [];
  // 单品改价: what one line's price is, read from the (euro) text the waiter
  // typed. Only a single-rate dish may be repriced (a set menu's mixed rates
  // are not the dish's to re-split). `bad` is a non-empty but unusable entry.
  const priceInfo = (item: ApiBill["items"][number]) => {
    const menuUnit = Math.round(item.unitPrice * 100);
    const singleRate = !(item.vatSplit && item.vatSplit.length > 1);
    const raw = override[item.orderItemId] ?? "";
    const has = raw.trim() !== "";
    const cents = has ? Math.round(Number(raw) * 100) : NaN;
    const valid = has && Number.isFinite(cents) && cents >= 0 && cents <= 100000;
    const overridden = singleRate && valid && cents !== menuUnit;
    return { menuUnit, singleRate, raw, has, cents, overridden, bad: singleRate && has && !valid, effUnit: overridden ? cents : menuUnit };
  };
  // Net per VAT rate, after each line's own 单品改价 (new price) and 单品折扣 —
  // that net is the base the whole-bill discount then comes off, exactly as the
  // server works it out (shared/register.mjs): the dish's own price and discount
  // first, the whole-bill discount on the rest.
  const byRate = new Map<number, number>();
  let itemsCents = 0;
  let itemOffCents = 0;
  for (const item of lines) {
    const count = picks[item.orderItemId] ?? 0;
    if (!count) continue;
    const price = priceInfo(item);
    const gross = price.effUnit * count;
    itemsCents += gross;
    // An overridden single-rate line prices at its new unit; else its menu split.
    const parts = price.overridden
      ? [{ percent: item.vatPercent, cents: gross }]
      : (item.vatSplit?.length ? item.vatSplit.map((part) => ({ percent: part.percent, cents: Math.round((part.amount * 100 * count) / item.qty) })) : [{ percent: item.vatPercent, cents: gross }]);
    // 赠菜 takes the whole line off (like 100% off); otherwise its own discount.
    const isComp = comped[item.orderItemId] === true;
    const pct = isComp ? 100 : (itemDiscount[item.orderItemId] ?? 0);
    for (const part of parts) {
      const off = isComp ? part.cents : (pct > 0 ? Math.round((part.cents * pct) / 100) : 0);
      itemOffCents += off;
      byRate.set(part.percent, (byRate.get(part.percent) ?? 0) + part.cents - off);
    }
  }
  const offFor = (pct: number) => [...byRate.values()].reduce((sum, cents) => sum + Math.round((cents * pct) / 100), 0);
  const totalFor = (pct: number) => {
    const net = itemsCents - itemOffCents - offFor(pct);
    return net - Math.min(Math.max(0, amountDiscount), Math.max(0, net));
  };
  const offCents = offFor(discount);
  // The dishes net of per-item and whole-bill percentage discounts: the base the
  // 满减 fixed cut then comes off, capped so the bill never goes below zero —
  // exactly as the server works it out (shared/register.mjs).
  const netCents = itemsCents - itemOffCents - offCents;
  const amountOffCents = Math.min(Math.max(0, amountDiscount), Math.max(0, netCents));
  const totalCents = netCents - amountOffCents;
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
  // 单品折扣/赠菜/单品改价 on a picked line needs a reason before issuing.
  const reduced = lines.some((item) => (picks[item.orderItemId] ?? 0) > 0 && ((itemDiscount[item.orderItemId] ?? 0) > 0 || comped[item.orderItemId] === true || priceInfo(item).overridden));
  // A price box with something unusable in it blocks the receipt.
  const badPrice = lines.some((item) => (picks[item.orderItemId] ?? 0) > 0 && priceInfo(item).bad);
  const canIssue = picked && totalCents >= 0 && remaining === 0 && change >= 0 && memberOk && (!reduced || discountReason.trim().length > 0) && !badPrice && !busy;

  // 满减: apply the live promotion's cut once the dishes reach its threshold,
  // and lift it again if a later change drops the bill back below — unless the
  // waiter has keyed a figure in by hand (then it is theirs to manage).
  useEffect(() => {
    if (!amountPromo || amountTouched.current) return;
    setAmountDiscount(netCents >= amountPromo.minSpendCents ? amountPromo.amountCents : 0);
  }, [amountPromo, netCents]);

  const setMode = (next: boolean) => {
    setSeparate(next);
    setPayments([]);
    setItemDiscount({});
    setComped({});
    setOverride({});
    setDiscountReason("");
    setPicks(next ? {} : Object.fromEntries(lines.map((item) => [item.orderItemId, item.qty])));
  };
  const pick = (id: string, quantity: number, max: number) => setPicks((current) => ({ ...current, [id]: Math.max(0, Math.min(max, quantity)) }));
  // 单品折扣: set (or clear, at 0) a line's own discount percent.
  const setItemPct = (id: string, pct: number) => setItemDiscount((current) => {
    const value = Math.max(0, Math.min(100, Math.round(pct || 0)));
    if (!value) { const { [id]: _drop, ...rest } = current; return rest; }
    return { ...current, [id]: value };
  });
  // 赠菜: toggle a line free. A comp replaces any discount on the same line.
  const toggleComp = (id: string) => {
    setComped((current) => {
      if (current[id]) { const { [id]: _drop, ...rest } = current; return rest; }
      return { ...current, [id]: true };
    });
    setItemDiscount((current) => { const { [id]: _drop, ...rest } = current; return rest; });
  };
  // 单品改价: set (or clear, when emptied) a line's new unit price as typed.
  const setPrice = (id: string, text: string) => setOverride((current) => {
    if (text.trim() === "") { const { [id]: _drop, ...rest } = current; return rest; }
    return { ...current, [id]: text };
  });
  const addPayment = (type: PaymentType) => setPayments((current) => [...current, { type, amount: toAmount(Math.max(0, totalCents - current.reduce((sum, payment) => sum + toCents(payment.amount), 0))), tendered: "", voucherCode: "", balanceCents: null, tip: "", memberLogin: "", memberId: "", memberName: "", memberTierLevel: 0 }]);
  // AA 均分: split the amount due into n equal cash shares on this one receipt.
  // Each person pays their share (the waiter may switch a share to card); the
  // odd cents go one each to the first shares, so they add back to the total.
  const splitEvenly = (n: number) => {
    const count = Math.max(2, Math.min(20, Math.round(n || 0)));
    if (totalCents <= 0) return;
    setPayments(splitPaymentAmounts(totalCents, count).map((amount) => ({ type: "cash" as PaymentType, amount, tendered: "", voucherCode: "", balanceCents: null, tip: "", memberLogin: "", memberId: "", memberName: "", memberTierLevel: 0 })));
  };
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

  async function attachMemberByLogin(login: string) {
    try {
      const { member } = await api.member(login);
      const memberLogin = member.phone || member.email || login;
      const memberName = member.name || memberLogin;
      const memberDiscount = member.membership?.discountPercent ?? 0;
      const adjustedTotal = totalFor(Math.max(discount, memberDiscount));
      if (memberDiscount > 0) setDiscount((current) => Math.max(current, memberDiscount));
      const balanceCents = member.balanceCents ?? 0;
      if (balanceCents > 0) {
        const covered = payments.reduce((sum, entry) => sum + toCents(entry.amount), 0);
        const due = Math.max(0, adjustedTotal - covered);
        const take = Math.min(due || adjustedTotal, balanceCents);
        setPayments((current) => [...current, {
          type: "balance",
          amount: toAmount(take),
          tendered: "",
          voucherCode: "",
          balanceCents,
          tip: "",
          memberLogin,
          memberId: member.id,
          memberName,
          memberTierLevel: member.membership?.tierLevel ?? 0
        }]);
      }
      pos.notify(`${memberName} · ${t("balance", { amount: money(balanceCents) })}`);
    } catch (error) { pos.failed(error); }
  }

  async function scanMemberCode(code: Scanned) {
    setScanningMember(false);
    if (code.kind !== "member") {
      pos.notify(t("memberUnknown"), "error");
      return;
    }
    try {
      const visit = await api.memberVisit(code.id);
      await attachMemberByLogin(visit.customer.phone || visit.customer.email);
    } catch (error) { pos.failed(error); }
  }

  async function issue() {
    setBusy(true);
    try {
      const { receipt } = await api.checkout({
        clientRequestId: requestId.current,
        table,
        items: lines.filter((item) => (picks[item.orderItemId] ?? 0) > 0).map((item) => {
          const linePct = itemDiscount[item.orderItemId] ?? 0;
          const price = priceInfo(item);
          return {
            orderItemId: item.orderItemId,
            quantity: picks[item.orderItemId] ?? 0,
            ...(comped[item.orderItemId]
              ? { comp: true }
              : { ...(price.overridden ? { overridePriceCents: price.cents } : {}), ...(linePct > 0 ? { discountPercent: linePct } : {}) })
          };
        }),
        ...(discount ? { discountPercent: discount } : {}),
        ...(amountOffCents > 0 ? { discountCents: amountOffCents } : {}),
        ...(reduced ? { discountReason: discountReason.trim() } : {}),
        payments: payments.map((payment) => ({
          type: payment.type,
          amount: toCents(payment.amount) / 100,
          ...(payment.type === "cash" && payment.tendered ? { tendered: toCents(payment.tendered) / 100 } : {}),
          ...(payment.type === "voucher" ? { voucherCode: payment.voucherCode } : {}),
          ...(payment.type === "balance" ? { memberId: payment.memberId } : {}),
          ...(payment.type !== "voucher" && payment.type !== "balance" && toCents(payment.tip) > 0 ? { tip: toCents(payment.tip) / 100 } : {})
        }))
      });
      pos.onReceiptIssued({ id: receipt.id, no: String(receipt.receiptNo) });
      const given = receipt.payments.find((payment) => payment.changeCents);
      const tipped = receipt.payments.reduce((sum, payment) => sum + (payment.tipCents ?? 0), 0);
      pos.notify(t("issued", { no: receipt.receiptNo, change: (given?.changeCents ? t("issuedChange", { amount: money(given.changeCents) }) : "") + (tipped ? t("issuedTip", { amount: money(tipped) }) : "") }));
      requestId.current = crypto.randomUUID();
      setPayments([]);
      setItemDiscount({});
      setDiscountReason("");
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
        {pos.lastReceipt && <button type="button" onClick={() => { void api.reprintReceipt(pos.lastReceipt!.id).then(() => pos.notify(t("reprinted", { no: pos.lastReceipt!.no }))).catch(pos.failed); }}>🖨 {t("reprintLast", { no: pos.lastReceipt.no })}</button>}
      </div>
      <p className="pos-unsigned" role="note">{t("unsigned")}</p>
      <div className="pos-mode" role="group">
        <button type="button" className={separate ? "" : "on"} aria-pressed={!separate} onClick={() => setMode(false)}>{t("together")}</button>
        <button type="button" className={separate ? "on" : ""} aria-pressed={separate} onClick={() => setMode(true)}>{t("separate")}</button>
      </div>
      {separate && <p className="pos-muted">{t("separateHint")}</p>}
      <ul className="pos-lines pay">{lines.map((item) => {
        const count = picks[item.orderItemId] ?? 0;
        const isComp = comped[item.orderItemId] === true;
        const pct = itemDiscount[item.orderItemId] ?? 0;
        const price = priceInfo(item);
        const menuGross = price.menuUnit * count;
        const gross = price.effUnit * count;
        const net = isComp ? 0 : pct > 0 ? gross - Math.round((gross * pct) / 100) : gross;
        const changed = isComp || pct > 0 || price.overridden;
        return <li key={item.orderItemId} className={count ? "picked" : ""}>
          <span>{item.names?.[language] || item.name}{item.modifiers?.length ? <small>{item.modifiers.map((modifier) => modifier.name).join(" · ")}</small> : null}
            {count > 0 && (showDiscounts || isComp || pct > 0 || price.overridden) && <span className="pos-line-reduce">
              {!isComp && price.singleRate && <label className={price.bad ? "pos-line-price bad" : "pos-line-price"}><span>{t("newPrice")}</span><input inputMode="decimal" value={price.raw} placeholder={(price.menuUnit / 100).toFixed(2)} onChange={(event) => setPrice(item.orderItemId, event.target.value)} /></label>}
              {!isComp && <label className="pos-line-discount"><span>{t("itemDiscount")}</span><input type="number" min={0} max={100} step={1} inputMode="numeric" value={pct || ""} placeholder="0" onChange={(event) => setItemPct(item.orderItemId, Number(event.target.value))} />%</label>}
              <button type="button" className={isComp ? "pos-comp on" : "pos-comp"} aria-pressed={isComp} onClick={() => toggleComp(item.orderItemId)}>{t("comp")}</button>
            </span>}
          </span>
          {separate ? <span className="pos-stepper">
            <button type="button" aria-label="−" disabled={!count} onClick={() => pick(item.orderItemId, count - 1, item.qty)}>−</button>
            <b>{count}/{item.qty}</b>
            <button type="button" aria-label="+" disabled={count >= item.qty} onClick={() => pick(item.orderItemId, count + 1, item.qty)}>+</button>
          </span> : <span>{item.qty} ×</span>}
          <b>{changed ? <><s className="pos-line-was">{money(menuGross)}</s> {money(net)}</> : money(gross)}</b>
        </li>;
      })}</ul>
    </div>

    <div className="pos-pay-panel">
      {promo && <div className="pos-promo">{t("posPromoActive", { name: promo.name[language] || promo.name.zh || promo.name.en || promo.name.de, percent: String(promo.percent) })}</div>}
      {amountPromo && <div className="pos-promo">{t("posAmountPromoActive", { name: amountPromo.name[language] || amountPromo.name.zh || amountPromo.name.en || amountPromo.name.de, cut: money(amountPromo.amountCents), min: money(amountPromo.minSpendCents) })}</div>}
      <div className="pos-total"><span>{t("total")}</span><b>{money(totalCents)}</b></div>
      {totalCents > 0 && remaining > 0 && <div className="pos-quick-pay">
        <button type="button" className="pos-primary" onClick={() => setPayments((current) => [...current, { type: "card", amount: toAmount(remaining), tendered: "", voucherCode: "", balanceCents: null, tip: "", memberLogin: "", memberId: "", memberName: "", memberTierLevel: 0 }])}>{t("quickCard")}</button>
        <button type="button" onClick={() => setPayments((current) => [...current, { type: "cash", amount: toAmount(remaining), tendered: "", voucherCode: "", balanceCents: null, tip: "", memberLogin: "", memberId: "", memberName: "", memberTierLevel: 0 }])}>{t("quickCash")}</button>
      </div>}
      <div className="pos-pay-types">{(["cash", "card", "voucher", "balance"] as PaymentType[]).map((type) => <button key={type} type="button" disabled={!totalCents} onClick={() => addPayment(type)}>+ {t(PAY_KEYS[type])}</button>)}</div>
      <div className="pos-pay-extras">
        <button type="button" className={showDiscounts ? "on" : ""} aria-pressed={showDiscounts} onClick={() => setShowDiscounts((on) => !on)}>{language === "zh" ? "优惠 / 改价" : language === "de" ? "Rabatt / Preis" : "Discount"}</button>
        <button type="button" className={showSplit ? "on" : ""} aria-pressed={showSplit} onClick={() => setShowSplit((on) => !on)}>{t("splitEvenly")}</button>
        <button type="button" onClick={() => setScanningMember(true)}>📷 {t("scanMember")}</button>
        {sepa?.enabled && sepa.iban && totalCents > 0 && <button type="button" onClick={() => setShowSepa(true)}>⃔ {t("sepaScan")}</button>}
      </div>
      {(showDiscounts || Boolean(promo) || Boolean(amountPromo) || discount > 0 || amountDiscount > 0 || reduced) && <>
        <label className="pos-discount"><span>{t("discount")}</span><input type="number" min={0} max={100} step={1} inputMode="numeric" value={discount} onChange={(event) => setDiscount(Math.max(0, Math.min(100, Math.round(Number(event.target.value) || 0))))} /></label>
        <label className="pos-discount"><span>{t("amountDiscount")}</span><input type="number" min={0} max={1000} step="0.01" inputMode="decimal" value={amountDiscount ? (amountDiscount / 100).toFixed(2) : ""} placeholder="0" onChange={(event) => { amountTouched.current = true; const cents = Math.round((Number(event.target.value) || 0) * 100); setAmountDiscount(Math.max(0, Math.min(100000, cents))); }} /></label>
        {reduced && <label className="pos-discount-reason"><span>{t("discountReason")}</span><input value={discountReason} maxLength={200} placeholder={t("discountReasonHint")} onChange={(event) => setDiscountReason(event.target.value)} /></label>}
      </>}
      {showSplit && <div className="pos-split">
        <span>{t("splitEvenly")}</span>
        <input type="number" min={2} max={20} step={1} inputMode="numeric" aria-label={t("splitPeople")} value={splitN} onChange={(event) => setSplitN(Math.max(2, Math.min(20, Math.round(Number(event.target.value) || 2))))} />
        <span>{t("splitPeople")}</span>
        <button type="button" disabled={!totalCents} onClick={() => splitEvenly(splitN)}>{t("splitDo", { n: splitN })}</button>
      </div>}
      <ul className="pos-payments">{payments.map((payment, index) => <li key={index}>
        <b>{t(PAY_KEYS[payment.type])}</b>
        <label><span>{t("amount")}</span><input inputMode="decimal" value={payment.amount} onChange={(event) => edit(index, { amount: event.target.value })} /></label>
        {payment.type === "cash" && <label><span>{t("tendered")}</span><input inputMode="decimal" placeholder={toAmount(toCents(payment.amount) + toCents(payment.tip))} value={payment.tendered} onChange={(event) => edit(index, { tendered: event.target.value })} />
          <span className="pos-cash-presets">{[10, 20, 50, 100].map((bill) => <button key={bill} type="button" onClick={() => edit(index, { tendered: bill.toFixed(2) })}>€{bill}</button>)}</span>
        </label>}
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
    {scanningMember && <BookingScanner pos={pos} bookings={[]} mode="member" onFound={(code) => void scanMemberCode(code)} onMemberLogin={(login) => { setScanningMember(false); void attachMemberByLogin(login); }} onClose={() => setScanningMember(false)} />}
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

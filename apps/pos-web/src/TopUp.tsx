import { useRef, useState } from "react";
import type { ApiCustomer } from "@zhaoyun/contracts";
import { api } from "./App";
import type { Pos, Screen } from "./App";

const toCents = (text: string) => Math.round(Number(String(text).replace(",", ".")) * 100) || 0;

/**
 * 会员储值充值: a member puts money on their account at the counter. The staff
 * finds them by mobile number or email, takes cash or a card, and the balance
 * goes up by the amount plus whatever bonus the tiers give. The principal is a
 * multi-purpose voucher (0% USt at sale, taxed when it is spent on food); the
 * bonus is the house's gift — booked to the ledger, never taxed.
 */
export function TopUp({ pos, go }: { pos: Pos; go: (screen: Screen) => void }) {
  const { t, money } = pos;
  const [login, setLogin] = useState("");
  const [member, setMember] = useState<ApiCustomer | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "card">("cash");
  const [busy, setBusy] = useState(false);
  const requestId = useRef(crypto.randomUUID());

  async function find() {
    const value = login.trim();
    if (!value) return;
    try {
      const { member: found } = await api.member(value);
      setMember(found);
    } catch (error) { setMember(null); pos.failed(error); }
  }

  async function confirm() {
    if (!member) return;
    const cents = toCents(amount);
    if (cents <= 0) return;
    setBusy(true);
    try {
      const { receipt, member: updated } = await api.topUp({
        clientRequestId: requestId.current,
        memberId: member.id,
        amount: cents / 100,
        payments: [{ type: method, amount: cents / 100 }]
      });
      const bonus = receipt.lines.find((line) => line.kind === "topup")?.bonusCents ?? 0;
      pos.notify(t("toppedUp", { name: updated.name, balance: money(updated.balanceCents ?? 0) }) + (bonus ? t("topUpBonus", { amount: money(bonus) }) : ""));
      requestId.current = crypto.randomUUID();
      setMember(updated);
      setAmount("");
    } catch (error) {
      pos.failed(error);
    } finally {
      setBusy(false);
    }
  }

  const canConfirm = Boolean(member) && toCents(amount) > 0 && !busy;

  return <section className="pos-card pos-topup">
    <div className="pos-ticket-head">
      <button type="button" onClick={() => go({ name: "floor" })}>← {t("back")}</button>
      <h1>{t("topUpTitle")}</h1>
    </div>
    <p className="pos-muted">{t("topUpLead")}</p>
    <p className="pos-unsigned" role="note">{t("unsigned")}</p>

    <form className="pos-topup-find" onSubmit={(event) => { event.preventDefault(); void find(); }}>
      <label><span>{t("memberLogin")}</span><input value={login} inputMode="email" autoCapitalize="none" spellCheck={false} placeholder={t("memberLoginHint")} onChange={(event) => { setLogin(event.target.value); setMember(null); }} /></label>
      <button type="submit">{t("memberFind")}</button>
    </form>

    {member && <>
      <div className="pos-topup-member">
        <b>{member.name}</b>
        <span>{t("balance", { amount: money(member.balanceCents ?? 0) })}</span>
      </div>
      <label className="pos-topup-amount"><span>{t("topUpAmount")}</span><input inputMode="decimal" value={amount} placeholder="0.00" onChange={(event) => setAmount(event.target.value)} /></label>
      <div className="pos-pay-types" role="group">
        <button type="button" className={method === "cash" ? "on" : ""} aria-pressed={method === "cash"} onClick={() => setMethod("cash")}>{t("cash")}</button>
        <button type="button" className={method === "card" ? "on" : ""} aria-pressed={method === "card"} onClick={() => setMethod("card")}>{t("card")}</button>
      </div>
      <button type="button" className="pos-primary" disabled={!canConfirm} onClick={() => void confirm()}>{busy ? t("topUpBusy") : t("topUpConfirm")}</button>
    </>}
  </section>;
}

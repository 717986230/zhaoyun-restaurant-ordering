import { useState } from "react";
import { restaurantApi } from "../../app/api";
import { g } from "../../app/guest-i18n";
import type { GuestKey } from "../../app/guest-i18n";
import { t } from "../../app/i18n";
import type { CustomerDispatch, CustomerState } from "../../app/model";
import { Sheet } from "../../components/Sheet";

/** What a guest can ask for: the kinds the waiters' screens know (shared/orders.mjs). */
const CALLS: Array<[string, string, GuestKey]> = [
  ["waiter", "🙋", "callWaiter"],
  ["pay", "🧾", "callPay"],
  ["water", "💧", "callWater"],
  ["utensils", "🥢", "callUtensils"],
  ["napkin", "🧻", "callNapkin"],
  ["takeaway", "🥡", "callTakeaway"],
  ["clear", "🧹", "callClear"]
];

/**
 * Calling a waiter to the table the guest scanned. The call reaches every
 * waiter's POS and the console at once; asking twice for the same thing
 * before anyone came is one call, not two (the server says so).
 */
export function ServiceSheet({ state, dispatch, table }: { state: CustomerState; dispatch: CustomerDispatch; table: string }) {
  const language = state.language;
  const [busy, setBusy] = useState<string | null>(null);

  async function call(type: string) {
    setBusy(type);
    try {
      const { repeated } = await restaurantApi.createServiceRequest({ table, type });
      dispatch({ type: "toast", message: g(language, repeated ? "callRepeated" : "callSent") });
      dispatch({ type: "sheet", sheet: null });
    } catch {
      dispatch({ type: "toast", message: g(language, "callFailed") });
    } finally {
      setBusy(null);
    }
  }

  return <Sheet id="serviceSheet" title={g(language, "callTitle", { table })} closeLabel={t(language, "close")} onClose={() => dispatch({ type: "sheet", sheet: null })}>
    <div className="service-calls">{CALLS.map(([type, icon, label]) => <button key={type} type="button" data-call={type} className={`service-call ${type === "waiter" ? "primary" : ""}`} disabled={busy !== null} onClick={() => void call(type)}>
      <span aria-hidden="true">{icon}</span>{g(language, label)}
    </button>)}</div>
  </Sheet>;
}

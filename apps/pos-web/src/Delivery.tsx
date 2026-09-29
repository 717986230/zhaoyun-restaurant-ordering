import { useEffect, useRef, useState } from "react";
import type { DeliveryAction } from "@zhaoyun/api-client";
import type { ApiDeliveryOrder, DeliveryRejectReason } from "@zhaoyun/contracts";
import { api } from "./App";
import type { Pos } from "./App";
import type { PosKey } from "./i18n";

const PREP_CHOICES = [10, 15, 20, 30, 45, 60];
const REASONS: DeliveryRejectReason[] = ["TOO_BUSY", "ITEM_UNAVAILABLE", "CLOSED", "OUTSIDE_DELIVERY_AREA", "OTHER"];
const STATE_KEYS: Record<string, PosKey> = { new: "deliveryStateNew", accepted: "deliveryStateAccepted", ready: "deliveryStateReady" };

/** Two short tones when an order arrives: the floor is busy, and nobody watches the screen. */
function chime() {
  try {
    const context = new AudioContext();
    for (const [index, frequency] of [880, 1320].entries()) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.value = 0.15;
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(context.currentTime + index * 0.22);
      oscillator.stop(context.currentTime + index * 0.22 + 0.18);
    }
    window.setTimeout(() => void context.close(), 800);
  } catch { /* No sound on this device: the card is there all the same. */ }
}

/**
 * The delivery platforms' orders the floor still has to do something about
 * (shared/delivery.mjs), on every POS at once: a new one to accept — for when
 * — or turn down, then ready, then handed to the rider or the guest. The
 * platform is told each time; when it could not be, the card says so and
 * sends it again on a tap.
 */
export function DeliveryOrders({ pos, orders, onDone }: { pos: Pos; orders: ApiDeliveryOrder[]; onDone: () => void }) {
  const { t, money } = pos;
  const [prep, setPrep] = useState<Record<string, number>>({});
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const seen = useRef<Set<string> | null>(null);

  const fresh = orders.filter((order) => order.status === "new").map((order) => order.id);
  useEffect(() => {
    // The first list is what was already waiting; only what comes after is news.
    if (seen.current && fresh.some((id) => !seen.current!.has(id))) chime();
    seen.current = new Set(fresh);
  }, [fresh.join(",")]);

  if (!orders.length) return null;

  async function act(order: ApiDeliveryOrder, action: DeliveryAction, options: { prepMinutes?: number; reason?: DeliveryRejectReason } = {}) {
    setBusy(order.id);
    try {
      const { order: updated } = await api.deliveryAction(order.id, action, options);
      if (updated.sync.status === "failed") pos.notify(t("deliverySyncFailed", { error: updated.sync.error ?? "" }), "error");
      setRejecting(null);
      onDone();
    } catch (error) { pos.failed(error); } finally { setBusy(null); }
  }

  const clock = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString(pos.language === "en" ? "en-GB" : pos.language === "de" ? "de-AT" : "zh-CN", { hour: "2-digit", minute: "2-digit" }) : "";
  return <section className="pos-delivery" aria-label={t("delivery", { count: orders.length })} role={fresh.length ? "alert" : undefined}>
    <h2>🛵 {t("delivery", { count: orders.length })}</h2>
    <ul>{orders.map((order) => {
      const minutes = prep[order.id] ?? order.prepMinutes ?? 20;
      return <li key={order.id} data-delivery={order.reference} data-status={order.status} data-provider={order.provider}>
        <header>
          <span className="pos-platform">{order.providerName}</span>
          <b>#{order.reference}</b>
          <span>{t(order.type === "pickup" ? "deliveryTypePickup" : "deliveryTypeDelivery")}{order.dueAt ? ` · ${t("deliveryDue", { time: clock(order.dueAt) })}` : ""}</span>
          <em>{t(STATE_KEYS[order.status] ?? "deliveryStateNew")}</em>
          {order.test && <em className="pos-test">{t("deliveryTest")}</em>}
        </header>
        <ol>{order.items.map((item, index) => <li key={index}>
          <span><b>{item.quantity} ×</b> {item.name}</span>
          {item.options.length > 0 && <small>{item.options.map((option) => option.quantity > 1 ? `${option.quantity}× ${option.name}` : option.name).join(" · ")}</small>}
          {item.note && <small>{item.note}</small>}
        </li>)}</ol>
        {order.notes && <p className="pos-delivery-note">{order.notes}</p>}
        {/* Out of a dish, or short of it today: known before saying yes. */}
        {order.shortages && order.shortages.length > 0 && <p className="pos-delivery-short" role="alert">
          ⚠ {order.shortages.map((short) => short.left ? t("deliveryShort", { name: short.name, left: short.left, wanted: short.wanted }) : t("deliveryOut", { name: short.name })).join(" · ")}
        </p>}
        <p className="pos-delivery-meta">
          {order.customerName && <span>{order.customerName}</span>}
          <span>{money(order.totalCents)} · {t(order.paidOnline ? "deliveryPaid" : "deliveryCash")}</span>
        </p>
        {order.sync.status === "failed" && <p className="pos-delivery-sync" role="status">
          {t("deliverySyncFailed", { error: order.sync.error ?? "" })}
          <button type="button" disabled={busy === order.id} onClick={() => void act(order, "resend")}>{t("deliveryResend")}</button>
        </p>}
        {order.status === "new" && rejecting !== order.id && <div className="pos-delivery-actions">
          <div className="pos-prep" role="group" aria-label={t("deliveryPrep")}>
            {PREP_CHOICES.map((choice) => <button key={choice} type="button" className={choice === minutes ? "on" : ""} aria-pressed={choice === minutes} onClick={() => setPrep({ ...prep, [order.id]: choice })}>{t("deliveryMinutes", { n: choice })}</button>)}
          </div>
          <button type="button" className="pos-primary" data-action="accept" disabled={busy === order.id} onClick={() => void act(order, "accept", { prepMinutes: minutes })}>{t("deliveryAccept", { n: minutes })}</button>
          <button type="button" className="pos-quiet" data-action="reject" onClick={() => setRejecting(order.id)}>{t("deliveryReject")}</button>
        </div>}
        {order.status === "new" && rejecting === order.id && <div className="pos-delivery-actions" role="group" aria-label={t("deliveryRejectWhy")}>
          <span>{t("deliveryRejectWhy")}</span>
          {REASONS.map((reason) => <button key={reason} type="button" data-reason={reason} disabled={busy === order.id} onClick={() => void act(order, "reject", { reason })}>{t(`reason${reason}` as PosKey)}</button>)}
          <button type="button" className="pos-quiet" onClick={() => setRejecting(null)}>✕</button>
        </div>}
        {order.status === "accepted" && <div className="pos-delivery-actions">
          <button type="button" className="pos-primary" data-action="ready" disabled={busy === order.id} onClick={() => void act(order, "ready")}>{t("deliveryReady")}</button>
        </div>}
        {order.status === "ready" && <div className="pos-delivery-actions">
          <button type="button" className="pos-primary" data-action="complete" disabled={busy === order.id} onClick={() => void act(order, "complete")}>{t("deliveryDone")}</button>
        </div>}
      </li>;
    })}</ul>
  </section>;
}

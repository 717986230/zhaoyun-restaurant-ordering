import { useState } from "react";
import type { CreateOrderCommand } from "@zhaoyun/contracts";
import { ApiError } from "@zhaoyun/api-client";
import { formatEuro, summarizeCart } from "@zhaoyun/domain";
import type { Order, Product } from "@zhaoyun/domain";
import { restaurantApi } from "../../app/api";
import type { CustomerDispatch, CustomerState } from "../../app/model";
import { productName, t } from "../../app/i18n";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";

export function CartScreen({ state, dispatch, products }: { state: CustomerState; dispatch: CustomerDispatch; products: Product[] }) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const entries = Object.values(state.cart).flatMap((line) => {
    const product = products.find((candidate) => candidate.id === line.productId);
    return product ? [{ product, quantity: line.quantity, modifiers: line.modifiers || [] }] : [];
  });
  const summary = summarizeCart(entries.map(({ product, quantity, modifiers }) => ({ productId: product.id, quantity, modifiers })), products);

  async function submitOrder() {
    if (!entries.length || submitting) return;
    setSubmitting(true);
    const clientRequestId = crypto.randomUUID();
    const baseOrder: Order = {
      id: clientRequestId,
      clientRequestId,
      no: String(Date.now()).slice(-6),
      table: state.table,
      status: "pending-sync",
      note,
        items: entries.map(({ product, quantity, modifiers }) => ({ productId: product.id, quantity, name: productName(product, state.language), modifiers })),
      totalCents: summary.totalCents,
      createdAt: new Date().toISOString()
    };
    const command: CreateOrderCommand = {
        clientRequestId,
        table: state.table,
        note,
        items: entries.map(({ product, quantity, modifiers }) => ({ id: product.id, qty: quantity, modifiers: modifiers.map((modifier) => ({ id: modifier.id })) }))
    };
    try {
      const { order } = await restaurantApi.createOrder(command);
      dispatch({ type: "order-created", order: {
        ...baseOrder,
        id: order.id,
        no: order.no,
        status: order.status,
        totalCents: Math.round(order.total * 100),
        createdAt: order.createdAt
      } });
      dispatch({ type: "toast", message: "订单已提交" });
    } catch (error) {
      const retryable = !(error instanceof ApiError) || error.status >= 500;
      if (retryable) {
        dispatch({ type: "order-queued", order: { ...baseOrder, status: "sync-failed" }, command });
        dispatch({ type: "toast", message: "服务器离线，订单已保存并等待自动重试" });
      } else {
        dispatch({ type: "order-created", order: { ...baseOrder, status: "sync-failed" } });
        dispatch({ type: "toast", message: "订单未被接受，请检查菜品或购物车" });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return <section id="cart" className="screen panel active">
    <header className="panel-head"><button className="icon-btn back" onClick={() => dispatch({ type: "navigate", screen: "menu" })}>‹</button><div><h2>{t(state.language, "cart")}</h2><small>WARENKORB</small></div><LanguageSwitcher language={state.language} dispatch={dispatch} /></header>
    <div id="cartContent" className="content">{entries.length ? <>
      {entries.map(({ product, quantity, modifiers }) => <div className="row" key={`${product.id}-${modifiers.map((modifier) => modifier.id).join(",")}`}><div><h3>{productName(product, state.language)}</h3><small>{product.names.de} × {quantity}</small>{modifiers.length > 0 && <small className="modifier-summary">{modifiers.map((modifier) => modifier.name).join(" · ")}</small>}</div><strong>{formatEuro((product.priceCents + modifiers.reduce((sum, modifier) => sum + modifier.priceCents, 0)) * quantity)}</strong></div>)}
      <label className="note-label">{t(state.language, "note")}<input id="orderNote" value={note} onChange={(event) => setNote(event.target.value)} placeholder={state.language === "zh" ? "例如：少盐、不要香菜" : state.language === "de" ? "z. B. wenig Salz" : "e.g. less salt"} /></label>
      <div className="total"><span>{t(state.language, "total")}</span><b>{formatEuro(summary.totalCents)}</b></div>
      <button id="submitOrder" className="primary" disabled={submitting} onClick={submitOrder}>{submitting ? "…" : t(state.language, "submit")}</button>
      <button id="clearCart" className="secondary" onClick={() => dispatch({ type: "clear-cart" })}>{state.language === "zh" ? "清空购物车" : state.language === "de" ? "Warenkorb leeren" : "Clear cart"}</button>
    </> : <div className="empty">{t(state.language, "emptyCart")}<button className="secondary" onClick={() => dispatch({ type: "navigate", screen: "menu" })}>{t(state.language, "backMenu")}</button></div>}</div>
  </section>;
}

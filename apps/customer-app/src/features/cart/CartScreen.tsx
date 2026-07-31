import { useState } from "react";
import { formatEuro, summarizeCart } from "@zhaoyun/domain";
import type { Order, Product } from "@zhaoyun/domain";
import { restaurantApi } from "../../app/api";
import type { CustomerDispatch, CustomerState } from "../../app/model";

export function CartScreen({ state, dispatch, products }: { state: CustomerState; dispatch: CustomerDispatch; products: Product[] }) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const entries = Object.entries(state.cart).flatMap(([productId, quantity]) => {
    const product = products.find((candidate) => candidate.id === productId);
    return product ? [{ product, quantity }] : [];
  });
  const summary = summarizeCart(entries.map(({ product, quantity }) => ({ productId: product.id, quantity })), products);

  async function submitOrder() {
    if (!entries.length || submitting) return;
    setSubmitting(true);
    const clientRequestId = crypto.randomUUID();
    const baseOrder: Order = {
      id: clientRequestId,
      clientRequestId,
      no: String(Date.now()).slice(-6),
      table: "08",
      status: "pending-sync",
      note,
      items: entries.map(({ product, quantity }) => ({ productId: product.id, quantity, name: product.names.zh })),
      totalCents: summary.totalCents,
      createdAt: new Date().toISOString()
    };
    try {
      const { order } = await restaurantApi.createOrder({
        clientRequestId,
        table: "08",
        note,
        items: entries.map(({ product, quantity }) => ({ id: product.id, qty: quantity }))
      });
      dispatch({ type: "order-created", order: {
        ...baseOrder,
        id: order.id,
        no: order.no,
        status: order.status,
        totalCents: Math.round(order.total * 100),
        createdAt: order.createdAt
      } });
      dispatch({ type: "toast", message: "订单已提交" });
    } catch {
      dispatch({ type: "order-created", order: { ...baseOrder, status: "sync-failed" } });
      dispatch({ type: "toast", message: "服务器离线，订单等待重新同步" });
    } finally {
      setSubmitting(false);
    }
  }

  return <section id="cart" className="screen panel active">
    <header className="panel-head"><button className="icon-btn back" onClick={() => dispatch({ type: "navigate", screen: "menu" })}>‹</button><div><h2>购物车</h2><small>WARENKORB</small></div></header>
    <div id="cartContent" className="content">{entries.length ? <>
      {entries.map(({ product, quantity }) => <div className="row" key={product.id}><div><h3>{product.names.zh}</h3><small>{product.names.de} × {quantity}</small></div><strong>{formatEuro(product.priceCents * quantity)}</strong></div>)}
      <label className="note-label">订单备注<input id="orderNote" value={note} onChange={(event) => setNote(event.target.value)} placeholder="例如：少盐、不要香菜" /></label>
      <div className="total"><span>合计 · GESAMT</span><b>{formatEuro(summary.totalCents)}</b></div>
      <button id="submitOrder" className="primary" disabled={submitting} onClick={submitOrder}>{submitting ? "正在提交" : "确认下单"}</button>
      <button id="clearCart" className="secondary" onClick={() => dispatch({ type: "clear-cart" })}>清空购物车</button>
    </> : <div className="empty">购物车还是空的<button className="secondary" onClick={() => dispatch({ type: "navigate", screen: "menu" })}>返回菜单</button></div>}</div>
  </section>;
}

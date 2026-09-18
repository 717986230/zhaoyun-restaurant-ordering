import { formatEuro } from "@zhaoyun/domain";
import type { Order, Product } from "@zhaoyun/domain";
import type { CustomerDispatch } from "../../app/model";
import type { CustomerState } from "../../app/model";
import { orderStatusLabel, productName, t } from "../../app/i18n";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";

export function OrderCard({ order, products, language = "zh" }: { order: Order; products: Product[]; language?: CustomerState["language"] }) {
  return <article className="order">
    <div className="order-head"><h3>{t(language, "order")} {order.no}</h3><span>{orderStatusLabel(order.status, language)}</span></div>
    <small>{new Date(order.createdAt).toLocaleString("de-AT")} · {t(language, "table")} {order.table}</small>
    <p>{order.items.map((item) => { const product = products.find((candidate) => candidate.id === item.productId); return <span key={`${item.productId}-${item.quantity}-${(item.modifiers || []).map((modifier) => modifier.id).join(",")}`}>{item.quantity}x {product ? productName(product, language) : item.name || "Dish"}{item.modifiers?.length ? ` (${item.modifiers.map((modifier) => modifier.name).join(" · ")})` : ""}<br /></span>; })}</p>
    {order.note && <p className="note">{t(language, "note")}: {order.note}</p>}
    {(order.status === "pending-sync" || order.status === "sync-failed") && <p className="offline-note">{t(language, "orderUnconfirmed")}</p>}
    <div className="total"><span>{t(language, "total")}</span><b>{formatEuro(order.totalCents)}</b></div>
  </article>;
}

export function OrdersScreen({ orders, products, dispatch, language }: { orders: Order[]; products: Product[]; dispatch: CustomerDispatch; language: CustomerState["language"] }) {
  return <section id="orders" className="screen panel active"><header className="panel-head"><button className="icon-btn back" onClick={() => dispatch({ type: "navigate", screen: "home" })}>‹</button><div><h2>{t(language, "orders")}</h2><small>MEINE BESTELLUNG</small></div><LanguageSwitcher compact language={language} dispatch={dispatch} /></header><div id="ordersContent" className="content">{orders.length ? orders.map((order) => <OrderCard key={order.id} order={order} products={products} language={language} />) : <div className="empty">{t(language, "noOrders")}</div>}</div></section>;
}

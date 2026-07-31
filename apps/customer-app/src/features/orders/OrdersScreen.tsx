import { formatEuro } from "@zhaoyun/domain";
import type { Order, OrderStatus, Product } from "@zhaoyun/domain";
import type { CustomerDispatch } from "../../app/model";

const labels: Record<OrderStatus, string> = {
  "pending-sync": "等待同步",
  "sync-failed": "同步失败",
  new: "新订单",
  preparing: "制作中",
  ready: "可上菜",
  completed: "已完成",
  cancelled: "已取消"
};

export function OrderCard({ order, products }: { order: Order; products: Product[] }) {
  return <article className="order">
    <div className="order-head"><h3>订单 {order.no}</h3><span>{labels[order.status]}</span></div>
    <small>{new Date(order.createdAt).toLocaleString("de-AT")} · Tisch {order.table}</small>
    <p>{order.items.map((item) => <span key={`${item.productId}-${item.quantity}`}>{item.quantity}x {products.find((product) => product.id === item.productId)?.names.zh || item.name || "商品"}<br /></span>)}</p>
    {order.note && <p className="note">备注：{order.note}</p>}
    {(order.status === "pending-sync" || order.status === "sync-failed") && <p className="offline-note">订单尚未被餐厅服务器确认</p>}
    <div className="total"><span>合计</span><b>{formatEuro(order.totalCents)}</b></div>
  </article>;
}

export function OrdersScreen({ orders, products, dispatch }: { orders: Order[]; products: Product[]; dispatch: CustomerDispatch }) {
  return <section id="orders" className="screen panel active"><header className="panel-head"><button className="icon-btn back" onClick={() => dispatch({ type: "navigate", screen: "home" })}>‹</button><div><h2>订单状态</h2><small>MEINE BESTELLUNG</small></div></header><div id="ordersContent" className="content">{orders.length ? orders.map((order) => <OrderCard key={order.id} order={order} products={products} />) : <div className="empty">还没有已提交订单</div>}</div></section>;
}

export { labels as orderStatusLabels };

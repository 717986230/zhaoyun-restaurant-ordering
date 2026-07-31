import { nextOperationalStatus } from "@zhaoyun/domain";
import type { Product } from "@zhaoyun/domain";
import type { CustomerDispatch, CustomerState } from "../../app/model";
import { OrderCard, orderStatusLabels } from "../orders/OrdersScreen";

export function StaffScreen({ state, products, dispatch }: { state: CustomerState; products: Product[]; dispatch: CustomerDispatch }) {
  return <section id="staff" className="screen panel staff active"><header className="panel-head"><button className="icon-btn back" onClick={() => dispatch({ type: "navigate", screen: "home" })}>‹</button><div><h2>员工看板</h2><small>MITARBEITER</small></div></header><div id="staffContent" className="content">
    <h3 className="section-title">厨房订单</h3>
    {state.orders.length ? state.orders.map((order) => {
      const next = nextOperationalStatus(order.status);
      return <article className="order staff-order" key={order.id}><OrderCard order={order} products={products} />{next && <button className="primary" onClick={() => dispatch({ type: "advance-order", orderId: order.id, status: next })}>更新为：{orderStatusLabels[next]}</button>}</article>;
    }) : <div className="empty">暂无订单</div>}
    <h3 className="section-title">服务呼叫</h3>
    {state.requests.length ? state.requests.map((request) => <div className={`row request ${request.status === "completed" ? "done" : ""}`} key={request.id}><div><h3>{request.label}</h3><small>Tisch {request.table} · {new Date(request.createdAt).toLocaleTimeString("de-AT")}{request.pendingSync ? " · 待同步" : ""}</small></div><button className="secondary" disabled={request.status === "completed"} onClick={() => dispatch({ type: "service-done", requestId: request.id })}>已处理</button></div>) : <div className="empty compact">暂无服务请求</div>}
  </div></section>;
}

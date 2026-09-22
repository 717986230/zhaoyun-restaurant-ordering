import { nextOperationalStatus } from "@zhaoyun/domain";
import type { Product } from "@zhaoyun/domain";
import type { CustomerDispatch, CustomerState } from "../../app/model";
import { orderStatusLabel, serviceName, t } from "../../app/i18n";
import { OrderCard } from "../orders/OrdersScreen";

export function StaffScreen({ state, products, dispatch }: { state: CustomerState; products: Product[]; dispatch: CustomerDispatch }) {
  const language = state.language;
  return <section id="staff" className="screen panel staff active"><header className="panel-head"><button className="icon-btn back" onClick={() => dispatch({ type: "navigate", screen: "home" })}>‹</button><div><h2>{t(language, "staff")}</h2><small>MITARBEITER</small></div></header><div id="staffContent" className="content">
    <p className="local-board-note">{t(language, "staffLocalNote")}</p>
    <h3 className="section-title">{t(language, "staffLocalOrders")}</h3>
    {state.orders.length ? state.orders.map((order) => {
      const next = nextOperationalStatus(order.status);
      return <article className="order staff-order" key={order.id}><OrderCard order={order} products={products} language={language} />{next && <button className="primary" onClick={() => dispatch({ type: "advance-order", orderId: order.id, status: next })}>{t(language, "staffAdvanceTo")}：{orderStatusLabel(next, language)}</button>}</article>;
    }) : <div className="empty">{t(language, "staffNoOrders")}</div>}
    <h3 className="section-title">{t(language, "staffServiceCalls")}</h3>
    {state.requests.length ? state.requests.map((request) => <div className={`row request ${request.status === "completed" ? "done" : ""}`} key={request.id}><div><h3>{serviceName(request.serviceType, language)}</h3><small>{t(language, "table")} {request.table} · {new Date(request.createdAt).toLocaleTimeString("de-AT")}{request.pendingSync ? ` · ${t(language, "staffPending")}` : ""}</small></div><button className="secondary" disabled={request.status === "completed"} onClick={() => dispatch({ type: "service-done", requestId: request.id })}>{t(language, "staffHandled")}</button></div>) : <div className="empty compact">{t(language, "staffNoRequests")}</div>}
  </div></section>;
}

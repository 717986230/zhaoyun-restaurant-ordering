import { formatEuro, nextOperationalStatus } from "@zhaoyun/domain";
import type { OrderStatus } from "@zhaoyun/domain";
import type { ApiOrder, ApiServiceRequest } from "@zhaoyun/contracts";

interface Props {
  orders: ApiOrder[];
  requests: ApiServiceRequest[];
  busyId: string | null;
  onOrderStatus: (id: string, status: ApiOrder["status"]) => Promise<void>;
  onRequestStatus: (id: string, status: ApiServiceRequest["status"]) => Promise<void>;
  onRefresh: () => Promise<void>;
}

const orderLabels: Record<ApiOrder["status"], string> = {
  new: "新订单", preparing: "制作中", ready: "可上菜", completed: "已完成", cancelled: "已取消"
};
const requestLabels: Record<ApiServiceRequest["status"], string> = {
  open: "待处理", acknowledged: "已响应", completed: "已完成", cancelled: "已取消"
};
const serviceLabels: Record<string, string> = {
  water: "加水", utensils: "餐具", napkin: "纸巾", takeaway: "打包", clear: "收空盘", pay: "结账"
};

function clockTime(value: string): string {
  return new Date(value).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
}

export function OrdersPanel(props: Props) {
  const openOrders = props.orders.filter((order) => order.status !== "completed" && order.status !== "cancelled");
  const closedOrders = props.orders.filter((order) => order.status === "completed" || order.status === "cancelled");
  const openRequests = props.requests.filter((request) => request.status !== "completed" && request.status !== "cancelled");

  function renderOrder(order: ApiOrder) {
    const next = nextOperationalStatus(order.status as OrderStatus) as ApiOrder["status"] | null;
    const closed = order.status === "completed" || order.status === "cancelled";
    return <article className={`board-order status-${order.status}`} key={order.id}>
      <header><b>Tisch {order.table}</b><span className={`board-status ${order.status}`}>{orderLabels[order.status]}</span></header>
      <small>{order.no} · {clockTime(order.createdAt)}</small>
      <ul>{order.items.map((item, index) => <li key={`${item.id}-${index}`}>
        <span>{item.qty}×</span> {item.name || item.id}
        {item.modifiers?.length ? <em>{item.modifiers.map((modifier) => modifier.name).join(" · ")}</em> : null}
      </li>)}</ul>
      {order.note && <p className="board-note">备注：{order.note}</p>}
      <footer>
        <strong>{formatEuro(Math.round(order.total * 100))}</strong>
        {!closed && <div className="board-actions">
          {next && <button className="primary-action" disabled={props.busyId === order.id} onClick={() => void props.onOrderStatus(order.id, next)}>{orderLabels[next]}</button>}
          <button className="ghost-action" disabled={props.busyId === order.id} onClick={() => { if (window.confirm(`取消 Tisch ${order.table} 的订单 ${order.no}？`)) void props.onOrderStatus(order.id, "cancelled"); }}>取消</button>
        </div>}
      </footer>
    </article>;
  }

  return <section id="ordersPanel" className="admin-panel active">
    <div className="printer-toolbar"><div><h1>订单看板</h1><p>后端实时订单与服务呼叫，状态变更对所有设备生效</p></div><button className="discover-action" onClick={() => void props.onRefresh()}>↻ 刷新</button></div>
    <div className="board-layout">
      <section>
        <h2 className="section-title">进行中 · {openOrders.length}</h2>
        <div className="board-grid">{openOrders.length ? openOrders.map(renderOrder) : <div className="admin-empty">暂无进行中的订单</div>}</div>
        {closedOrders.length > 0 && <>
          <h2 className="section-title">已结束 · {closedOrders.length}</h2>
          <div className="board-grid closed">{closedOrders.slice(0, 12).map(renderOrder)}</div>
        </>}
      </section>
      <aside>
        <h2 className="section-title">服务呼叫 · {openRequests.length}</h2>
        <div className="board-requests">{openRequests.length ? openRequests.map((request) => <div className="board-request" key={request.id}>
          <div><b>Tisch {request.table} · {serviceLabels[request.serviceType] || request.serviceType}</b><small>{clockTime(request.createdAt)} · {requestLabels[request.status]}</small></div>
          <div className="board-actions">
            {request.status === "open" && <button disabled={props.busyId === request.id} onClick={() => void props.onRequestStatus(request.id, "acknowledged")}>已响应</button>}
            <button className="primary-action" disabled={props.busyId === request.id} onClick={() => void props.onRequestStatus(request.id, "completed")}>已处理</button>
          </div>
        </div>) : <div className="admin-empty">暂无服务呼叫</div>}</div>
      </aside>
    </div>
  </section>;
}

import type { ApiBill, ApiOrder, ApiPrintJob, ApiServiceRequest } from "@zhaoyun/contracts";

const orderStatusLabels: Record<ApiOrder["status"], string> = {
  new: "新订单",
  preparing: "制作中",
  ready: "可上菜",
  completed: "已完成",
  cancelled: "已取消"
};

const nextOrderStatus: Partial<Record<ApiOrder["status"], ApiOrder["status"]>> = {
  new: "preparing",
  preparing: "ready",
  ready: "completed"
};

const stationLabels: Record<ApiPrintJob["printerRole"], string> = {
  kitchen: "厨房",
  bar: "吧台",
  sushi: "寿司台",
  front: "前台"
};

const serviceLabels: Record<string, string> = {
  water: "加水",
  utensils: "餐具",
  napkin: "纸巾",
  takeaway: "打包",
  clear: "收台",
  pay: "买单"
};

function time(value: string): string {
  return new Date(value).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
}

interface Props {
  orders: ApiOrder[];
  requests: ApiServiceRequest[];
  failedJobs: ApiPrintJob[];
  bill: ApiBill | null;
  busy: boolean;
  onRefresh: () => Promise<void>;
  onOrderStatus: (id: string, status: ApiOrder["status"]) => Promise<void>;
  onRequestStatus: (id: string, status: ApiServiceRequest["status"]) => Promise<void>;
  onRetryJob: (id: string) => Promise<void>;
  onOpenBill: (table: string) => Promise<void>;
  onCloseBill: () => void;
  onSettleBill: (table: string) => Promise<void>;
}

export function BoardPanel(props: Props) {
  const openOrders = props.orders.filter((order) => order.status !== "completed" && order.status !== "cancelled");
  const openRequests = props.requests.filter((request) => request.status !== "completed" && request.status !== "cancelled");
  const openTables = [...new Set(props.orders.filter((order) => !order.billedAt && order.status !== "cancelled").map((order) => order.table))];

  return <section id="boardPanel" className="admin-panel active">
    <div className="list-head"><div><h1>订单看板</h1><p>全店实时订单、服务呼叫和失败打印任务，每 5 秒自动刷新</p></div><button className="ghost-action" onClick={() => void props.onRefresh()} disabled={props.busy}>刷新</button></div>

    <div className="board-layout">
      <section className="board-column">
        <h2>进行中的订单 <em>{openOrders.length}</em></h2>
        <div className="board-list">{openOrders.length ? openOrders.map((order) => {
          const next = nextOrderStatus[order.status];
          return <article className="board-card" key={order.id}>
            <div className="board-card-head"><b>桌 {order.table}</b><span className={`status ${order.status}`}>{orderStatusLabels[order.status]}</span></div>
            <small>{order.no} · {time(order.createdAt)} · EUR {order.total.toFixed(2)}{order.billedAt ? " · 已结账" : ""}</small>
            <ul>{order.items.map((item, index) => <li key={`${order.id}-${item.id}-${index}`}>{item.qty} × {item.name || item.id}{item.modifiers?.length ? <em> （{item.modifiers.map((modifier) => modifier.name).join(" · ")}）</em> : null}</li>)}</ul>
            {order.note && <p className="board-note">备注：{order.note}</p>}
            <div className="board-actions">
              {next && <button className="primary-action" disabled={props.busy} onClick={() => void props.onOrderStatus(order.id, next)}>更新为：{orderStatusLabels[next]}</button>}
              <button className="ghost-action" disabled={props.busy} onClick={() => void props.onOrderStatus(order.id, "cancelled")}>取消订单</button>
            </div>
          </article>;
        }) : <div className="admin-empty">暂无进行中的订单</div>}</div>
      </section>

      <section className="board-column">
        <h2>结账 <em>{openTables.length}</em></h2>
        <div className="board-list">{openTables.length ? <div className="table-chips">{openTables.map((table) => <button key={table} className="ghost-action" disabled={props.busy} onClick={() => void props.onOpenBill(table)}>桌 {table}</button>)}</div> : <div className="admin-empty">没有待结账的桌</div>}</div>
        {props.bill && <div className="bill-sheet" role="dialog" aria-label="账单">
          <div className="board-card-head"><b>桌 {props.bill.table} 账单</b><button className="ghost-action" onClick={props.onCloseBill}>关闭</button></div>
          {props.bill.items.length ? <>
            <ul className="bill-items">{props.bill.items.map((item, index) => <li key={`${item.orderNo}-${index}`}><span>{item.qty} × {item.name}</span><span>{item.lineTotal.toFixed(2)} · {item.vatPercent}%</span></li>)}</ul>
            <div className="bill-total"><span>合计</span><b>EUR {props.bill.total.toFixed(2)}</b></div>
            <table className="bill-vat"><thead><tr><th>税率</th><th>净额</th><th>税额</th><th>含税</th></tr></thead><tbody>{props.bill.vatBreakdown.map((group) => <tr key={group.percent}><td>{group.percent}%</td><td>{group.net.toFixed(2)}</td><td>{group.vat.toFixed(2)}</td><td>{group.gross.toFixed(2)}</td></tr>)}</tbody></table>
            <p className="bill-disclaimer">内部账单，不是税务收据；正式收据仍需由收银系统开具。</p>
            <button className="primary-action" disabled={props.busy} onClick={() => void props.onSettleBill(props.bill!.table)}>打印账单并结账</button>
          </> : <div className="admin-empty">这桌没有待结账的订单</div>}
        </div>}

        <h2>服务呼叫 <em>{openRequests.length}</em></h2>
        <div className="board-list">{openRequests.length ? openRequests.map((request) => <article className="board-card compact" key={request.id}>
          <div className="board-card-head"><b>桌 {request.table}</b><span className={`status ${request.status}`}>{serviceLabels[request.type] || request.type}</span></div>
          <small>{time(request.createdAt)}</small>
          <div className="board-actions"><button className="primary-action" disabled={props.busy} onClick={() => void props.onRequestStatus(request.id, "completed")}>已处理</button></div>
        </article>) : <div className="admin-empty">暂无服务呼叫</div>}</div>

        <h2>打印失败 <em>{props.failedJobs.length}</em></h2>
        <div className="board-list">{props.failedJobs.length ? props.failedJobs.map((job) => <article className="board-card compact failed" key={job.id}>
          <div className="board-card-head"><b>{stationLabels[job.printerRole]}</b><span className="status failed">{job.attempts} 次失败</span></div>
          <small>{job.payload.orderNo || job.orderId || job.id} · 桌 {job.payload.table || "-"}</small>
          {job.error && <p className="board-note">{job.error}</p>}
          <div className="board-actions"><button className="primary-action" disabled={props.busy} onClick={() => void props.onRetryJob(job.id)}>重新打印</button></div>
        </article>) : <div className="admin-empty">没有失败的打印任务</div>}</div>
      </section>
    </div>
  </section>;
}

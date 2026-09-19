import type { StaffRole, TableOverview } from "@zhaoyun/api-client";
import type { ApiBill, ApiOrder } from "@zhaoyun/contracts";

const stateLabels: Record<TableOverview["state"], string> = {
  free: "空闲",
  seated: "用餐中",
  locked: "已锁定"
};

const orderStatusLabels: Record<ApiOrder["status"], string> = {
  new: "新订单",
  preparing: "制作中",
  ready: "可上菜",
  completed: "已完成",
  cancelled: "已取消"
};

function time(value: string): string {
  return new Date(value).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
}

interface Props {
  tables: TableOverview[];
  bill: ApiBill | null;
  role: StaffRole | null;
  busy: boolean;
  onRefresh: () => Promise<void>;
  onLock: (table: string, locked: boolean) => Promise<void>;
  onOpenBill: (table: string) => Promise<void>;
  onCloseBill: () => void;
  onSettleBill: (table: string) => Promise<void>;
}

/**
 * The room, one card per table.
 *
 * The order board answers "what is the kitchen doing"; this answers "what is
 * happening at table 7", which is the question a waiter and a manager actually
 * ask. Every registered table is here whether or not anyone is sitting at it,
 * and a table with orders on it that nobody registered is here too — someone
 * scanned a card that was later deleted, and pretending it does not exist does
 * not make its bill go away.
 *
 * Locking is service state: it stops the table adding to a bill that is about
 * to be settled, and settling releases it, so nobody has to remember to unlock
 * anything afterwards.
 */
export function TablesPanel(props: Props) {
  const seated = props.tables.filter((table) => table.state !== "free");
  const takings = props.tables.reduce((sum, table) => sum + table.total, 0);

  return <section id="tablesPanel" className="admin-panel active">
    <div className="list-head">
      <div>
        <h1>桌位</h1>
        <p>{seated.length} 桌在用 · 未结账 EUR {takings.toFixed(2)} · 每 5 秒自动刷新</p>
      </div>
      <button className="ghost-action" onClick={() => void props.onRefresh()} disabled={props.busy}>刷新</button>
    </div>

    <div className="table-grid">{props.tables.length ? props.tables.map((table) => <article className={`table-tile ${table.state}`} key={table.table}>
      <div className="table-tile-head">
        <b>桌 {table.table}</b>
        <span className={`status ${table.state}`}>{stateLabels[table.state]}</span>
      </div>
      <small className="table-tile-meta">
        {table.label || "—"}
        {table.since ? ` · 自 ${time(table.since)}` : ""}
        {table.registered ? "" : " · 未登记"}
        {table.enabled ? "" : " · 已停用"}
      </small>

      {table.orders.length ? <>
        <ul className="table-tile-orders">{table.orders.map((order) => <li key={order.id}>
          <div className="table-tile-order-head">
            <span>{order.no}</span>
            <span className={`status ${order.status}`}>{orderStatusLabels[order.status]}</span>
          </div>
          <ul>{order.items.map((item, index) => <li key={`${order.id}-${item.id}-${index}`}>
            {item.qty} × {item.name || item.id}
            {item.modifiers?.length ? <em> （{item.modifiers.map((modifier) => modifier.name).join(" · ")}）</em> : null}
          </li>)}</ul>
          {order.note && <p className="board-note">备注：{order.note}</p>}
        </li>)}</ul>
        <div className="table-tile-total"><span>未结账</span><b>EUR {table.total.toFixed(2)}</b></div>
      </> : <p className="table-tile-empty">暂无订单</p>}

      <div className="board-actions">
        <button
          className="ghost-action"
          disabled={props.busy || !table.registered}
          title={table.registered ? "" : "这桌没有登记，先到「连接设置」里加上"}
          onClick={() => void props.onLock(table.table, !table.locked)}
        >{table.locked ? "解除锁定" : "锁定桌号"}</button>
        {table.orders.length > 0 && <button className="primary-action" disabled={props.busy} onClick={() => void props.onOpenBill(table.table)}>结账</button>}
      </div>
    </article>) : <div className="admin-empty">还没有登记任何桌位，去「连接设置」添加</div>}</div>

    {props.bill && <div className="bill-sheet" role="dialog" aria-label="账单">
      <div className="board-card-head"><b>桌 {props.bill.table} 账单</b><button className="ghost-action" onClick={props.onCloseBill}>关闭</button></div>
      {props.bill.items.length ? <>
        <ul className="bill-items">{props.bill.items.map((item, index) => <li key={`${item.orderNo}-${index}`}><span>{item.qty} × {item.name}</span><span>{item.lineTotal.toFixed(2)} · {item.vatPercent}%</span></li>)}</ul>
        <div className="bill-total"><span>合计</span><b>EUR {props.bill.total.toFixed(2)}</b></div>
        <table className="bill-vat"><thead><tr><th>税率</th><th>净额</th><th>税额</th><th>含税</th></tr></thead><tbody>{props.bill.vatBreakdown.map((group) => <tr key={group.percent}><td>{group.percent}%</td><td>{group.net.toFixed(2)}</td><td>{group.vat.toFixed(2)}</td><td>{group.gross.toFixed(2)}</td></tr>)}</tbody></table>
        <p className="bill-disclaimer">内部账单，不是税务收据；正式收据仍需由收银系统开具。结账后这桌会自动解除锁定。</p>
        <button className="primary-action" disabled={props.busy} onClick={() => void props.onSettleBill(props.bill!.table)}>打印账单并结账</button>
      </> : <div className="admin-empty">这桌没有待结账的订单</div>}
    </div>}
  </section>;
}

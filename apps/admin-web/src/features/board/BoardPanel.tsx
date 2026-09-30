import type { StaffRole } from "@zhaoyun/api-client";
import type { ApiDeliveryOrder, ApiOrder, ApiPrintJob, ApiServiceRequest } from "@zhaoyun/contracts";
import { formatMoney, formatTime, useI18n } from "../../app/i18n";
import type { CopyKey } from "../../app/i18n";

export const ORDER_STATUS_KEYS: Record<ApiOrder["status"], CopyKey> = {
  new: "orderNew",
  preparing: "orderPreparing",
  ready: "orderReady",
  completed: "orderCompleted",
  cancelled: "orderCancelled"
};

const nextOrderStatus: Partial<Record<ApiOrder["status"], ApiOrder["status"]>> = {
  new: "preparing",
  preparing: "ready",
  ready: "completed"
};

export const STATION_KEYS: Record<ApiPrintJob["printerRole"], CopyKey> = {
  kitchen: "stationKitchen",
  bar: "stationBar",
  sushi: "stationSushi",
  front: "stationFront"
};

const SERVICE_KEYS: Record<string, CopyKey> = {
  waiter: "serviceWaiter",
  water: "serviceWater",
  utensils: "serviceUtensils",
  napkin: "serviceNapkin",
  takeaway: "serviceTakeaway",
  clear: "serviceClear",
  pay: "servicePay"
};

interface Props {
  orders: ApiOrder[];
  requests: ApiServiceRequest[];
  failedJobs: ApiPrintJob[];
  /** The platforms' orders being cooked, soonest due first. */
  deliveryOrders: ApiDeliveryOrder[];
  onDeliveryReady: (id: string) => Promise<void>;
  role: StaffRole | null;
  busy: boolean;
  onRefresh: () => Promise<void>;
  onOrderStatus: (id: string, status: ApiOrder["status"]) => Promise<void>;
  onRequestStatus: (id: string, status: ApiServiceRequest["status"]) => Promise<void>;
  onRetryJob: (id: string) => Promise<void>;
}

export function BoardPanel(props: Props) {
  const { t, language } = useI18n();
  // The kitchen screen only moves orders along; service calls and print
  // failures are not its job and the server would refuse them anyway.
  const floor = props.role !== "kitchen";
  const openOrders = props.orders.filter((order) => order.status !== "completed" && order.status !== "cancelled");
  const openRequests = props.requests.filter((request) => request.status !== "completed" && request.status !== "cancelled");

  return <section id="boardPanel" className="admin-panel active">
    <div className="list-head"><div><h1>{t("boardTitle")}</h1></div><button className="ghost-action" onClick={() => void props.onRefresh()} disabled={props.busy}>{t("refresh")}</button></div>

    <div className="board-layout">
      <section className="board-column">
        <h2>{t("boardOpenOrders")} <em>{openOrders.length}</em></h2>
        <div className="board-list">{openOrders.length ? openOrders.map((order) => {
          const next = nextOrderStatus[order.status];
          return <article className="board-card" key={order.id}>
            <div className="board-card-head"><b>{t("table", { table: order.table })}</b><span className={`status ${order.status}`}>{t(ORDER_STATUS_KEYS[order.status])}</span></div>
            <small>{order.no} · {formatTime(order.createdAt, language)} · {formatMoney(Math.round(order.total * 100), language)}{order.staffName ? ` · ${order.staffName}` : ""}{order.channel ? ` · ${t(order.channel === "pickup" ? "channelPickup" : "channelDineIn")}` : ""}{order.pickupNo ? ` · ${t("pickupShort", { no: order.pickupNo })}` : ""}{order.billedAt ? ` · ${t("boardBilled")}` : ""}</small>
            <ul>{order.items.map((item, index) => <li key={`${order.id}-${item.id}-${index}`}>{item.qty} × {item.name || item.id}{item.voided ? <em className="voided"> {t("voidedCount", { count: item.voided })}</em> : null}{item.modifiers?.length ? <em> ({item.modifiers.map((modifier) => modifier.name).join(" · ")})</em> : null}</li>)}</ul>
            {order.note && <p className="board-note">{t("note", { note: order.note })}</p>}
            <div className="board-actions">
              {next && <button className="primary-action" disabled={props.busy} onClick={() => void props.onOrderStatus(order.id, next)}>{t("boardAdvance", { status: t(ORDER_STATUS_KEYS[next]) })}</button>}
              {floor && <button className="ghost-action" disabled={props.busy} onClick={() => void props.onOrderStatus(order.id, "cancelled")}>{t("boardCancel")}</button>}
            </div>
          </article>;
        }) : <div className="admin-empty">{t("boardNoOrders")}</div>}</div>
      </section>

      {/* The delivery platforms' orders: the kitchen's too, by when they are due. */}
      {props.deliveryOrders.length > 0 && <DeliveryColumn orders={props.deliveryOrders} busy={props.busy} onReady={props.onDeliveryReady} />}

      {/* Billing lives on the Tables tab, where the table it belongs to is on
          screen with it. */}
      {floor && <section className="board-column">
        <h2>{t("boardCalls")} <em>{openRequests.length}</em></h2>
        <div className="board-list">{openRequests.length ? openRequests.map((request) => <article className="board-card compact" key={request.id}>
          <div className="board-card-head"><b>{t("table", { table: request.table })}</b><span className={`status ${request.status}`}>{SERVICE_KEYS[request.type] ? t(SERVICE_KEYS[request.type]!) : request.type}</span></div>
          <small>{formatTime(request.createdAt, language)}</small>
          <div className="board-actions"><button className="primary-action" disabled={props.busy} onClick={() => void props.onRequestStatus(request.id, "completed")}>{t("boardHandled")}</button></div>
        </article>) : <div className="admin-empty">{t("boardNoCalls")}</div>}</div>

        <h2>{t("boardFailed")} <em>{props.failedJobs.length}</em></h2>
        <div className="board-list">{props.failedJobs.length ? props.failedJobs.map((job) => <article className="board-card compact failed" key={job.id}>
          <div className="board-card-head"><b>{t(STATION_KEYS[job.printerRole])}</b><span className="status failed">{t("boardAttempts", { count: job.attempts })}</span></div>
          <small>{job.payload.orderNo || job.orderId || job.id} · {t("table", { table: job.payload.table || "-" })}</small>
          {job.error && <p className="board-note">{job.error}</p>}
          <div className="board-actions"><button className="primary-action" disabled={props.busy} onClick={() => void props.onRetryJob(job.id)}>{t("boardReprint")}</button></div>
        </article>) : <div className="admin-empty">{t("boardNoFailed")}</div>}</div>
      </section>}
    </div>
  </section>;
}

/**
 * What the platforms' riders and guests wait for: accepted orders by the time
 * the floor promised (red once it has passed), then those ready for pickup.
 * The kitchen says "ready" here; the platform is told.
 */
function DeliveryColumn({ orders, busy, onReady }: { orders: ApiDeliveryOrder[]; busy: boolean; onReady: (id: string) => Promise<void> }) {
  const { t, language } = useI18n();
  const cooking = orders.filter((order) => order.status === "accepted").length;
  return <section className="board-column" id="boardDelivery">
    <h2>{t("boardDelivery")} <em>{cooking}</em></h2>
    <div className="board-list">{orders.map((order) => {
      const due = order.readyBy ?? order.dueAt;
      const late = order.status === "accepted" && due !== null && due !== undefined && Date.parse(due) < Date.now();
      return <article className={`board-card ${late ? "late" : ""}`} key={order.id} data-delivery={order.reference} data-status={order.status}>
        <div className="board-card-head"><b>{order.providerName} #{order.reference}</b><span className={`status ${order.status === "ready" ? "ready" : "preparing"}`}>{t(`dlStatus_${order.status}` as CopyKey)}</span></div>
        <small>{t(order.type === "pickup" ? "dlTypePickup" : "dlTypeDelivery")}{due ? ` · ${t(late ? "boardLate" : "boardDue", { time: formatTime(due, language) })}` : ""}{order.customerName ? ` · ${order.customerName}` : ""}</small>
        <ul>{order.items.map((item, index) => <li key={index}>{item.quantity} × {item.name}{item.options.length ? <em> ({item.options.map((option) => option.name).join(" · ")})</em> : null}</li>)}</ul>
        {order.notes && <p className="board-note">{t("note", { note: order.notes })}</p>}
        {order.status === "accepted" && <div className="board-actions"><button className="primary-action" disabled={busy} onClick={() => void onReady(order.id)}>{t("dlReady")}</button></div>}
      </article>;
    })}</div>
  </section>;
}

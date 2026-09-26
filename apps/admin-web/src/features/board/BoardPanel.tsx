import type { StaffRole } from "@zhaoyun/api-client";
import type { ApiOrder, ApiPrintJob, ApiServiceRequest } from "@zhaoyun/contracts";
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
    <div className="list-head"><div><h1>{t("boardTitle")}</h1><p>{t("boardLead")}</p></div><button className="ghost-action" onClick={() => void props.onRefresh()} disabled={props.busy}>{t("refresh")}</button></div>

    <div className="board-layout">
      <section className="board-column">
        <h2>{t("boardOpenOrders")} <em>{openOrders.length}</em></h2>
        <div className="board-list">{openOrders.length ? openOrders.map((order) => {
          const next = nextOrderStatus[order.status];
          return <article className="board-card" key={order.id}>
            <div className="board-card-head"><b>{t("table", { table: order.table })}</b><span className={`status ${order.status}`}>{t(ORDER_STATUS_KEYS[order.status])}</span></div>
            <small>{order.no} · {formatTime(order.createdAt, language)} · {formatMoney(Math.round(order.total * 100), language)}{order.staffName ? ` · ${order.staffName}` : ""}{order.pickupNo ? ` · ${t("pickupShort", { no: order.pickupNo })}` : ""}{order.billedAt ? ` · ${t("boardBilled")}` : ""}</small>
            <ul>{order.items.map((item, index) => <li key={`${order.id}-${item.id}-${index}`}>{item.qty} × {item.name || item.id}{item.voided ? <em className="voided"> {t("voidedCount", { count: item.voided })}</em> : null}{item.modifiers?.length ? <em> ({item.modifiers.map((modifier) => modifier.name).join(" · ")})</em> : null}</li>)}</ul>
            {order.note && <p className="board-note">{t("note", { note: order.note })}</p>}
            <div className="board-actions">
              {next && <button className="primary-action" disabled={props.busy} onClick={() => void props.onOrderStatus(order.id, next)}>{t("boardAdvance", { status: t(ORDER_STATUS_KEYS[next]) })}</button>}
              {floor && <button className="ghost-action" disabled={props.busy} onClick={() => void props.onOrderStatus(order.id, "cancelled")}>{t("boardCancel")}</button>}
            </div>
          </article>;
        }) : <div className="admin-empty">{t("boardNoOrders")}</div>}</div>
      </section>

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

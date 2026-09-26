import type { StaffRole, TableOverview } from "@zhaoyun/api-client";
import type { ApiBill, PosStaffActivity } from "@zhaoyun/contracts";
import { formatMoney, formatTime, useI18n } from "../../app/i18n";
import type { CopyKey } from "../../app/i18n";
import { ORDER_STATUS_KEYS } from "../board/BoardPanel";

const STATE_KEYS: Record<TableOverview["state"], CopyKey> = {
  free: "tableFree",
  seated: "tableSeated",
  locked: "tableLocked"
};

const euro = (amount: number) => Math.round(amount * 100);

interface Props {
  tables: TableOverview[];
  /** The waiters now (the manager's view; empty otherwise). */
  staff: PosStaffActivity[];
  bill: ApiBill | null;
  role: StaffRole | null;
  busy: boolean;
  onRefresh: () => Promise<void>;
  onLock: (table: string, locked: boolean) => Promise<void>;
  onOpenBill: (table: string) => Promise<void>;
  onCloseBill: () => void;
  /** The bill on the front printer, for the guest to read; it marks nothing paid. */
  onPrintBill: (table: string) => Promise<void>;
  /** Open a table for its guests to order from their phones (开台), or close it. */
  onOrdering: (table: string, open: boolean) => Promise<void>;
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
 * to be paid, and the receipt that pays the last of it releases it, so nobody
 * has to remember to unlock anything afterwards.
 */
export function TablesPanel(props: Props) {
  const { t, language } = useI18n();
  const seated = props.tables.filter((table) => table.state !== "free");
  const takings = props.tables.reduce((sum, table) => sum + table.total, 0);

  return <section id="tablesPanel" className="admin-panel active">
    <div className="list-head">
      <div>
        <h1>{t("tablesTitle")}</h1>
        <p>{t("tablesLead", { seated: seated.length, total: takings.toFixed(2) })}</p>
      </div>
      <button className="ghost-action" onClick={() => void props.onRefresh()} disabled={props.busy}>{t("refresh")}</button>
    </div>

    {props.staff.length > 0 && <section className="staff-live" aria-label={t("staffLive")}>
      {props.staff.map((person) => <article key={person.id} data-staff={person.name} className={`staff-live-card ${person.online ? "online" : ""}`}>
        <div className="staff-live-head">
          <i aria-hidden="true" />
          <b>{person.name}</b>
          <small>{person.online ? person.devices.join(" · ") : t("staffOffline")}</small>
        </div>
        <p>{person.tables.length ? t("staffTables", { tables: person.tables.join(", ") }) : t("staffNoTables")}</p>
        <p className="staff-live-shift">{t("staffShift", {
          receipts: person.shift.receipts,
          total: formatMoney(person.shift.grossCents, language),
          cash: formatMoney(person.shift.payments.cash, language)
        })}</p>
      </article>)}
    </section>}

    <div className="table-grid">{props.tables.length ? props.tables.map((table) => <article className={`table-tile ${table.state}`} key={table.table}>
      <div className="table-tile-head">
        <b>{t("table", { table: table.table })}</b>
        <span className={`status ${table.state}`}>{t(STATE_KEYS[table.state])}</span>
      </div>
      {table.openOn?.staffName && <span className="table-open-on">{t("openOnPos", { name: table.openOn.staffName })}</span>}
      {table.orderingUntil && <span className="table-ordering">{t("tableOrderingUntil", { time: formatTime(table.orderingUntil, language) })}</span>}
      <small className="table-tile-meta">
        {table.label || "—"}
        {table.since ? ` · ${t("tableSince", { time: formatTime(table.since, language) })}` : ""}
        {table.registered ? "" : ` · ${t("tableUnregistered")}`}
        {table.enabled ? "" : ` · ${t("tableDisabled")}`}
      </small>

      {table.orders.length ? <>
        <ul className="table-tile-orders">{table.orders.map((order) => <li key={order.id}>
          <div className="table-tile-order-head">
            <span>{order.no}{order.staffName ? ` · ${order.staffName}` : ""}{order.channel ? ` · ${t(order.channel === "pickup" ? "channelPickup" : "channelDineIn")}` : ""}{order.pickupNo ? ` · ${t("pickupShort", { no: order.pickupNo })}` : ""}</span>
            <span className={`status ${order.status}`}>{t(ORDER_STATUS_KEYS[order.status])}</span>
          </div>
          <ul>{order.items.map((item, index) => <li key={`${order.id}-${item.id}-${index}`}>
            {item.qty} × {item.name || item.id}
            {item.voided ? <em className="voided"> {t("voidedCount", { count: item.voided })}</em> : null}
            {item.modifiers?.length ? <em> ({item.modifiers.map((modifier) => modifier.name).join(" · ")})</em> : null}
          </li>)}</ul>
          {order.note && <p className="board-note">{t("note", { note: order.note })}</p>}
        </li>)}</ul>
        <div className="table-tile-total"><span>{t("tableOpen")}</span><b>{formatMoney(euro(table.total), language)}</b></div>
      </> : <p className="table-tile-empty">{t("tableNoOrders")}</p>}

      <div className="board-actions">
        <button
          className="ghost-action"
          disabled={props.busy || !table.registered}
          title={table.registered ? "" : t("tableRegisterFirst")}
          onClick={() => void props.onLock(table.table, !table.locked)}
        >{t(table.locked ? "tableUnlock" : "tableLock")}</button>
        {!table.table.startsWith("TA-") && <button className="ghost-action" disabled={props.busy} onClick={() => void props.onOrdering(table.table, !table.orderingUntil)}>
          {t(table.orderingUntil ? "closeForOrdering" : "openForOrdering")}
        </button>}
        {table.orders.length > 0 && <button className="primary-action" disabled={props.busy} onClick={() => void props.onOpenBill(table.table)}>{t("tableSettle")}</button>}
      </div>
    </article>) : <div className="admin-empty">{t("tablesEmpty")}</div>}</div>

    {props.bill && <div className="bill-sheet" role="dialog" aria-label={t("billDialog")}>
      <div className="board-card-head"><b>{t("billTitle", { table: props.bill.table })}</b><button className="ghost-action" onClick={props.onCloseBill}>{t("close")}</button></div>
      {props.bill.items.length ? <>
        <ul className="bill-items">{props.bill.items.map((item, index) => <li key={`${item.orderNo}-${index}`}><span>{item.qty} × {item.name}</span><span>{item.lineTotal.toFixed(2)} · {item.vatSplit ? item.vatSplit.map((part) => `${part.percent}%`).join("/") : `${item.vatPercent}%`}</span></li>)}</ul>
        <div className="bill-total"><span>{t("billTotal")}</span><b>{formatMoney(euro(props.bill.total), language)}</b></div>
        <table className="bill-vat"><thead><tr><th>{t("billRate")}</th><th>{t("billNet")}</th><th>{t("billVat")}</th><th>{t("billGross")}</th></tr></thead><tbody>{props.bill.vatBreakdown.map((group) => <tr key={group.percent}><td>{group.percent}%</td><td>{group.net.toFixed(2)}</td><td>{group.vat.toFixed(2)}</td><td>{group.gross.toFixed(2)}</td></tr>)}</tbody></table>
        <p className="bill-disclaimer">{t("billDisclaimer")}</p>
        <div className="board-actions">
          <button className="ghost-action" disabled={props.busy} onClick={() => void props.onPrintBill(props.bill!.table)}>{t("billPrint")}</button>
          {/* Paying is at the POS, where the waiter's receipt is theirs. */}
          <a className="primary-action" href="pos.html" target="_blank" rel="noopener">{t("billTakePayment")}</a>
        </div>
      </> : <div className="admin-empty">{t("billEmpty")}</div>}
    </div>}
  </section>;
}

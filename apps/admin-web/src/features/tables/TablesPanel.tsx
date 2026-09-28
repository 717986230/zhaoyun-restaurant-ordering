import { useState } from "react";
import type { FormEvent } from "react";
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
  /** The manager's: the default tables 1 to count set up, so they can be edited. */
  onSetUpTables: (count: number) => Promise<boolean>;
  onAddTable: (table: string) => Promise<boolean>;
  onRenameTable: (table: string, input: { table?: string; label?: string }) => Promise<boolean>;
  onDeleteTable: (table: string) => Promise<void>;
}

/** Someone is at the table: its number waits until they are gone. */
const inUse = (table: TableOverview) => table.orders.length > 0 || Boolean(table.openOn) || Boolean(table.orderingUntil);

/** The default tables standing in until the room is set up: 1, 2, 3 … with none missing. */
function defaultCount(tables: TableOverview[]) {
  const numbers = new Set(tables.filter((table) => !table.registered).map((table) => table.table));
  let count = 0;
  while (numbers.has(String(count + 1))) count += 1;
  return count;
}

/** The number after the highest one in the room: what "+ add table" suggests. */
function nextNumber(tables: TableOverview[]) {
  return String(tables.reduce((high, table) => /^\d+$/.test(table.table) ? Math.max(high, Number(table.table)) : high, 0) + 1);
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
  const manager = props.role === "manager";
  const [editing, setEditing] = useState(false);
  // The table whose number and label are being changed, in its own card.
  const [renaming, setRenaming] = useState<string | null>(null);
  const room = props.tables.filter((table) => !table.table.startsWith("TA-"));

  async function startEditing() {
    // The default 1 to N are not tables yet: set them up first, once.
    const count = room.some((table) => table.registered) ? 0 : defaultCount(room);
    if (count && (!window.confirm(t("tablesSetUpConfirm", { count })) || !await props.onSetUpTables(count))) return;
    setEditing(true);
  }

  async function addTable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const table = String(new FormData(form).get("table") || "").trim().toUpperCase();
    if (table && await props.onAddTable(table)) form.reset();
  }

  async function rename(event: FormEvent<HTMLFormElement>, from: TableOverview) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const table = String(data.get("table") || "").trim().toUpperCase();
    const label = String(data.get("label") || "").trim();
    const changes = { ...(table && table !== from.table ? { table } : {}), ...(label !== from.label ? { label } : {}) };
    if (!Object.keys(changes).length || await props.onRenameTable(from.table, changes)) setRenaming(null);
  }

  return <section id="tablesPanel" className="admin-panel active">
    <div className="list-head">
      <div>
        <h1>{t("tablesTitle")}</h1>
        <p>{t("tablesLead", { seated: seated.length, total: takings.toFixed(2) })}</p>
      </div>
      <div className="list-head-actions">
        {manager && <button className={editing ? "primary-action" : "ghost-action"} data-action="edit-tables" disabled={props.busy}
          onClick={() => { if (editing) { setEditing(false); setRenaming(null); } else void startEditing(); }}>{t(editing ? "tablesEditDone" : "tablesEdit")}</button>}
        <button className="ghost-action" onClick={() => void props.onRefresh()} disabled={props.busy}>{t("refresh")}</button>
      </div>
    </div>

    {editing && <section className="table-editor" aria-label={t("tablesEdit")}>
      <p>{t("tablesEditLead")}</p>
      <form className="table-editor-add" onSubmit={(event) => void addTable(event)}>
        <label><span>{t("tableNumber")}</span>
          <input key={nextNumber(room)} name="table" required maxLength={8} pattern="[A-Za-z0-9][A-Za-z0-9\-]{0,7}" autoCapitalize="characters" defaultValue={nextNumber(room)} />
        </label>
        <button className="primary-action" type="submit" disabled={props.busy}>{t("tableAdd")}</button>
      </form>
    </section>}

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

    <div className="table-grid">{props.tables.length ? props.tables.map((table) => {
      // Open on a POS: that device's table. The console looks, and touches nothing.
      const held = Boolean(table.openOn);
      const holder = table.openOn?.staffName ?? "?";
      const lockedTitle = held ? t("tableLockedOnPosHint", { name: holder }) : "";
      return <article className={`table-tile ${table.state} ${held ? "claimed" : ""}`} key={table.table} data-table={table.table}>
      <div className="table-tile-head">
        <b>{t("table", { table: table.table })}</b>
        <span className={`status ${table.state}`}>{t(STATE_KEYS[table.state])}</span>
      </div>
      {held && <span className="table-open-on" title={lockedTitle}>{t("tableLockedOnPos", { name: holder })}</span>}
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

      {editing && !table.table.startsWith("TA-") ? (renaming === table.table
        ? <form className="table-rename" onSubmit={(event) => void rename(event, table)}>
          <label><span>{t("tableNumber")}</span><input name="table" required maxLength={8} pattern="[A-Za-z0-9][A-Za-z0-9\-]{0,7}" autoCapitalize="characters" defaultValue={table.table} disabled={inUse(table)} autoFocus /></label>
          <label><span>{t("tableNote")}</span><input name="label" maxLength={64} defaultValue={table.label} placeholder={t("tableNotePlaceholder")} /></label>
          <div className="board-actions">
            <button className="ghost-action" type="button" onClick={() => setRenaming(null)}>{t("cancel")}</button>
            <button className="primary-action" type="submit" disabled={props.busy}>{t("save")}</button>
          </div>
        </form>
        : <div className="board-actions">
          {inUse(table) && <small className="table-in-use">{t("tableInUseHint")}</small>}
          <button className="ghost-action" data-action="rename" disabled={props.busy || !table.registered || held} onClick={() => setRenaming(table.table)}>{t("tableRename")}</button>
          <button className="danger-action" data-action="remove" disabled={props.busy || !table.registered || inUse(table)}
            onClick={() => { if (window.confirm(t("tableRemoveConfirm", { table: table.table }))) void props.onDeleteTable(table.table); }}>{t("delete")}</button>
        </div>)
      : <div className="board-actions">
        <button
          className="ghost-action"
          disabled={props.busy || !table.registered || held}
          title={held ? lockedTitle : table.registered ? "" : t("tableRegisterFirst")}
          onClick={() => void props.onLock(table.table, !table.locked)}
        >{t(table.locked ? "tableUnlock" : "tableLock")}</button>
        {!table.table.startsWith("TA-") && <button className="ghost-action" disabled={props.busy || held} title={lockedTitle} onClick={() => void props.onOrdering(table.table, !table.orderingUntil)}>
          {t(table.orderingUntil ? "closeForOrdering" : "openForOrdering")}
        </button>}
        {table.orders.length > 0 && <button className="primary-action" disabled={props.busy} onClick={() => void props.onOpenBill(table.table)}>{t("tableSettle")}</button>}
      </div>}
    </article>;
    }) : <div className="admin-empty">{t("tablesEmpty")}</div>}</div>

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

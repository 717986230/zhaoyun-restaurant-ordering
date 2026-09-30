import { useCallback, useEffect, useState } from "react";
import type { AdminApi, DeliveryAction, DeliveryList, StaffRole } from "@zhaoyun/api-client";
import type { ApiDeliveryOrder, ApiDeliveryPlatform, ApiDeliverySettings, ApiSettings, DeliveryProvider, DeliveryRejectReason, DeliveryStatus } from "@zhaoyun/contracts";
import { formatMoney, useI18n } from "../../app/i18n";
import type { AdminLanguage, CopyKey } from "../../app/i18n";

interface Props {
  api: AdminApi;
  role: StaffRole | null;
  /** The manager's settings, for the platforms' switches; null for the floor staff. */
  settings: ApiSettings | null;
  notify: (message: string, kind?: "success" | "warning" | "error") => void;
  failed: (error: unknown) => void;
  onSaveSettings: (change: Partial<ApiSettings>, done: CopyKey) => Promise<void>;
  /** Changes on the floor, live: the list reloads when it moves. */
  liveTick: number;
}

const DAY_MS = 86_400_000;
const LOCALES: Record<AdminLanguage, string> = { zh: "zh-CN", en: "en-GB", de: "de-AT" };
const PROVIDERS: DeliveryProvider[] = ["lieferando", "foodora"];
const STATUSES: DeliveryStatus[] = ["new", "accepted", "ready", "completed", "rejected", "cancelled"];
const REASONS: DeliveryRejectReason[] = ["TOO_BUSY", "ITEM_UNAVAILABLE", "CLOSED", "OUTSIDE_DELIVERY_AREA", "OTHER"];
/** The secrets each platform needs, by the names the deployment keeps them under (docs/DELIVERY.md). */
const WEBHOOK_ENV: Record<DeliveryProvider, string> = { lieferando: "LIEFERANDO_WEBHOOK_SECRET", foodora: "FOODORA_WEBHOOK_SECRET" };
const API_ENV: Record<DeliveryProvider, string> = { lieferando: "LIEFERANDO_API_KEY", foodora: "FOODORA_USERNAME + FOODORA_PASSWORD" };

function todayIn(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const statusKey = (status: DeliveryStatus) => `dlStatus_${status}` as CopyKey;
const reasonKey = (reason: string) => `dlReason_${reason}` as CopyKey;

/** A CSV the way Excel opens it right: a BOM for UTF-8, fields quoted. */
function downloadCsv(name: string, rows: Array<Array<string | number>>) {
  const quote = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const text = `﻿${rows.map((row) => row.map(quote).join(",")).join("\r\n")}\r\n`;
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The delivery platforms (shared/delivery.mjs): their orders over any days —
 * what each brought in, every order to open, answer if still open, or tell
 * the platform again — and for the manager, each platform's switches, the
 * addresses to give it, and a test order through the whole path.
 */
export function DeliveryPanel({ api, role, settings, notify, failed, onSaveSettings, liveTick }: Props) {
  const { t, language } = useI18n();
  const timeZone = settings?.timeZone ?? "Europe/Vienna";
  const today = todayIn(timeZone);
  const [filter, setFilter] = useState<{ from: string; to: string; provider: DeliveryProvider | ""; status: DeliveryStatus | "" }>({ from: today, to: today, provider: "", status: "" });
  const [list, setList] = useState<DeliveryList | null>(null);
  const [open, setOpen] = useState<ApiDeliveryOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const money = (cents: number) => formatMoney(cents, language);

  const load = useCallback(async () => {
    try {
      setList(await api.deliveryOrders(filter.from, filter.to, { provider: filter.provider, status: filter.status }));
    } catch (error) { failed(error); }
  }, [api, filter, failed]);
  useEffect(() => { void load(); }, [load, liveTick]);
  // The net under the live channel.
  useEffect(() => {
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function act(order: ApiDeliveryOrder, action: DeliveryAction, options: { prepMinutes?: number; reason?: DeliveryRejectReason } = {}) {
    setBusy(true);
    try {
      const { order: updated } = await api.deliveryAction(order.id, action, options);
      if (updated.sync.status === "failed") notify(`${t("dlSync_failed")}: ${updated.sync.error ?? ""}`, "warning");
      setOpen(updated);
      await load();
    } catch (error) { failed(error); } finally { setBusy(false); }
  }

  const stamp = (iso: string | null) => iso ? new Intl.DateTimeFormat(LOCALES[language], { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : "—";
  const orders = list?.orders ?? [];
  const lines = (order: ApiDeliveryOrder) => order.items.reduce((total, item) => total + item.quantity, 0);
  const exportCsv = () => downloadCsv(`delivery_${filter.from}_${filter.to}.csv`, [
    [t("dlPlacedAt"), t("dlPlatform"), t("dlReference"), t("dlType"), t("dlStatus"), t("dlItems"), t("dlTotal"), t("dlFee"), t("dlPaid"), t("dlTest")],
    ...orders.map((order) => [stamp(order.createdAt), order.providerName, order.reference, t(order.type === "pickup" ? "dlTypePickup" : "dlTypeDelivery"), t(statusKey(order.status)),
      order.items.map((item) => `${item.quantity}× ${item.name}`).join("; "), (order.totalCents / 100).toFixed(2), (order.deliveryFeeCents / 100).toFixed(2), order.paidOnline ? "1" : "0", order.test ? "1" : "0"])
  ]);

  return <section id="deliveryPanel" className="admin-panel active"><div className="settings-page">
    <div className="list-head">
      <div>
        <h1>{t("dlTitle")}</h1>
        
      </div>
    </div>

    <div className="res-records" id="dlOrders">
      <form key={`${filter.from}_${filter.to}`} className="report-dates res-filter" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setFilter({ from: String(data.get("from")), to: String(data.get("to")), provider: String(data.get("provider") ?? "") as DeliveryProvider | "", status: String(data.get("status") ?? "") as DeliveryStatus | "" });
      }}>
        <label><span>{t("reportFrom")}</span><input name="from" type="date" required defaultValue={filter.from} /></label>
        <label><span>{t("reportTo")}</span><input name="to" type="date" required defaultValue={filter.to} /></label>
        <label><span>{t("dlPlatform")}</span><select name="provider" defaultValue={filter.provider}>
          <option value="">{t("dlAllPlatforms")}</option>
          {PROVIDERS.map((provider) => <option key={provider} value={provider}>{provider === "lieferando" ? "Lieferando" : "foodora"}</option>)}
        </select></label>
        <label><span>{t("dlStatus")}</span><select name="status" defaultValue={filter.status}>
          <option value="">{t("dlAllStatuses")}</option>
          {STATUSES.map((status) => <option key={status} value={status}>{t(statusKey(status))}</option>)}
        </select></label>
        <div className="filter-actions">
          <button type="submit" className="ghost-action">{t("resShow")}</button>
          <button type="button" className="ghost-action" onClick={() => setFilter({ ...filter, from: shift(today, -6), to: today })}>{t("reportWeek")}</button>
          <button type="button" className="ghost-action" disabled={!orders.length} onClick={exportCsv}>⬇ {t("resExport")}</button>
        </div>
      </form>
      <ul className="dl-totals" id="dlTotals">{(list?.totals ?? []).map((entry) => <li key={entry.provider} data-provider={entry.provider}>
        {t("dlTotals", { name: entry.name, orders: entry.orders, money: money(entry.grossCents), rejected: entry.rejected, cancelled: entry.cancelled })}
      </li>)}</ul>
      {!orders.length ? <div className="admin-empty">{t("dlNone")}</div> : <div className="res-table-wrap"><table className="report-table res-records-table">
        <thead><tr><th>{t("dlPlacedAt")}</th><th>{t("dlPlatform")}</th><th>{t("dlReference")}</th><th>{t("dlType")}</th><th>{t("dlItems")}</th><th>{t("dlTotal")}</th><th>{t("dlStatus")}</th><th>{t("dlSync")}</th><th /></tr></thead>
        <tbody>{orders.map((order) => <tr key={order.id} data-delivery={order.reference} data-status={order.status}>
          <td>{stamp(order.createdAt)}</td><td>{order.providerName}{order.test ? <em className="res-warn"> · {t("dlTest")}</em> : null}</td>
          <td className="res-ref">{order.reference}</td><td>{t(order.type === "pickup" ? "dlTypePickup" : "dlTypeDelivery")}</td>
          <td>{lines(order)}</td><td>{money(order.totalCents)}</td>
          <td><span className={`res-pill dl-pill-${order.status}`}>{t(statusKey(order.status))}</span></td>
          <td>{order.sync.status === "failed" ? <em className="res-warn">{t("dlSync_failed")}</em> : t(`dlSync_${order.sync.status}` as CopyKey)}</td>
          <td><button type="button" className="ghost-action" onClick={() => setOpen(order)}>{t("dlDetail")}</button></td>
        </tr>)}</tbody>
      </table></div>}
    </div>

    {open && <div className="res-dialog" role="dialog" aria-modal="true" aria-label={t("dlDetail")} onClick={(event) => { if (event.target === event.currentTarget) setOpen(null); }}>
      <article className="res-print" id="dlRecord">
        <h2>{open.providerName} · #{open.reference}</h2>
        <dl>
          <dt>{t("dlStatus")}</dt><dd>{t(statusKey(open.status))}{open.rejectReason ? ` · ${t(reasonKey(open.rejectReason))}` : ""}</dd>
          <dt>{t("dlType")}</dt><dd>{t(open.type === "pickup" ? "dlTypePickup" : "dlTypeDelivery")}</dd>
          <dt>{t("dlPlacedAt")}</dt><dd>{stamp(open.createdAt)}</dd>
          <dt>{t("dlDue")}</dt><dd>{stamp(open.dueAt)}</dd>
          <dt>{t("dlCustomer")}</dt><dd>{open.customerName || "—"}</dd>
          <dt>{t("dlPhone")}</dt><dd>{open.customerPhone || "—"}</dd>
          <dt>{t("dlAddress")}</dt><dd>{open.address || "—"}</dd>
          <dt>{t("dlNotes")}</dt><dd>{open.notes || "—"}</dd>
          <dt>{t("dlItems")}</dt><dd><ul className="dl-items">{open.items.map((item, index) => <li key={index}>
            {item.quantity}× {item.name} <span>{money(item.unitCents * item.quantity)}</span>
            {item.options.length > 0 && <small>{item.options.map((option) => option.name).join(" · ")}</small>}
            {item.note && <small>{item.note}</small>}
          </li>)}</ul></dd>
          <dt>{t("dlFee")}</dt><dd>{money(open.deliveryFeeCents)}</dd>
          <dt>{t("dlTotal")}</dt><dd>{money(open.totalCents)} · {t(open.paidOnline ? "dlPaid" : "dlCash")}</dd>
          <dt>{t("dlSync")}</dt><dd>{t(`dlSync_${open.sync.status}` as CopyKey)}{open.sync.error ? ` · ${t("dlSyncError")}: ${open.sync.error}` : ""}</dd>
        </dl>
        <div className="res-actions res-no-print">
          {open.status === "new" && <>
            <button type="button" className="primary-action" disabled={busy} onClick={() => void act(open, "accept")}>{t("dlAccept", { n: settings?.delivery?.[open.provider]?.prepMinutes ?? 20 })}</button>
            {REASONS.map((reason) => <button key={reason} type="button" className="ghost-action" disabled={busy} onClick={() => void act(open, "reject", { reason })}>{t("dlReject", { reason: t(reasonKey(reason)) })}</button>)}
          </>}
          {open.status === "accepted" && <button type="button" className="primary-action" disabled={busy} onClick={() => void act(open, "ready")}>{t("dlReady")}</button>}
          {open.status === "ready" && <button type="button" className="primary-action" disabled={busy} onClick={() => void act(open, "complete")}>{t("dlComplete")}</button>}
          {open.sync.status === "failed" && <button type="button" className="ghost-action" disabled={busy} onClick={() => void act(open, "resend")}>{t("dlResend")}</button>}
          <button type="button" className="ghost-action" onClick={() => setOpen(null)}>{t("dlClose")}</button>
        </div>
      </article>
    </div>}

    {role === "manager" && settings?.delivery && <DeliverySettings api={api} value={settings.delivery} notify={notify} failed={failed}
      onSave={(delivery) => onSaveSettings({ delivery }, "dlSaved")} onTest={() => void load()} />}
  </div></section>;
}

/** The manager's switches per platform, what this deployment holds of each one's secrets, and the addresses to give it. */
function DeliverySettings({ api, value, notify, failed, onSave, onTest }: {
  api: AdminApi; value: ApiDeliverySettings; notify: Props["notify"]; failed: Props["failed"]; onSave: (value: ApiDeliverySettings) => Promise<void>; onTest: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<ApiDeliverySettings>(value);
  const [platforms, setPlatforms] = useState<ApiDeliveryPlatform[]>([]);
  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => {
    api.deliveryPlatforms().then(({ providers }) => setPlatforms(providers), failed);
  }, [api, failed, value]);
  const set = (provider: DeliveryProvider, change: Partial<ApiDeliverySettings[DeliveryProvider]>) => setDraft((current) => ({ ...current, [provider]: { ...current[provider], ...change } }));
  // The API's own address: where the platform sends to, which is not always where this console is served from.
  const address = (path: string) => new URL(api.mediaUrl(path), location.href).href;
  const copy = (text: string) => void navigator.clipboard?.writeText(text).then(() => notify(t("dlCopied")), () => undefined);
  const valid = PROVIDERS.every((provider) => Number.isInteger(draft[provider].prepMinutes) && draft[provider].prepMinutes >= 5 && draft[provider].prepMinutes <= 180);

  async function test(provider: DeliveryProvider) {
    try {
      await api.deliveryTestOrder(provider);
      notify(t("dlTestSent"));
      onTest();
    } catch (error) { failed(error); }
  }

  return <details className="settings-card settings-section dl-settings" open={!PROVIDERS.some((provider) => value[provider].enabled)}>
    <summary><h2>{t("dlSettings")}</h2></summary>
    <div className="settings-body editor-form">
    {PROVIDERS.map((provider) => {
      const platform = platforms.find((entry) => entry.id === provider);
      const name = platform?.name ?? (provider === "lieferando" ? "Lieferando" : "foodora");
      return <fieldset key={provider} className="dl-platform" data-provider={provider}>
        <legend>{name}</legend>
        <label className="settings-switch"><input type="checkbox" id={`dlEnabled-${provider}`} checked={draft[provider].enabled} onChange={(event) => set(provider, { enabled: event.target.checked })} /><span>{t("dlEnabled", { name })}</span></label>
        <label className="settings-switch"><input type="checkbox" checked={draft[provider].autoAccept} onChange={(event) => set(provider, { autoAccept: event.target.checked })} /><span>{t("dlAutoAccept")}</span></label>
        <div className="field-grid">
          <label><span>{t("dlPrep")}</span><input type="number" min={5} max={180} value={draft[provider].prepMinutes} onChange={(event) => set(provider, { prepMinutes: Number(event.target.value) })} /></label>
          <label><span>{t("dlStoreId")}</span><input maxLength={64} value={draft[provider].storeId} onChange={(event) => set(provider, { storeId: event.target.value })} /></label>
        </div>
        {platform && <>
          <p className="settings-label">{t("dlConnection")}</p>
          <ul className="dl-connection">
            <li className={platform.webhook ? "ok" : "missing"}>{platform.webhook ? `✓ ${t("dlWebhookOk")}` : `✗ ${t("dlWebhookMissing", { env: WEBHOOK_ENV[provider] })}`}</li>
            <li className={platform.api ? "ok" : "missing"}>{platform.api ? `✓ ${t("dlApiOk")}` : `✗ ${t("dlApiMissing", { env: API_ENV[provider] })}`}</li>
          </ul>
          {[["dlOrdersUrl", platform.ordersPath], ["dlEventsUrl", platform.eventsPath]].map(([label, path]) => <div key={label} className="res-link">
            <label><span>{t(label as CopyKey)}</span><input readOnly value={address(path!)} onFocus={(event) => event.target.select()} /></label>
            <button type="button" className="ghost-action" onClick={() => copy(address(path!))}>{t("dlCopy")}</button>
          </div>)}
        </>}
        <button type="button" className="ghost-action" data-test-order={provider} onClick={() => void test(provider)}>{t("dlTestOrder")}</button>
      </fieldset>;
    })}
    <button type="button" className="primary-action" id="dlSave" disabled={!valid} onClick={() => void onSave(draft)}>{t("dlSave")}</button>
    </div>
  </details>;
}

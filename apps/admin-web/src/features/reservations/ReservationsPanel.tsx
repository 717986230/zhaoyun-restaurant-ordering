import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { AdminApi, ReservationList, StaffRole } from "@zhaoyun/api-client";
import type { ApiMailStatus, ApiReservation, ApiReservationSettings, ApiSettings, ReservationStatus, ReservationUpdateCommand } from "@zhaoyun/contracts";
import { useI18n } from "../../app/i18n";
import type { AdminLanguage, CopyKey } from "../../app/i18n";

interface Props {
  api: AdminApi;
  role: StaffRole | null;
  /** The manager's settings, for the rules; null for the floor staff. */
  settings: ApiSettings | null;
  notify: (message: string, kind?: "success" | "warning" | "error") => void;
  failed: (error: unknown) => void;
  onSaveSettings: (change: Partial<ApiSettings>, done: CopyKey) => Promise<void>;
  /** Changes on the floor, live: the list reloads when it moves. */
  liveTick: number;
}

const DAY_MS = 86_400_000;
const DAY_LABELS: Record<AdminLanguage, string[]> = {
  zh: ["一", "二", "三", "四", "五", "六", "日"],
  en: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
  de: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
};
const LOCALES: Record<AdminLanguage, string> = { zh: "zh-CN", en: "en-GB", de: "de-AT" };
const ACTIVE: ReservationStatus[] = ["pending", "confirmed", "seated"];

function todayIn(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const statusKey = (status: ReservationStatus) => `resStatus_${status}` as CopyKey;

/** What can happen next to a booking, as the floor sees it. */
function nextSteps(status: ReservationStatus): Array<[ReservationStatus, CopyKey, string]> {
  switch (status) {
    case "pending": return [["confirmed", "resConfirm", "primary-action"], ["declined", "resDecline", "ghost-action"]];
    case "confirmed": return [["seated", "resSeat", "primary-action"], ["no_show", "resNoShow", "ghost-action"], ["cancelled", "resCancel", "ghost-action"]];
    case "seated": return [["completed", "resFinish", "ghost-action"]];
    default: return [["confirmed", "resConfirm", "ghost-action"]];
  }
}

/**
 * Table bookings: the day's list for the floor — seat, finish, mark a
 * no-show, give a table — a booking taken by phone, and for the manager the
 * rules the booking page (/book.html) works to.
 */
export function ReservationsPanel({ api, role, settings, notify, failed, onSaveSettings, liveTick }: Props) {
  const { t, language } = useI18n();
  const timeZone = settings?.timeZone ?? "Europe/Vienna";
  const [day, setDay] = useState(() => todayIn(timeZone));
  const [list, setList] = useState<ReservationList | null>(null);
  const [busy, setBusy] = useState(false);
  // The day's list for the floor, or the records across days.
  const [view, setView] = useState<"day" | "records">("day");

  const load = useCallback(async () => {
    try {
      setList(await api.reservations(day, day));
    } catch (error) { failed(error); }
  }, [api, day, failed]);

  useEffect(() => { void load(); }, [load, liveTick]);
  // The net under the live channel.
  useEffect(() => {
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function change(reservation: ApiReservation, command: ReservationUpdateCommand, done: CopyKey = "resSaved") {
    setBusy(true);
    try {
      await api.updateReservation(reservation.id, command);
      notify(t(done));
      await load();
    } catch (error) { failed(error); } finally { setBusy(false); }
  }

  async function erase(reservation: ApiReservation) {
    if (!window.confirm(t("resDeleteConfirm"))) return;
    setBusy(true);
    try {
      await api.deleteReservation(reservation.id);
      notify(t("resDeleted"));
      await load();
    } catch (error) { failed(error); } finally { setBusy(false); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    setBusy(true);
    try {
      const { reservation } = await api.createReservation({
        date: text("date"), time: text("time"), party: Number(text("party")), name: text("name"),
        ...(text("phone") ? { phone: text("phone") } : {}), ...(text("notes") ? { notes: text("notes") } : {}), ...(text("table") ? { table: text("table") } : {})
      });
      notify(t("resCreated"));
      form.reset();
      if (reservation.date !== day) setDay(reservation.date); else await load();
    } catch (error) { failed(error); } finally { setBusy(false); }
  }

  const reservations = list?.reservations ?? [];
  const holding = reservations.filter((reservation) => ACTIVE.includes(reservation.status));
  const guests = holding.reduce((total, reservation) => total + reservation.party, 0);
  const dayLabel = new Intl.DateTimeFormat(LOCALES[language], { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
  const rules = settings?.reservations;

  return <section id="reservationsPanel" className="admin-panel active"><div className="settings-page">
    <div className="list-head">
      <div>
        <h1>{t("resTitle")}</h1>
        
      </div>
    </div>

    {rules && !rules.enabled && <p className="admin-banner res-off" role="note">{t("resOff")}</p>}

    <div className="res-views" role="tablist">
      {(["day", "records"] as const).map((key) => <button key={key} type="button" role="tab" aria-selected={view === key} className={view === key ? "primary-action" : "ghost-action"} onClick={() => setView(key)}>{t(key === "day" ? "resViewDay" : "resViewRecords")}</button>)}
    </div>

    {view === "records" ? <ReservationRecords api={api} timeZone={timeZone} failed={failed} liveTick={liveTick} /> : <>
    <div className="res-day">
      <div className="res-day-nav">
        <button type="button" className="ghost-action" aria-label={t("resPrev")} onClick={() => setDay(shift(day, -1))}>‹</button>
        <button type="button" className={day === todayIn(timeZone) ? "primary-action" : "ghost-action"} onClick={() => setDay(todayIn(timeZone))}>{t("resToday")}</button>
        <button type="button" className="ghost-action" aria-label={t("resNext")} onClick={() => setDay(shift(day, 1))}>›</button>
        <input type="date" aria-label={t("reportDate")} value={day} onChange={(event) => { if (event.target.value) setDay(event.target.value); }} />
      </div>
      <p className="res-summary"><strong>{dayLabel}</strong> · <span id="resSummary">{t("resSummary", { count: holding.length, guests })}</span></p>
    </div>

    {!reservations.length ? <div className="admin-empty">{t("resEmpty")}</div> : <div className="res-list">
      {reservations.map((reservation) => <article key={reservation.id} className={`res-row ${ACTIVE.includes(reservation.status) ? "" : "res-done"}`} data-status={reservation.status} data-reference={reservation.reference}>
        <div className="res-when"><b>{reservation.time}</b><small>{reservation.reference}</small></div>
        <div className="res-who">
          <strong>{reservation.name || "—"} <span className="res-party">· {reservation.party} 👤</span></strong>
          <span className="res-contact">
            {reservation.phone && <a href={`tel:${reservation.phone.replace(/[^+\d]/g, "")}`}>{reservation.phone}</a>}
            {reservation.email && <a href={`mailto:${reservation.email}`}>{reservation.email}</a>}
            {reservation.accountEmail && reservation.accountEmail !== reservation.email && <span title={t("resAccount")}>👤 {reservation.accountEmail}</span>}
          </span>
          {(reservation.guestNoShows ?? 0) > 0 && <em className="res-warn">{t("resNoShows", { n: reservation.guestNoShows ?? 0 })}</em>}
          {reservation.notes && <em className="res-notes">{reservation.notes}</em>}
        </div>
        <div className="res-state">
          <span className={`res-pill res-pill-${reservation.status}`}>{t(statusKey(reservation.status))}</span>
          <small>{t(reservation.source === "online" ? "resOnline" : "resByStaff")}</small>
        </div>
        <form className="res-table" onSubmit={(event) => {
          event.preventDefault();
          const table = String(new FormData(event.currentTarget).get("table") ?? "").trim();
          if (table !== (reservation.table ?? "")) void change(reservation, { table });
        }}>
          <label><span>{t("resTable")}</span><input name="table" maxLength={8} defaultValue={reservation.table ?? ""} key={`${reservation.id}-${reservation.table ?? ""}`} onBlur={(event) => event.currentTarget.form?.requestSubmit()} /></label>
        </form>
        <div className="res-actions">
          {nextSteps(reservation.status).map(([status, label, className]) => <button key={status} type="button" className={className} data-action={status} disabled={busy} onClick={() => void change(reservation, { status })}>{t(label)}</button>)}
          {role === "manager" && <button type="button" className="ghost-action danger" disabled={busy} onClick={() => void erase(reservation)}>{t("resDelete")}</button>}
        </div>
      </article>)}
    </div>}

    <details className="settings-card settings-section res-new">
      <summary><h2>{t("resNew")}</h2></summary>
      <form className="editor-form settings-body" id="resNewForm" onSubmit={(event) => void create(event)}>
        <div className="field-grid three">
          <label><span>{t("reportDate")}</span><input name="date" type="date" required defaultValue={day} key={day} /></label>
          <label><span>{t("resTime")}</span><input name="time" type="time" required step={300} defaultValue="19:00" /></label>
          <label><span>{t("resParty")}</span><input name="party" type="number" min={1} max={500} required defaultValue={2} /></label>
        </div>
        <div className="field-grid">
          <label><span>{t("resName")}</span><input name="name" required maxLength={80} /></label>
          <label><span>{t("resPhone")}</span><input name="phone" type="tel" maxLength={30} /></label>
        </div>
        <div className="field-grid">
          <label><span>{t("resNotes")}</span><input name="notes" maxLength={500} /></label>
          <label><span>{t("resTable")}</span><input name="table" maxLength={8} /></label>
        </div>
        <button type="submit" className="primary-action" disabled={busy}>{t("resCreate")}</button>
      </form>
    </details>
    </>}

    {role === "manager" && <MailCard api={api} notify={notify} failed={failed} />}

    {role === "manager" && rules && <ReservationRules rules={rules} onSave={(reservations) => onSaveSettings({ reservations }, "resSettingsSaved")} notify={notify}
      onImportTables={async () => {
        try {
          // The floor's own tables (not the takeaways), in the waiters' order.
          return (await api.tableOverview()).tables.map((table) => table.table).filter((table) => !/^TA-/i.test(table));
        } catch (error) {
          failed(error);
          return [];
        }
      }} />}
  </div></section>;
}

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
 * The booking records: every booking over a run of days, found by its number,
 * the guest's name, phone or email, by status; each one's record to read or
 * print, and the lot as CSV.
 */
function ReservationRecords({ api, timeZone, failed, liveTick }: { api: AdminApi; timeZone: string; failed: (error: unknown) => void; liveTick: number }) {
  const { t, language } = useI18n();
  const today = todayIn(timeZone);
  const [filter, setFilter] = useState({ from: shift(today, -30), to: shift(today, 60), q: "", status: "" });
  const [list, setList] = useState<ReservationList | null>(null);
  const [open, setOpen] = useState<ApiReservation | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await api.reservations(filter.from, filter.to, { q: filter.q, status: filter.status }));
    } catch (error) { failed(error); }
  }, [api, filter, failed]);
  useEffect(() => { void load(); }, [load, liveTick]);

  const stamp = (iso: string) => new Intl.DateTimeFormat(LOCALES[language], { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
  const records = list?.reservations ?? [];
  const exportCsv = () => downloadCsv(`reservations_${filter.from}_${filter.to}.csv`, [
    [t("resReference"), t("reportDate"), t("resTime"), t("resParty"), t("resTable"), t("resName"), t("resPhone"), t("resEmail"), t("resAccount"), t("resSource"), t("resStatusCol"), t("resNotes"), t("resCreatedAt")],
    ...records.map((record) => [record.reference, record.date, record.time, record.party, record.table ?? "", record.name, record.phone, record.email, record.accountEmail ?? "", record.source, t(statusKey(record.status)), record.notes, record.createdAt])
  ]);

  function print() {
    document.documentElement.classList.add("res-printing");
    const done = () => { document.documentElement.classList.remove("res-printing"); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    window.print();
  }

  return <div className="res-records" id="resRecords">
    <form className="report-dates res-filter" onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      setFilter({ from: String(data.get("from")), to: String(data.get("to")), q: String(data.get("q") ?? "").trim(), status: String(data.get("status") ?? "") });
    }}>
      <label><span>{t("reportFrom")}</span><input name="from" type="date" required defaultValue={filter.from} /></label>
      <label><span>{t("reportTo")}</span><input name="to" type="date" required defaultValue={filter.to} /></label>
      <label className="res-search"><span>{t("resSearch")}</span><input name="q" type="search" maxLength={64} defaultValue={filter.q} id="resSearch" /></label>
      <label><span>{t("resStatusCol")}</span><select name="status" defaultValue={filter.status} id="resStatusFilter">
        <option value="">{t("resAllStatuses")}</option>
        <option value="active">{t("resActiveOnly")}</option>
        {(["pending", "confirmed", "seated", "completed", "cancelled", "declined", "no_show"] as ReservationStatus[]).map((status) => <option key={status} value={status}>{t(statusKey(status))}</option>)}
      </select></label>
      <div className="filter-actions">
        <button type="submit" className="ghost-action">{t("resShow")}</button>
        <button type="button" className="ghost-action" disabled={!records.length} onClick={exportCsv}>⬇ {t("resExport")}</button>
      </div>
    </form>
    <p className="res-summary">{t("resRecordsCount", { count: records.length })}</p>
    {!records.length ? <div className="admin-empty">{t("resEmpty")}</div> : <div className="res-table-wrap"><table className="report-table res-records-table">
      <thead><tr><th>{t("resReference")}</th><th>{t("reportDate")}</th><th>{t("resTime")}</th><th>{t("resParty")}</th><th>{t("resTable")}</th><th>{t("resName")}</th><th>{t("resPhone")}</th><th>{t("resSource")}</th><th>{t("resStatusCol")}</th><th /></tr></thead>
      <tbody>{records.map((record) => <tr key={record.id} data-reference={record.reference}>
        <td className="res-ref">{record.reference}</td><td>{record.date}</td><td>{record.time}</td><td>{record.party}</td><td>{record.table ?? "—"}</td>
        <td>{record.name || "—"}{(record.guestNoShows ?? 0) > 0 ? <em className="res-warn"> ⚠{record.guestNoShows}</em> : null}</td>
        <td>{record.phone || "—"}</td><td>{t(record.source === "online" ? "resOnline" : "resByStaff")}</td>
        <td><span className={`res-pill res-pill-${record.status}`}>{t(statusKey(record.status))}</span></td>
        <td><button type="button" className="ghost-action" onClick={() => setOpen(record)}>{t("resDetail")}</button></td>
      </tr>)}</tbody>
    </table></div>}

    {open && <div className="res-dialog" role="dialog" aria-modal="true" aria-label={t("resDetail")} onClick={(event) => { if (event.target === event.currentTarget) setOpen(null); }}>
      <article className="res-print" id="resRecord">
        <h2>{t("resDetail")} · {open.reference}</h2>
        <dl>
          <dt>{t("reportDate")}</dt><dd>{open.date} {open.time}</dd>
          <dt>{t("resParty")}</dt><dd>{open.party}</dd>
          <dt>{t("resTable")}</dt><dd>{open.table ?? "—"}</dd>
          <dt>{t("resStatusCol")}</dt><dd>{t(statusKey(open.status))}</dd>
          <dt>{t("resName")}</dt><dd>{open.name || "—"}</dd>
          <dt>{t("resPhone")}</dt><dd>{open.phone || "—"}</dd>
          <dt>{t("resEmail")}</dt><dd>{open.email || "—"}</dd>
          <dt>{t("resAccount")}</dt><dd>{open.accountEmail ?? "—"}{(open.guestNoShows ?? 0) > 0 ? ` · ${t("resNoShows", { n: open.guestNoShows ?? 0 })}` : ""}</dd>
          <dt>{t("resSource")}</dt><dd>{t(open.source === "online" ? "resOnline" : "resByStaff")}</dd>
          <dt>{t("resNotes")}</dt><dd>{open.notes || "—"}</dd>
          <dt>{t("resCreatedAt")}</dt><dd>{stamp(open.createdAt)}</dd>
          <dt>{t("resUpdatedAt")}</dt><dd>{stamp(open.updatedAt)}</dd>
        </dl>
        <div className="res-actions res-no-print">
          <button type="button" className="primary-action" onClick={print}>{t("resPrint")}</button>
          <button type="button" className="ghost-action" onClick={() => setOpen(null)}>{t("resClose")}</button>
        </div>
      </article>
    </div>}
  </div>;
}

/** The manager's rules for the booking page. Nothing is saved until "save". */
/**
 * The guests' email codes (shared/mail.mjs): on once Brevo is set up, and a
 * test email the owner sends themselves to see it arrive.
 */
function MailCard({ api, notify, failed }: { api: AdminApi; notify: Props["notify"]; failed: Props["failed"] }) {
  const { t, language } = useI18n();
  const [status, setStatus] = useState<ApiMailStatus | null>(null);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.mailStatus().then(setStatus).catch(() => setStatus(null)); }, [api]);
  if (!status) return null;
  async function sendTest(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.sendTestMail(to.trim(), language);
      notify(t("mailTestSent"));
    } catch (error) {
      failed(error);
    } finally {
      setBusy(false);
    }
  }
  return <details className="settings-card settings-section" id="mailCard">
    <summary><h2>{t("mailTitle")}</h2><span className="settings-summary">{t(status.configured ? "orderingOn" : "orderingOff")}</span></summary>
    <div className="settings-body editor-form">
      <p className={status.configured ? "settings-hint" : "settings-warning"} id="mailStatus">
        {!status.configured ? t("mailOff") : status.provider === "outbox" ? t("mailOutbox") : t("mailOn", { sender: status.sender ?? "" })}
      </p>
      {status.configured ? <form className="res-inline" onSubmit={(event) => void sendTest(event)}>
        <label><span>{t("mailTestTo")}</span><input type="email" required maxLength={254} value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <button type="submit" className="ghost-action" disabled={busy || !to.trim()}>{t("mailTestSend")}</button>
      </form> : null}
    </div>
  </details>;
}

function ReservationRules({ rules, onSave, notify, onImportTables }: { rules: ApiReservationSettings; onSave: (rules: ApiReservationSettings) => Promise<void>; notify: Props["notify"]; onImportTables: () => Promise<string[]> }) {
  const { t, language } = useI18n();
  const [draft, setDraft] = useState<ApiReservationSettings>(rules);
  const [closedDay, setClosedDay] = useState("");
  useEffect(() => { setDraft(rules); }, [rules]);
  const set = <K extends keyof ApiReservationSettings>(key: K, value: ApiReservationSettings[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const setPeriod = (index: number, change: Partial<ApiReservationSettings["hours"][number]>) =>
    set("hours", draft.hours.map((period, at) => (at === index ? { ...period, ...change } : period)));
  const link = `${location.origin}${location.pathname.replace(/[^/]*$/, "")}book.html`;
  const valid = draft.hours.every((period) => period.days.length && period.from < period.to)
    && draft.tables.every((entry) => /^[A-Z0-9][A-Z0-9-]{0,7}$/.test(entry.table) && entry.seats >= 1 && entry.seats <= 50)
    && new Set(draft.tables.map((entry) => entry.table)).size === draft.tables.length;

  return <details className="settings-card settings-section res-rules" open={!rules.enabled}>
    <summary><h2>{t("resSettings")}</h2><span className="settings-summary">{t(rules.enabled ? "orderingOn" : "orderingOff")}</span></summary>
    <div className="settings-body editor-form">
    <label className="settings-switch"><input type="checkbox" id="resEnabled" checked={draft.enabled} onChange={(event) => set("enabled", event.target.checked)} /><span>{t("resEnabled")}</span></label>
    <label className="settings-switch"><input type="checkbox" checked={draft.autoConfirm} onChange={(event) => set("autoConfirm", event.target.checked)} /><span>{t("resAutoConfirm")}</span></label>

    <div className="field-grid three">
      <label><span>{t("resCapacity")}</span><input type="number" id="resCapacity" min={1} max={2000} value={draft.capacity} onChange={(event) => set("capacity", Number(event.target.value))} /></label>
      <label><span>{t("resDuration")}</span><input type="number" min={30} max={360} step={15} value={draft.durationMinutes} onChange={(event) => set("durationMinutes", Number(event.target.value))} /></label>
      <label><span>{t("resInterval")}</span><select value={draft.intervalMinutes} onChange={(event) => set("intervalMinutes", Number(event.target.value) as 15 | 30 | 60)}>
        {[15, 30, 60].map((minutes) => <option key={minutes} value={minutes}>{t("resMinutes", { n: minutes })}</option>)}
      </select></label>
      <label><span>{t("resLeadTime")}</span><input type="number" min={0} max={10080} step={15} value={draft.leadMinutes} onChange={(event) => set("leadMinutes", Number(event.target.value))} /></label>
      <label><span>{t("resDaysAhead")}</span><input type="number" min={1} max={365} value={draft.daysAhead} onChange={(event) => set("daysAhead", Number(event.target.value))} /></label>
    </div>

    <p className="settings-label">{t("resLimits")}</p>
    <div className="field-grid three">
      <label><span>{t("resMaxActive")}</span><input type="number" id="resMaxActive" min={1} max={20} value={draft.maxActivePerGuest} onChange={(event) => set("maxActivePerGuest", Number(event.target.value))} /></label>
      <label><span>{t("resMaxPerDay")}</span><input type="number" min={1} max={10} value={draft.maxPerDayPerGuest} onChange={(event) => set("maxPerDayPerGuest", Number(event.target.value))} /></label>
      <label><span>{t("resNoShowLimit")}</span><input type="number" min={0} max={20} value={draft.noShowLimit} onChange={(event) => set("noShowLimit", Number(event.target.value))} /></label>
    </div>

    <p className="settings-label">{t("resMembership")}</p>
    <div className="field-grid three">
      <label><span>{t("resMinPoints")}</span><input type="number" id="resMinPoints" min={0} max={100000} value={draft.minPoints} onChange={(event) => set("minPoints", Number(event.target.value))} /></label>
      <label><span>{t("resWelcomePoints")}</span><input type="number" id="resWelcomePoints" min={0} max={100000} value={draft.welcomePoints} onChange={(event) => set("welcomePoints", Number(event.target.value))} /></label>
      <label><span>{t("resNoShowPoints")}</span><input type="number" id="resNoShowPoints" min={0} max={100000} value={draft.noShowPoints} onChange={(event) => set("noShowPoints", Number(event.target.value))} /></label>
      <label><span>{t("resNoShowAfter")}</span><input type="number" id="resNoShowAfter" min={0} max={720} step={5} value={draft.noShowAfterMinutes} onChange={(event) => set("noShowAfterMinutes", Number(event.target.value))} /></label>
    </div>

    <p className="settings-label">{t("resHours")}</p>
    {draft.hours.map((period, index) => <div className="res-period" key={index}>
      <div className="schedule-days" role="group">{[1, 2, 3, 4, 5, 6, 7].map((weekday) => <button key={weekday} type="button" className={period.days.includes(weekday) ? "on" : ""} aria-pressed={period.days.includes(weekday)}
        onClick={() => setPeriod(index, { days: period.days.includes(weekday) ? period.days.filter((item) => item !== weekday) : [...period.days, weekday].sort((a, b) => a - b) })}>{DAY_LABELS[language][weekday - 1]}</button>)}</div>
      <input type="time" step={900} value={period.from} aria-label={t("scheduleFrom")} onChange={(event) => setPeriod(index, { from: event.target.value })} />
      <span>–</span>
      <input type="time" step={900} value={period.to} aria-label={t("scheduleTo")} onChange={(event) => setPeriod(index, { to: event.target.value })} />
      <button type="button" className="ghost-action danger" onClick={() => set("hours", draft.hours.filter((_, at) => at !== index))}>{t("resRemove")}</button>
    </div>)}
    <button type="button" className="ghost-action" disabled={draft.hours.length >= 14} onClick={() => set("hours", [...draft.hours, { days: [1, 2, 3, 4, 5, 6, 7], from: "17:30", to: "21:00" }])}>+ {t("resAddPeriod")}</button>

    <p className="settings-label">{t("resClosedDates")}</p>
    <div className="res-closed">
      {draft.closedDates.map((date) => <button key={date} type="button" className="ghost-action" onClick={() => set("closedDates", draft.closedDates.filter((item) => item !== date))}>{date} ×</button>)}
      <input type="date" value={closedDay} onChange={(event) => setClosedDay(event.target.value)} />
      <button type="button" className="ghost-action" disabled={!closedDay} onClick={() => { set("closedDates", [...new Set([...draft.closedDates, closedDay])].sort()); setClosedDay(""); }}>{t("resAddClosed")}</button>
    </div>

    <p className="settings-label">{t("resTables")}</p>
    <div className="res-tables" id="resTables">
      {draft.tables.map((entry, index) => <div className="res-table-row" key={index}>
        <label><span>{t("resTable")}</span><input maxLength={8} value={entry.table} onChange={(event) => set("tables", draft.tables.map((item, at) => (at === index ? { ...item, table: event.target.value.toUpperCase() } : item)))} /></label>
        <label><span>{t("resSeats")}</span><input type="number" min={1} max={50} value={entry.seats} onChange={(event) => set("tables", draft.tables.map((item, at) => (at === index ? { ...item, seats: Number(event.target.value) } : item)))} /></label>
        <button type="button" className="ghost-action danger" onClick={() => set("tables", draft.tables.filter((_, at) => at !== index))}>{t("resRemove")}</button>
      </div>)}
    </div>
    <div className="res-closed">
      <button type="button" className="ghost-action" disabled={draft.tables.length >= 200} onClick={() => set("tables", [...draft.tables, { table: "", seats: 4 }])}>+ {t("resAddTable")}</button>
      <button type="button" className="ghost-action" id="resImportTables" onClick={() => void onImportTables().then((numbers) => {
        const known = new Set(draft.tables.map((entry) => entry.table));
        set("tables", [...draft.tables, ...numbers.filter((number) => !known.has(number)).map((number) => ({ table: number, seats: 4 }))].slice(0, 200));
      })}>{t("resImportTables")}</button>
    </div>

    <label className="res-note-field"><span>{t("resNote")}</span><input maxLength={300} value={draft.note} placeholder={t("resNotePlaceholder")} onChange={(event) => set("note", event.target.value)} /></label>

    <p className="settings-label">{t("resLink")}</p>
    <div className="res-link">
      <input readOnly value={link} id="resLink" onFocus={(event) => event.target.select()} />
      <button type="button" className="ghost-action" onClick={() => void navigator.clipboard?.writeText(link).then(() => notify(t("resCopied")), () => undefined)}>{t("resCopyLink")}</button>
    </div>

    <button type="button" className="primary-action" id="resSaveRules" disabled={!valid} onClick={() => void onSave(draft)}>{t("resSaveSettings")}</button>
    </div>
  </details>;
}

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdminApi } from "@zhaoyun/api-client";
import type { ApiShift, PosStaff } from "@zhaoyun/contracts";
import { useI18n } from "../../app/i18n";

interface Props {
  api: AdminApi;
  notify: (message: string) => void;
  failed: (error: unknown) => void;
}

/** A date as YYYY-MM-DD, read from its UTC parts so the string never drifts a day. */
function isoOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
/** An ISO date's year, month (1–12) and day as numbers. */
function ymd(iso: string): [number, number, number] {
  return [Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10))];
}
function addDays(iso: string, days: number): string {
  const [y, m, d] = ymd(iso);
  return isoOf(new Date(Date.UTC(y, m - 1, d + days)));
}
/** The Monday of the week an ISO date falls in (weeks run Mon–Sun). */
function mondayOf(iso: string): string {
  const [y, m, d] = ymd(iso);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  return addDays(iso, weekday === 0 ? -6 : 1 - weekday);
}
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function toTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
function fromTime(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
function hoursText(minutes: number): string {
  return (minutes / 60).toFixed(minutes % 60 ? 1 : 0);
}

interface Draft { id: string | null; staffId: string; date: string; start: string; end: string; note: string; }

export function RosterPanel({ api, notify, failed }: Props) {
  const { t, language } = useI18n();
  const [staff, setStaff] = useState<PosStaff[]>([]);
  const [shifts, setShifts] = useState<ApiShift[]>([]);
  const [weekStart, setWeekStart] = useState(() => mondayOf(todayIso()));
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const weekEnd = addDays(weekStart, 6);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);

  const load = useCallback(async () => {
    try {
      const [{ staff: list }, { shifts: rostered }] = await Promise.all([api.staffList(), api.shifts(weekStart, weekEnd)]);
      setStaff(list.filter((member) => member.active));
      setShifts(rostered);
    } catch (error) { failed(error); } finally { setLoaded(true); }
  }, [api, failed, weekStart, weekEnd]);
  useEffect(() => { void load(); }, [load]);

  const dayLabels = useMemo(() => new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : language === "de" ? "de-AT" : "en-GB", { weekday: "short", day: "numeric", month: "numeric" }), [language]);
  function dayLabel(iso: string) {
    const [y, m, d] = ymd(iso);
    return dayLabels.format(new Date(Date.UTC(y, m - 1, d)));
  }

  const byStaffDay = useMemo(() => {
    const map = new Map<string, ApiShift[]>();
    for (const shift of shifts) {
      const key = `${shift.staffId}|${shift.date}`;
      (map.get(key) ?? map.set(key, []).get(key)!).push(shift);
    }
    for (const list of map.values()) list.sort((a, b) => a.startMin - b.startMin);
    return map;
  }, [shifts]);

  const weekMinutes = useMemo(() => {
    const map = new Map<string, number>();
    for (const shift of shifts) map.set(shift.staffId, (map.get(shift.staffId) ?? 0) + shift.minutes);
    return map;
  }, [shifts]);

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      const input = { staffId: editing.staffId, date: editing.date, startMin: fromTime(editing.start), endMin: fromTime(editing.end), note: editing.note.trim() };
      if (editing.id) await api.updateShift(editing.id, input); else await api.createShift(input);
      setEditing(null);
      await load();
      notify(t("rosterSaved"));
    } catch (error) { failed(error); } finally { setBusy(false); }
  }

  async function remove(shift: ApiShift) {
    setBusy(true);
    try { await api.deleteShift(shift.id); await load(); notify(t("rosterDeleted")); }
    catch (error) { failed(error); } finally { setBusy(false); }
  }

  const todayOfWeek = todayIso();

  return <section id="rosterPanel" className="admin-panel active"><div className="settings-page">
    <div className="list-head">
      <h1 className="settings-title">{t("rosterTitle")}</h1>
      <p className="settings-hint">{t("rosterHint")}</p>
    </div>

    <div className="roster-weekbar">
      <button type="button" className="ghost-action" onClick={() => setWeekStart(addDays(weekStart, -7))}>← {t("rosterPrevWeek")}</button>
      <span className="roster-weeklabel">{dayLabel(weekStart)} – {dayLabel(weekEnd)}</span>
      <button type="button" className="ghost-action" onClick={() => setWeekStart(mondayOf(todayIso()))}>{t("rosterThisWeek")}</button>
      <button type="button" className="ghost-action" onClick={() => setWeekStart(addDays(weekStart, 7))}>{t("rosterNextWeek")} →</button>
    </div>

    {!loaded ? null : !staff.length ? <div className="admin-empty">{t("rosterNoStaff")}</div> : <div className="roster-grid-wrap"><table className="roster-grid">
      <thead><tr>
        <th className="roster-corner">{t("rosterStaff")}</th>
        {days.map((iso) => <th key={iso} className={iso === todayOfWeek ? "roster-today" : undefined}>{dayLabel(iso)}</th>)}
        <th className="roster-total-head">{t("rosterHours")}</th>
      </tr></thead>
      <tbody>{staff.map((member) => <tr key={member.id}>
        <th scope="row" className="roster-name">{member.name}</th>
        {days.map((iso) => {
          const cell = byStaffDay.get(`${member.id}|${iso}`) ?? [];
          return <td key={iso} className="roster-cell">
            {cell.map((shift) => <div key={shift.id} className="roster-shift">
              <button type="button" className="roster-shift-main" title={t("rosterEdit")} onClick={() => setEditing({ id: shift.id, staffId: shift.staffId, date: shift.date, start: toTime(shift.startMin), end: toTime(shift.endMin), note: shift.note })}>
                <span className="roster-time">{toTime(shift.startMin)}–{toTime(shift.endMin)}{shift.overnight ? " +1" : ""}</span>
                {shift.note && <span className="roster-note">{shift.note}</span>}
              </button>
              <button type="button" className="roster-del" aria-label={t("rosterDelete")} disabled={busy} onClick={() => void remove(shift)}>×</button>
            </div>)}
            <button type="button" className="roster-add" aria-label={t("rosterAdd")} onClick={() => setEditing({ id: null, staffId: member.id, date: iso, start: "09:00", end: "17:00", note: "" })}>＋</button>
          </td>;
        })}
        <td className="roster-total">{weekMinutes.get(member.id) ? t("rosterHoursValue", { h: hoursText(weekMinutes.get(member.id)!) }) : "—"}</td>
      </tr>)}</tbody>
    </table></div>}

    {editing && <div className="res-dialog" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) setEditing(null); }}>
      <div className="res-dialog-card roster-dialog">
        <h2>{editing.id ? t("rosterEditTitle") : t("rosterAddTitle")}</h2>
        <div className="roster-form">
          <label><span>{t("rosterStaff")}</span>
            <select value={editing.staffId} onChange={(event) => setEditing({ ...editing, staffId: event.target.value })}>
              {staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
            </select>
          </label>
          <label><span>{t("rosterDate")}</span><input type="date" value={editing.date} onChange={(event) => setEditing({ ...editing, date: event.target.value })} /></label>
          <label><span>{t("rosterStart")}</span><input type="time" value={editing.start} onChange={(event) => setEditing({ ...editing, start: event.target.value })} /></label>
          <label><span>{t("rosterEnd")}</span><input type="time" value={editing.end} onChange={(event) => setEditing({ ...editing, end: event.target.value })} /></label>
          <label className="roster-note-field"><span>{t("rosterNote")}</span><input value={editing.note} maxLength={120} onChange={(event) => setEditing({ ...editing, note: event.target.value })} placeholder={t("rosterNoteHint")} /></label>
        </div>
        <p className="settings-hint">{t("rosterOvernightHint")}</p>
        <div className="roster-dialog-actions">
          {editing.id && <button type="button" className="ghost-action roster-del-btn" disabled={busy} onClick={() => { const id = editing.id!; setEditing(null); void remove({ id } as ApiShift); }}>{t("rosterDelete")}</button>}
          <button type="button" className="ghost-action" disabled={busy} onClick={() => setEditing(null)}>{t("rosterCancel")}</button>
          <button type="button" className="primary-action" disabled={busy || editing.start === editing.end} onClick={() => void save()}>{t("rosterSave")}</button>
        </div>
      </div>
    </div>}
  </div></section>;
}

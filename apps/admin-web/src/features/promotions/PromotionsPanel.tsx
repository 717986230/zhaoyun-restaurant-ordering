import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdminApi, AdminPromotionInput } from "@zhaoyun/api-client";
import type { ApiPromotion } from "@zhaoyun/contracts";
import { useI18n } from "../../app/i18n";

interface Props {
  api: AdminApi;
  timeZone: string;
  notify: (message: string) => void;
  failed: (error: unknown) => void;
}

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

/** The restaurant's wall clock now: its date, weekday (0=Sun..6=Sat) and minute of day. */
function clockNow(timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** Whether a promotion is live right now, read in the restaurant's time zone (mirrors shared/promotions.mjs). */
function liveNow(promo: ApiPromotion, timeZone: string): boolean {
  if (!promo.enabled) return false;
  const clock = clockNow(timeZone);
  if (promo.activeFrom && clock.date < promo.activeFrom) return false;
  if (promo.activeTo && clock.date > promo.activeTo) return false;
  if (promo.weekdays.length && !promo.weekdays.includes(clock.weekday)) return false;
  if (promo.startMin != null && promo.endMin != null && promo.startMin !== promo.endMin) {
    const within = promo.startMin < promo.endMin
      ? clock.minutes >= promo.startMin && clock.minutes < promo.endMin
      : clock.minutes >= promo.startMin || clock.minutes < promo.endMin;
    if (!within) return false;
  }
  return true;
}

function toTime(minutes: number | null): string {
  if (minutes == null) return "";
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
function fromTime(value: string): number | null {
  if (!value) return null;
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

interface Draft {
  nameZh: string; nameDe: string; nameEn: string;
  percent: number; activeFrom: string; activeTo: string;
  weekdays: number[]; startTime: string; endTime: string;
  priority: number; enabled: boolean;
}

const blankDraft: Draft = { nameZh: "", nameDe: "", nameEn: "", percent: 10, activeFrom: "", activeTo: "", weekdays: [], startTime: "", endTime: "", priority: 0, enabled: true };

function draftOf(promo: ApiPromotion): Draft {
  return {
    nameZh: promo.name.zh, nameDe: promo.name.de, nameEn: promo.name.en, percent: promo.percent,
    activeFrom: promo.activeFrom ?? "", activeTo: promo.activeTo ?? "", weekdays: [...promo.weekdays],
    startTime: toTime(promo.startMin), endTime: toTime(promo.endMin), priority: promo.priority, enabled: promo.enabled
  };
}

export function PromotionsPanel({ api, timeZone, notify, failed }: Props) {
  const { t, language } = useI18n();
  const [promotions, setPromotions] = useState<ApiPromotion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const { promotions: list } = await api.promotions(); setPromotions(list); }
    catch (error) { failed(error); }
    finally { setLoaded(true); }
  }, [api, failed]);
  useEffect(() => { void load(); }, [load]);

  const weekdayLabels = useMemo(() => WEEKDAYS.map((day) => t(`weekday${day}` as never)), [t, language]);

  function nameOf(promo: ApiPromotion) {
    return promo.name[language] || promo.name.zh || promo.name.en || promo.name.de;
  }

  function whenText(promo: ApiPromotion): string {
    const parts: string[] = [];
    if (promo.activeFrom || promo.activeTo) parts.push(`${promo.activeFrom || "…"} → ${promo.activeTo || "…"}`);
    if (promo.weekdays.length) parts.push(promo.weekdays.map((day) => weekdayLabels[day]).join("·"));
    if (promo.startMin != null && promo.endMin != null) parts.push(`${toTime(promo.startMin)}–${toTime(promo.endMin)}`);
    return parts.length ? parts.join(" · ") : t("promoAlways");
  }

  async function save() {
    if (!editing) return;
    const draft = editing.draft;
    const input: AdminPromotionInput = {
      name: { zh: draft.nameZh.trim(), de: draft.nameDe.trim(), en: draft.nameEn.trim() },
      kind: "percent", percent: draft.percent, scope: "order",
      activeFrom: draft.activeFrom || null, activeTo: draft.activeTo || null,
      weekdays: draft.weekdays, startMin: fromTime(draft.startTime), endMin: fromTime(draft.endTime),
      priority: draft.priority, enabled: draft.enabled
    };
    setBusy(true);
    try {
      if (editing.id) await api.updatePromotion(editing.id, input); else await api.createPromotion(input);
      setEditing(null);
      await load();
      notify(t("promoSaved"));
    } catch (error) { failed(error); } finally { setBusy(false); }
  }

  async function toggle(promo: ApiPromotion) {
    setBusy(true);
    try { await api.updatePromotion(promo.id, { ...draftToInput(draftOf(promo)), enabled: !promo.enabled }); await load(); notify(t("promoSaved")); }
    catch (error) { failed(error); } finally { setBusy(false); }
  }

  async function remove(promo: ApiPromotion) {
    if (typeof window !== "undefined" && !window.confirm(t("promoDeleteConfirm", { name: nameOf(promo) }))) return;
    setBusy(true);
    try { await api.deletePromotion(promo.id); await load(); notify(t("promoDeleted")); }
    catch (error) { failed(error); } finally { setBusy(false); }
  }

  function draftToInput(draft: Draft): AdminPromotionInput {
    return {
      name: { zh: draft.nameZh.trim(), de: draft.nameDe.trim(), en: draft.nameEn.trim() },
      kind: "percent", percent: draft.percent, scope: "order",
      activeFrom: draft.activeFrom || null, activeTo: draft.activeTo || null,
      weekdays: draft.weekdays, startMin: fromTime(draft.startTime), endMin: fromTime(draft.endTime),
      priority: draft.priority, enabled: draft.enabled
    };
  }

  const setDraft = (patch: Partial<Draft>) => setEditing((current) => current && { ...current, draft: { ...current.draft, ...patch } });

  return <section id="promoPanel" className="admin-panel active"><div className="settings-page">
    <div className="list-head">
      <h1 className="settings-title">{t("promoTitle")}</h1>
      <p className="settings-hint">{t("promoHint")}</p>
    </div>

    <div className="promo-toolbar">
      <button type="button" className="primary-action" onClick={() => setEditing({ id: null, draft: { ...blankDraft } })}>{t("promoNew")}</button>
    </div>

    {!loaded ? null : !promotions.length ? <div className="admin-empty">{t("promoNone")}</div> : <div className="res-table-wrap"><table className="report-table promo-table">
      <thead><tr><th>{t("promoColName")}</th><th>{t("promoColDiscount")}</th><th>{t("promoColWhen")}</th><th>{t("promoColStatus")}</th><th aria-label={t("promoColActions")}></th></tr></thead>
      <tbody>{promotions.map((promo) => {
        const live = liveNow(promo, timeZone);
        const status = !promo.enabled ? "paused" : live ? "live" : "idle";
        return <tr key={promo.id} data-status={status}>
          <td><b>{nameOf(promo)}</b></td>
          <td className="promo-discount">-{promo.percent}%</td>
          <td className="promo-when">{whenText(promo)}</td>
          <td><span className={`promo-pill promo-${status}`}>{t(status === "paused" ? "promoPaused" : status === "live" ? "promoLive" : "promoIdle")}</span></td>
          <td className="promo-actions">
            <button type="button" className="ghost-action" disabled={busy} onClick={() => setEditing({ id: promo.id, draft: draftOf(promo) })}>{t("promoEdit")}</button>
            <button type="button" className="ghost-action" disabled={busy} onClick={() => void toggle(promo)}>{t(promo.enabled ? "promoPause" : "promoResume")}</button>
            <button type="button" className="ghost-action promo-del" disabled={busy} onClick={() => void remove(promo)}>{t("promoDelete")}</button>
          </td>
        </tr>;
      })}</tbody>
    </table></div>}

    {editing && <div className="res-dialog" role="dialog" aria-modal="true" onClick={(event) => { if (event.target === event.currentTarget) setEditing(null); }}>
      <div className="res-dialog-card promo-dialog">
        <h2>{editing.id ? t("promoEditTitle") : t("promoNew")}</h2>
        <div className="promo-form">
          <label><span>{t("promoNameZh")}</span><input value={editing.draft.nameZh} maxLength={80} onChange={(event) => setDraft({ nameZh: event.target.value })} /></label>
          <label><span>{t("promoNameDe")}</span><input value={editing.draft.nameDe} maxLength={80} onChange={(event) => setDraft({ nameDe: event.target.value })} /></label>
          <label><span>{t("promoNameEn")}</span><input value={editing.draft.nameEn} maxLength={80} onChange={(event) => setDraft({ nameEn: event.target.value })} /></label>
          <label><span>{t("promoPercent")}</span><input type="number" min={1} max={100} inputMode="numeric" value={editing.draft.percent} onChange={(event) => setDraft({ percent: Math.max(1, Math.min(100, Number(event.target.value) || 0)) })} /></label>
          <label><span>{t("promoFrom")}</span><input type="date" value={editing.draft.activeFrom} onChange={(event) => setDraft({ activeFrom: event.target.value })} /></label>
          <label><span>{t("promoTo")}</span><input type="date" value={editing.draft.activeTo} onChange={(event) => setDraft({ activeTo: event.target.value })} /></label>
          <div className="promo-weekdays"><span>{t("promoWeekdays")}</span>
            <div className="promo-days">{WEEKDAYS.map((day) => <button type="button" key={day} className={`promo-day${editing.draft.weekdays.includes(day) ? " on" : ""}`}
              onClick={() => setDraft({ weekdays: editing.draft.weekdays.includes(day) ? editing.draft.weekdays.filter((d) => d !== day) : [...editing.draft.weekdays, day].sort((a, b) => a - b) })}>{weekdayLabels[day]}</button>)}</div>
            <small className="settings-hint">{t("promoWeekdaysHint")}</small>
          </div>
          <label><span>{t("promoStart")}</span><input type="time" value={editing.draft.startTime} onChange={(event) => setDraft({ startTime: event.target.value })} /></label>
          <label><span>{t("promoEnd")}</span><input type="time" value={editing.draft.endTime} onChange={(event) => setDraft({ endTime: event.target.value })} /></label>
          <label><span>{t("promoPriority")}</span><input type="number" min={0} max={1000} inputMode="numeric" value={editing.draft.priority} onChange={(event) => setDraft({ priority: Math.max(0, Math.min(1000, Number(event.target.value) || 0)) })} /></label>
          <label className="promo-enabled"><input type="checkbox" checked={editing.draft.enabled} onChange={(event) => setDraft({ enabled: event.target.checked })} /><span>{t("promoEnabled")}</span></label>
        </div>
        <div className="promo-dialog-actions">
          <button type="button" className="ghost-action" disabled={busy} onClick={() => setEditing(null)}>{t("promoCancel")}</button>
          <button type="button" className="primary-action" disabled={busy} onClick={() => void save()}>{t("promoSave")}</button>
        </div>
      </div>
    </div>}
  </div></section>;
}

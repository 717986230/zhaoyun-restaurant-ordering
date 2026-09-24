import { useState } from "react";
import type { ApiSchedule } from "@zhaoyun/contracts";
import { isOnSchedule } from "../../../../../src/schedule.js";
import { useI18n } from "../../app/i18n";
import type { AdminLanguage, Translate } from "../../app/i18n";

const DAY_LABELS: Record<AdminLanguage, string[]> = {
  zh: ["一", "二", "三", "四", "五", "六", "日"],
  en: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
  de: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
};
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [6, 7];
const PRESETS = [["scheduleWeekdays", WEEKDAYS], ["scheduleWeekend", WEEKEND], ["scheduleEveryDay", EVERY_DAY]] as const;
const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((day, index) => day === b[index]);

/** "工作日 11:00–14:30". */
export function describeSchedule(schedule: ApiSchedule, t: Translate, language: AdminLanguage): string {
  const days = same(schedule.days, EVERY_DAY) ? t("scheduleEveryDay")
    : same(schedule.days, WEEKDAYS) ? t("scheduleWeekdays")
    : same(schedule.days, WEEKEND) ? t("scheduleWeekend")
    : schedule.days.map((day: number) => (language === "zh" ? "周" : "") + DAY_LABELS[language][day - 1]).join(language === "zh" ? "、" : ", ");
  const hours = schedule.from === schedule.to ? t("scheduleAllDay") : `${schedule.from}–${schedule.to}`;
  return `${days} ${hours}`;
}

/**
 * When a page of the menu — the promotions page, the set menus page — is on.
 * Off (the default) is always; on, it is the days and hours given, by the
 * restaurant's clock: outside them the guest menu drops the page and its tab.
 * The rules, past-midnight hours included, are src/schedule.js; this only
 * collects them. Nothing is saved until "save", so a half-set time never
 * reaches a guest; switching off saves at once.
 */
export function ScheduleEditor({ value, timeZone, onSave }: { value: ApiSchedule | null; timeZone: string; onSave: (schedule: ApiSchedule | null) => Promise<void> | void }) {
  const { t, language } = useI18n();
  const [on, setOn] = useState(Boolean(value));
  const [days, setDays] = useState<number[]>(value?.days ?? WEEKDAYS);
  const [from, setFrom] = useState(value?.from ?? "11:00");
  const [to, setTo] = useState(value?.to ?? "14:30");
  const toggleDay = (day: number) => setDays((chosen) => (chosen.includes(day) ? chosen.filter((item) => item !== day) : [...chosen, day].sort((a, b) => a - b)));
  const valid = days.length > 0 && /^\d{2}:\d{2}$/.test(from) && /^\d{2}:\d{2}$/.test(to);
  const draft: ApiSchedule = { days, from, to };
  const saved = value && same(value.days, days) && value.from === from && value.to === to;
  const showingNow = !on || !valid || isOnSchedule(draft, new Date(), timeZone);

  function switchTo(next: boolean) {
    setOn(next);
    // Off is a decision on its own; on waits for the hours.
    if (!next && value) void onSave(null);
  }

  return <div className="schedule-picker">
    <label className="settings-switch">
      <input type="checkbox" checked={on} onChange={(event) => switchTo(event.target.checked)} />
      <span>{t("scheduleOn")}</span>
    </label>
    {on && <>
      <div className="schedule-presets" role="group" aria-label={t("scheduleDays")}>
        {PRESETS.map(([key, preset]) => <button
          key={key} type="button" className={same(days, preset) ? "on" : ""} aria-pressed={same(days, preset)} onClick={() => setDays([...preset])}
        >{t(key)}</button>)}
      </div>
      <div className="schedule-days" role="group" aria-label={t("scheduleDays")}>{EVERY_DAY.map((day) => <button
        key={day} type="button" className={days.includes(day) ? "on" : ""} aria-pressed={days.includes(day)} onClick={() => toggleDay(day)}
      >{DAY_LABELS[language][day - 1]}</button>)}</div>
      <div className="field-grid">
        <label><span>{t("scheduleFrom")}</span><input type="time" step={60} required value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label><span>{t("scheduleTo")}</span><input type="time" step={60} required value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </div>
      <small className="settings-hint">{t("scheduleHint")}</small>
      <p className={`schedule-status ${showingNow ? "live" : ""}`} role="status">
        {valid ? `${describeSchedule(draft, t, language)} · ${t(showingNow ? "scheduleShowingNow" : "scheduleHiddenNow")}` : t("scheduleNoDays")}
      </p>
      <button type="button" className="ghost-action" disabled={!valid || Boolean(saved)} onClick={() => void onSave(draft)}>{saved ? t("scheduleSaved") : t("saveHours")}</button>
    </>}
  </div>;
}

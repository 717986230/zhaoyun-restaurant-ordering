import { useState } from "react";
import type { ProductSchedule } from "@zhaoyun/domain";
import { isOnSchedule, normalizeSchedule } from "../../../../../src/schedule.js";
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
const same = (a: number[], b: number[]) => a.length === b.length && a.every((day, index) => day === b[index]);

/** "工作日 11:00–14:30", for the dish list and the editor alike. */
export function describeSchedule(schedule: ProductSchedule, t: Translate, language: AdminLanguage): string {
  const days = same(schedule.days, EVERY_DAY) ? t("scheduleEveryDay")
    : same(schedule.days, WEEKDAYS) ? t("scheduleWeekdays")
    : same(schedule.days, WEEKEND) ? t("scheduleWeekend")
    : schedule.days.map((day) => (language === "zh" ? "周" : "") + DAY_LABELS[language][day - 1]).join(language === "zh" ? "、" : ", ");
  const hours = schedule.from === schedule.to ? t("scheduleAllDay") : `${schedule.from}–${schedule.to}`;
  return `${days} ${hours}`;
}

/** What the form's hidden field holds, read back for a save; throws with the reason. */
export function readScheduleField(raw: string, t: Translate): ProductSchedule | null {
  if (!raw || raw === "null") return null;
  const value = JSON.parse(raw) as ProductSchedule;
  if (!value.days?.length) throw new Error(t("scheduleNoDays"));
  return normalizeSchedule(value);
}

/**
 * When a dish is on the menu. Off (the default) is always; on, it is the days
 * and hours given, by the restaurant's clock — the guest menu hides the dish
 * outside them and the server refuses to take an order for it. The rules,
 * past-midnight hours included, are src/schedule.js; this only collects them.
 * Its state feeds a hidden input, like the set picker beside it, and resets
 * with the form when another dish is opened.
 */
export function ScheduleFieldset({ schedule, timeZone }: { schedule: ProductSchedule | null; timeZone: string }) {
  const { t, language } = useI18n();
  const [on, setOn] = useState(Boolean(schedule));
  const [days, setDays] = useState<number[]>(schedule?.days ?? WEEKDAYS);
  const [from, setFrom] = useState(schedule?.from ?? "11:00");
  const [to, setTo] = useState(schedule?.to ?? "14:30");
  const current: ProductSchedule | null = on ? { days, from, to } : null;
  const toggleDay = (day: number) => setDays((chosen) => (chosen.includes(day) ? chosen.filter((item) => item !== day) : [...chosen, day].sort((a, b) => a - b)));
  const valid = !on || (days.length > 0 && /^\d{2}:\d{2}$/.test(from) && /^\d{2}:\d{2}$/.test(to));
  const showingNow = !current || !valid || isOnSchedule(current, new Date(), timeZone);

  return <fieldset className="schedule-picker">
    <legend>{t("scheduleLegend")}</legend>
    <input type="hidden" name="schedule" value={JSON.stringify(current)} readOnly />
    <div className="switch-row"><label>
      <input type="checkbox" checked={on} onChange={(event) => setOn(event.target.checked)} />
      <span>{t("scheduleOn")}</span>
    </label></div>
    {on && <>
      <div className="schedule-presets" role="group" aria-label={t("scheduleDays")}>
        {([["scheduleWeekdays", WEEKDAYS], ["scheduleWeekend", WEEKEND], ["scheduleEveryDay", EVERY_DAY]] as const).map(([key, preset]) => <button
          key={key} type="button" className={same(days, [...preset]) ? "on" : ""} aria-pressed={same(days, [...preset])} onClick={() => setDays([...preset])}
        >{t(key)}</button>)}
      </div>
      <div className="schedule-days" role="group" aria-label={t("scheduleDays")}>{EVERY_DAY.map((day) => <button
        key={day} type="button" className={days.includes(day) ? "on" : ""} aria-pressed={days.includes(day)} onClick={() => toggleDay(day)}
      >{DAY_LABELS[language][day - 1]}</button>)}</div>
      <div className="field-grid">
        <label><span>{t("scheduleFrom")}</span><input type="time" step={60} required value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label><span>{t("scheduleTo")}</span><input type="time" step={60} required value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </div>
      <small>{t("scheduleHint")}</small>
      <p className={`schedule-status ${showingNow ? "live" : ""}`} role="status">
        {valid ? `${describeSchedule({ days, from, to }, t, language)} · ${t(showingNow ? "scheduleShowingNow" : "scheduleHiddenNow")}` : t("scheduleNoDays")}
      </p>
    </>}
  </fieldset>;
}

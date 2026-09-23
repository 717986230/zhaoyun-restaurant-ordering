/**
 * When a dish is on the menu: "Mon–Fri, 11:00–14:30" for a lunch set.
 *
 * One module for every side that has to agree on it — the guest menu hides a
 * dish outside its hours, and both backends refuse to take an order for one —
 * so "is it on now?" has exactly one answer. Plain JavaScript, like
 * allergens.js, so the Node server, the Worker and the two apps all import it.
 *
 * A schedule is { days, from, to }:
 *   days  ISO weekdays it starts on, 1 = Monday … 7 = Sunday, at least one;
 *   from  "HH:MM", when it appears;
 *   to    "HH:MM", when it goes. Earlier than `from` runs past midnight
 *         (22:00–02:00 is a late-night menu started on one of `days`); equal
 *         to `from` means all day, for a set that is on only at weekends.
 * No schedule (null) is always on — every dish that has never been given one.
 *
 * The clock is the restaurant's, not the phone's: a tourist's phone still set
 * to home time sees the lunch set when it is lunch in the restaurant.
 */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
export const DEFAULT_TIME_ZONE = "Europe/Vienna";

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutes(time) {
  const [, hours, mins] = TIME.exec(time);
  return Number(hours) * 60 + Number(mins);
}

/** A schedule as stored, or null for "always"; throws on anything else. */
export function normalizeSchedule(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("A schedule must be days and a time range");
  const from = String(value.from ?? "").trim();
  const to = String(value.to ?? "").trim();
  if (!TIME.test(from) || !TIME.test(to)) throw new Error("Schedule times must be HH:MM, 00:00 to 23:59");
  if (!Array.isArray(value.days)) throw new Error("A schedule needs its days");
  const days = [...new Set(value.days.map(Number))].sort((a, b) => a - b);
  if (!days.length) throw new Error("A schedule needs at least one day");
  if (days.some((day) => !WEEKDAYS.includes(day))) throw new Error("Schedule days are 1 (Monday) to 7 (Sunday)");
  return { days, from, to };
}

/** A stored schedule read back leniently: one that no longer checks out is "always", never an error on the menu. */
export function readSchedule(stored) {
  if (!stored) return null;
  try {
    return normalizeSchedule(typeof stored === "string" ? JSON.parse(stored) : stored);
  } catch {
    return null;
  }
}

export function isTimeZone(value) {
  if (typeof value !== "string" || !value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimeZone(value) {
  const zone = String(value ?? "").trim();
  if (!isTimeZone(zone)) throw new Error("Unknown time zone");
  return zone;
}

const formatters = new Map();
const WEEKDAY_NUMBER = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** The weekday (1–7) and minute of the day it is at `date` in `timeZone`; the device's own clock if the zone is unknown. */
export function wallClock(date, timeZone) {
  if (isTimeZone(timeZone)) {
    let format = formatters.get(timeZone);
    if (!format) {
      format = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
      formatters.set(timeZone, format);
    }
    const parts = Object.fromEntries(format.formatToParts(date).map((part) => [part.type, part.value]));
    // Some engines still write midnight as "24" under h23.
    return { day: WEEKDAY_NUMBER[parts.weekday], minute: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
  }
  return { day: date.getDay() || 7, minute: date.getHours() * 60 + date.getMinutes() };
}

/** Whether a dish with this schedule is on the menu at `date`, in the restaurant's time zone. */
export function isOnSchedule(schedule, date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  if (!schedule) return true;
  const { day, minute } = wallClock(date, timeZone);
  const from = minutes(schedule.from);
  const to = minutes(schedule.to);
  const started = (weekday) => schedule.days.includes(weekday);
  if (from === to) return started(day);
  if (from < to) return started(day) && minute >= from && minute < to;
  // Past midnight: the evening part belongs to today, the small hours to yesterday.
  const yesterday = day === 1 ? 7 : day - 1;
  return (started(day) && minute >= from) || (started(yesterday) && minute < to);
}

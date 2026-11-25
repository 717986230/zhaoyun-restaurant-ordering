/**
 * 员工排班 (staff roster): the pure rules for one rostered shift — a date, a
 * time window and an optional note for one waiter. No database, no `node:`
 * anything, so it runs the same on the Node server, on a Worker and in a unit
 * test.
 *
 * A time is a minute of the day, 0 (00:00) to 1439 (23:59). A window whose end
 * is at or before its start runs past midnight into the next day, so a late
 * shift 18:00–02:00 is one entry, not two. The duration follows that wrap.
 */
export const MAX_NOTE = 120;
const DAY_MINUTES = 1440;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A minute of the day, 0–1439. Throws a plain message otherwise. */
function assertMinute(value, field) {
  const minute = Number(value);
  if (!Number.isInteger(minute) || minute < 0 || minute > DAY_MINUTES - 1)
    throw new Error(`${field} is a time of day (00:00–23:59)`);
  return minute;
}

/** A real calendar date in YYYY-MM-DD. Throws otherwise. */
function assertDate(value) {
  const text = String(value ?? "").trim();
  if (!DATE_PATTERN.test(text)) throw new Error("A shift needs a date (YYYY-MM-DD)");
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    throw new Error("A shift needs a real date");
  return text;
}

/**
 * The columns a shift is stored as, cleaned and bounded. Throws a plain
 * message on bad input (a missing staff member, a bad date or time, a zero
 * window).
 */
export function normalizeShift(input) {
  const staffId = String(input?.staffId ?? "").trim();
  if (!staffId) throw new Error("A shift needs a staff member");
  const workDate = assertDate(input?.date);
  const startMin = assertMinute(input?.startMin, "The start");
  const endMin = assertMinute(input?.endMin, "The end");
  if (startMin === endMin) throw new Error("A shift needs a length");
  const note = String(input?.note ?? "").trim().slice(0, MAX_NOTE);
  return { staff_id: staffId, work_date: workDate, start_min: startMin, end_min: endMin, note };
}

/** How long a shift runs, in minutes, following the midnight wrap. */
export function shiftMinutes(startMin, endMin) {
  return ((Number(endMin) - Number(startMin) + DAY_MINUTES) % DAY_MINUTES) || DAY_MINUTES;
}

/** A shift row as the API gives it: times, length and whether it runs overnight. */
export function shiftView(row) {
  return row
    ? {
        id: row.id,
        staffId: row.staff_id,
        date: row.work_date,
        startMin: row.start_min,
        endMin: row.end_min,
        note: row.note ?? "",
        minutes: shiftMinutes(row.start_min, row.end_min),
        overnight: row.end_min <= row.start_min,
      }
    : null;
}

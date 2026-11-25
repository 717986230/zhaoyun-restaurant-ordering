import { parseJson } from "./core.mjs";

/**
 * 营销活动 — the restaurant's own promotions, and the till's rule for which one
 * to apply. Pure functions: the same code runs on the Node server and the
 * Worker, and every test here is a plain in/out check with no database.
 *
 * A promotion is a discount the till offers for the restaurant, the way a
 * member's level already earns one (POS PayScreen, setDiscount). For now one
 * kind, `percent` — a whole-bill percentage off — scoped to the whole order.
 * The window is a date range (`activeFrom`/`activeTo`, inclusive, either end
 * open), the weekdays it runs (`weekdays`, a set of 0=Sun..6=Sat; empty = every
 * day) and a time-of-day band (`startMin`/`endMin`, minutes from midnight; null
 * = all day, and a band that wraps past midnight is allowed). Everything is read
 * in the shop's own time zone, so "Friday, 17:00–19:00" means Friday in Vienna.
 */

export const PROMOTION_KINDS = ["percent"];
export const PROMOTION_SCOPES = ["order"];
const MAX_NAME = 80;

/** A reader of an instant's wall clock in a given time zone: its date, weekday and minute of day. */
export function localClock(timeZone) {
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  });
  return (iso) => {
    const parts = Object.fromEntries(format.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
    const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      // getUTCDay on the local calendar date gives its weekday (0=Sun..6=Sat).
      weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
      minutes: Number(parts.hour) * 60 + Number(parts.minute)
    };
  };
}

/** A minute-of-day band, honouring a window that wraps past midnight (22:00–02:00). */
function inBand(minutes, startMin, endMin) {
  if (startMin == null || endMin == null) return true;
  if (startMin === endMin) return true;
  if (startMin < endMin) return minutes >= startMin && minutes < endMin;
  return minutes >= startMin || minutes < endMin; // wraps midnight
}

/** Whether a promotion is live at this instant, read in the restaurant's time zone. */
export function promotionActive(promo, at, timeZone) {
  if (!promo || !promo.enabled) return false;
  const clock = localClock(timeZone)(at);
  if (promo.activeFrom && clock.date < promo.activeFrom) return false;
  if (promo.activeTo && clock.date > promo.activeTo) return false;
  if (Array.isArray(promo.weekdays) && promo.weekdays.length && !promo.weekdays.includes(clock.weekday)) return false;
  if (!inBand(clock.minutes, promo.startMin ?? null, promo.endMin ?? null)) return false;
  return true;
}

/**
 * The best whole-bill discount the live promotions give, or null. "Best" is the
 * biggest cut on this bill: for a percentage that is simply the highest percent,
 * ties broken by the manager's `priority` then the most recently changed. The
 * returned `percent` goes straight into the existing checkout discount path, and
 * `name` rides along as the discount reason so the receipt and journal say which
 * promotion it was.
 */
export function bestOrderPromotion(promos, { at, timeZone }) {
  const live = (Array.isArray(promos) ? promos : [])
    .filter((promo) => promo.kind === "percent" && promo.scope === "order" && Number(promo.percent) > 0)
    .filter((promo) => promotionActive(promo, at, timeZone));
  if (!live.length) return null;
  live.sort((left, right) =>
    (right.percent - left.percent) ||
    ((right.priority ?? 0) - (left.priority ?? 0)) ||
    String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
  const win = live[0];
  return { id: win.id, name: win.name, percent: win.percent };
}

/** Shape a stored promotion row into the API object. Config is read by kind. */
export function promotionView(row) {
  const config = parseJson(row.config_json, {}) ?? {};
  return {
    id: row.id,
    name: { zh: row.name_zh || "", de: row.name_de || "", en: row.name_en || "" },
    kind: row.kind,
    percent: row.kind === "percent" ? Number(config.percent ?? 0) : 0,
    scope: row.scope,
    category: row.category ?? null,
    activeFrom: row.active_from ?? null,
    activeTo: row.active_to ?? null,
    weekdays: row.weekdays ? String(row.weekdays).split(",").map(Number).filter((day) => day >= 0 && day <= 6) : [],
    startMin: row.start_min ?? null,
    endMin: row.end_min ?? null,
    enabled: !!row.enabled,
    priority: Number(row.priority ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function cleanName(value) { return String(value ?? "").trim().slice(0, MAX_NAME); }
function cleanDate(value) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}
function cleanMinute(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 1439) throw new Error("A time is 00:00 to 23:59");
  return number;
}

/**
 * Validate and normalise what the console sends into the columns to store.
 * Throws a plain message on bad input, the way the store's other writers do.
 */
export function normalizePromotion(input) {
  const kind = String(input.kind ?? "percent");
  if (!PROMOTION_KINDS.includes(kind)) throw new Error("Unknown promotion kind");
  const scope = String(input.scope ?? "order");
  if (!PROMOTION_SCOPES.includes(scope)) throw new Error("Unknown promotion scope");
  const nameZh = cleanName(input.name?.zh), nameDe = cleanName(input.name?.de), nameEn = cleanName(input.name?.en);
  if (!nameZh && !nameDe && !nameEn) throw new Error("A promotion needs a name");

  let config = {};
  if (kind === "percent") {
    const percent = Number(input.percent ?? 0);
    if (!Number.isInteger(percent) || percent < 1 || percent > 100) throw new Error("A discount is 1 to 100 percent");
    config = { percent };
  }

  const from = cleanDate(input.activeFrom), to = cleanDate(input.activeTo);
  if (from && to && from > to) throw new Error("The end date is before the start");
  const weekdays = Array.isArray(input.weekdays)
    ? [...new Set(input.weekdays.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b)
    : [];
  const startMin = cleanMinute(input.startMin), endMin = cleanMinute(input.endMin);
  if ((startMin === null) !== (endMin === null)) throw new Error("A time band needs a start and an end");

  return {
    name_zh: nameZh, name_de: nameDe, name_en: nameEn,
    kind, config_json: JSON.stringify(config), scope,
    category: scope === "order" ? null : (cleanName(input.category) || null),
    active_from: from, active_to: to,
    weekdays: weekdays.join(","),
    start_min: startMin, end_min: endMin,
    enabled: input.enabled === false ? 0 : 1,
    priority: Number.isInteger(Number(input.priority)) ? Number(input.priority) : 0
  };
}

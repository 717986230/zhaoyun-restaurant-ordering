/**
 * Table reservations: what the owner allows, which times a guest may pick,
 * and whether a time still has room.
 *
 * A reservation is kept as the restaurant's own calendar day and wall-clock
 * time ("2026-10-03", "19:30"), never as a UTC instant: a booking for half
 * past seven is half past seven in Vienna whatever the clocks do in between,
 * and the day's list is one lookup by date. "Now" is read in the restaurant's
 * time zone (settings.timeZone).
 *
 * Room is counted in guests, not tables: every booking holds its seats for
 * `durationMinutes`, and a time has room while the most guests seated at any
 * moment of the new booking's stay, the new party included, stays within
 * `capacity`. Which table they get is the floor's decision on the day.
 *
 * Nothing here may import `node:` anything, so it runs unchanged on Workers.
 */
import { normalizeSchedule } from "../src/schedule.js";
import { checkMobile } from "./phone.mjs";

export const RESERVATION_INTERVALS = [15, 30, 60];
export const RESERVATION_STATUSES = ["pending", "confirmed", "seated", "completed", "cancelled", "declined", "no_show"];
/** The bookings that hold seats. */
export const ACTIVE_RESERVATION_STATUSES = ["pending", "confirmed", "seated"];
/** Days after its date that a booking keeps the guest's name, phone, email and note. */
export const RESERVATION_RETENTION_DAYS = 30;
export const MAX_RESERVATION_HOURS = 14;
export const MAX_CLOSED_DATES = 200;

export const RESERVATION_DEFAULTS = {
  enabled: false,
  hours: [
    { days: [1, 2, 3, 4, 5, 6, 7], from: "11:30", to: "14:00" },
    { days: [1, 2, 3, 4, 5, 6, 7], from: "17:30", to: "21:00" }
  ],
  intervalMinutes: 30,
  durationMinutes: 120,
  capacity: 40,
  maxParty: 8,
  leadMinutes: 60,
  daysAhead: 60,
  autoConfirm: true,
  closedDates: [],
  note: "",
  // The tables a guest may pick online, with their seats. Empty: the guest
  // books seats and the floor picks the table on the day (`capacity`).
  tables: [],
  // Against bookings made to be broken: per guest account (and per phone
  // number, so a second account does not get round it), how many bookings
  // still to come at once and how many on one day; and how many no-shows
  // (in NO_SHOW_WINDOW_DAYS) before the guest has to call instead. 0: no limit.
  maxActivePerGuest: 2,
  maxPerDayPerGuest: 1,
  noShowLimit: 2,
  // Booking is for members: a guest books online with at least `minPoints`
  // points (shared/customer.mjs). Their first paid visit brings
  // `welcomePoints`, once; a booking not kept costs `noShowPoints` — marked
  // by the floor, or by itself once `noShowAfterMinutes` past its time
  // without the guest checked in (0: only the floor marks it). 0 points: off.
  minPoints: 10,
  welcomePoints: 10,
  noShowPoints: 5,
  noShowAfterMinutes: 30
};
export const NO_SHOW_WINDOW_DAYS = 180;
export const MAX_BOOKABLE_TABLES = 200;
const TABLE = /^[A-Z0-9][A-Z0-9-]{0,7}$/;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const PHONE = /^\+?[0-9][0-9 ()/.-]{4,28}[0-9]$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LANGUAGES = ["zh", "en", "de"];

export function reservationError(message, code, status = 400, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  Object.assign(error, extra);
  return error;
}

function integer(label, value, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} is ${min} to ${max}`);
  return number;
}

export function isDate(value) {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function toMinutes(time) {
  const [, hours, minutes] = TIME.exec(time);
  return Number(hours) * 60 + Number(minutes);
}

export function toClock(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** ISO weekday, 1 = Monday … 7 = Sunday. */
export function weekdayOf(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
}

/** The restaurant's calendar day and minute of the day at `at`. */
export function localNow(timeZone, at = new Date()) {
  const format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = Object.fromEntries(format.formatToParts(at).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
}

/**
 * The owner's rules as stored. Anything left out keeps its default, so a
 * console that only sends the switch does not wipe the hours.
 */
export function normalizeReservationSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Reservation settings must be an object");
  const input = { ...RESERVATION_DEFAULTS, ...value };
  if (typeof input.enabled !== "boolean") throw new Error("Reservations are switched on or off");
  if (typeof input.autoConfirm !== "boolean") throw new Error("Automatic confirmation is on or off");
  if (!Array.isArray(input.hours)) throw new Error("Reservation hours must be a list");
  if (input.hours.length > MAX_RESERVATION_HOURS) throw new Error(`At most ${MAX_RESERVATION_HOURS} reservation periods`);
  const hours = input.hours.map((range) => {
    const schedule = normalizeSchedule(range);
    if (!schedule) throw new Error("A reservation period needs days and times");
    // The last table is seated by `to`; a period past midnight belongs to the next day's list.
    if (toMinutes(schedule.from) >= toMinutes(schedule.to)) throw new Error("A reservation period ends after it starts, on the same day");
    return schedule;
  });
  const intervalMinutes = Number(input.intervalMinutes);
  if (!RESERVATION_INTERVALS.includes(intervalMinutes)) throw new Error("Reservations are every 15, 30 or 60 minutes");
  if (!Array.isArray(input.closedDates)) throw new Error("Closed days must be a list");
  const closedDates = [...new Set(input.closedDates.map((date) => String(date ?? "").trim()))].sort();
  if (closedDates.some((date) => !isDate(date))) throw new Error("Closed days are dates: YYYY-MM-DD");
  if (closedDates.length > MAX_CLOSED_DATES) throw new Error(`At most ${MAX_CLOSED_DATES} closed days`);
  const note = String(input.note ?? "").trim();
  if (note.length > 300) throw new Error("The reservation note is at most 300 characters");
  if (!Array.isArray(input.tables)) throw new Error("Bookable tables must be a list");
  if (input.tables.length > MAX_BOOKABLE_TABLES) throw new Error(`At most ${MAX_BOOKABLE_TABLES} bookable tables`);
  const tables = [];
  for (const entry of input.tables) {
    const table = String(entry?.table ?? "").trim().toUpperCase();
    if (!TABLE.test(table)) throw new Error("Table number must be 1-8 letters or digits");
    if (tables.some((known) => known.table === table)) throw new Error(`Table ${table} is listed twice`);
    tables.push({ table, seats: integer(`Seats at table ${table}`, entry.seats, 1, 50) });
  }
  return {
    enabled: input.enabled,
    hours,
    intervalMinutes,
    durationMinutes: integer("A table is held for", input.durationMinutes, 30, 360),
    capacity: integer("Seats for reservations", input.capacity, 1, 2000),
    // Kept for settings stored before 2026-10; online, any party books now (ONLINE_MAX_PARTY).
    maxParty: integer("The largest party booked online", input.maxParty, 1, 100),
    leadMinutes: integer("The notice a booking needs, in minutes,", input.leadMinutes, 0, 7 * 24 * 60),
    daysAhead: integer("Bookings open this many days ahead:", input.daysAhead, 1, 365),
    autoConfirm: input.autoConfirm,
    closedDates,
    note,
    tables,
    maxActivePerGuest: integer("Bookings still to come per guest", input.maxActivePerGuest, 1, 20),
    maxPerDayPerGuest: integer("Bookings per guest on one day", input.maxPerDayPerGuest, 1, 10),
    noShowLimit: integer("No-shows before a guest must call", input.noShowLimit, 0, 20),
    minPoints: integer("Points a guest needs to book", input.minPoints, 0, 100_000),
    welcomePoints: integer("Points for a guest's first visit", input.welcomePoints, 0, 100_000),
    noShowPoints: integer("Points a missed booking costs", input.noShowPoints, 0, 100_000),
    noShowAfterMinutes: integer("Minutes before a booking not checked in counts as missed", input.noShowAfterMinutes, 0, 720)
  };
}

/**
 * Why a guest may not book again, or null. `mine` are the guest's bookings
 * (by account, or by the phone number given) that hold seats from today on,
 * as { date }; `noShows` how many times they did not come lately; `points`
 * their balance, against the points a booking needs.
 */
export function guestLimit(rules, date, mine, noShows, points = Infinity) {
  if (rules.minPoints && points < rules.minPoints) {
    return reservationError(`Booking needs ${rules.minPoints} points; you have ${points}`, "NOT_ENOUGH_POINTS", 403, { minPoints: rules.minPoints, points });
  }
  if (rules.noShowLimit && noShows >= rules.noShowLimit) {
    return reservationError("After missed bookings, please call us to book", "NO_SHOW_BLOCKED", 403);
  }
  if (mine.filter((booking) => booking.date === date).length >= rules.maxPerDayPerGuest) {
    return reservationError(`At most ${rules.maxPerDayPerGuest} booking${rules.maxPerDayPerGuest > 1 ? "s" : ""} per day`, "DAY_LIMIT", 409, { limit: rules.maxPerDayPerGuest });
  }
  if (mine.length >= rules.maxActivePerGuest) {
    return reservationError(`At most ${rules.maxActivePerGuest} bookings at once — cancel one to book another`, "TOO_MANY_BOOKINGS", 409, { limit: rules.maxActivePerGuest });
  }
  return null;
}

/** A phone number as digits only, so "+43 660 1 234" and "0043660 1234" meet. */
export function phoneKey(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "").replace(/^00/, "");
  return digits.length >= 6 ? digits.slice(-9) : "";
}

/** Whether the guest picks their table (the owner listed bookable tables). */
export function seatSelection(rules) {
  return rules.tables.length > 0;
}

/** The largest party a guest may type in: online, a party of any size books (2026-10), up to what a booking holds. */
export const ONLINE_MAX_PARTY = 500;

/**
 * Whether this party picks a table: where the owner lists tables and one is
 * big enough. A party larger than every table books seats instead, and the
 * floor puts tables together on the day.
 */
export function picksTable(rules, party) {
  return seatSelection(rules) && rules.tables.some((table) => table.seats >= party);
}

/** Whether `table` is free for a whole stay from `minute`: no booking on it overlaps. */
export function tableFree(bookings, table, minute, duration) {
  return !bookings.some((booking) => booking.table === table && booking.minute < minute + duration && minute < booking.minute + duration);
}

/** The bookable tables at `minute`, each with whether it is free and big enough for `party`. */
export function tablesAt(rules, bookings, minute, party) {
  return rules.tables.map(({ table, seats }) => ({
    table,
    seats,
    available: seats >= party && tableFree(bookings, table, minute, rules.durationMinutes)
  }));
}

/** What the booking page reads: the rules a guest meets, never the capacity. */
export function bookingView(rules, { timeZone, restaurantName, languages }, at = new Date()) {
  const today = localNow(timeZone, at).date;
  return {
    enabled: rules.enabled,
    restaurantName,
    timeZone,
    // The menu's languages, in its flag order: the booking page offers the same.
    ...(Array.isArray(languages) && languages.length ? { languages } : {}),
    // Any party books online: the guest types the number, up to this.
    maxParty: ONLINE_MAX_PARTY,
    today,
    lastDate: addDays(today, rules.daysAhead),
    // Weekdays with any period, so the date picker can grey out the rest.
    days: [...new Set(rules.hours.flatMap((range) => range.days))].sort((a, b) => a - b),
    closedDates: rules.closedDates.filter((date) => date >= today),
    durationMinutes: rules.durationMinutes,
    note: rules.note,
    // The guest picks a table: which there are, and how many sit at each.
    seatSelection: seatSelection(rules),
    tables: rules.tables.map(({ table, seats }) => ({ table, seats })),
    // A guest books signed in, within these.
    signInRequired: true,
    maxActivePerGuest: rules.maxActivePerGuest,
    maxPerDayPerGuest: rules.maxPerDayPerGuest,
    // Booking for members: the points it needs, what the first visit brings, what a missed booking costs.
    minPoints: rules.minPoints,
    welcomePoints: rules.welcomePoints,
    noShowPoints: rules.noShowPoints
  };
}

/** Every time on `date` the owner takes bookings for, in minutes of the day. */
export function slotMinutes(rules, date) {
  if (rules.closedDates.includes(date)) return [];
  const day = weekdayOf(date);
  const minutes = new Set();
  for (const range of rules.hours) {
    if (!range.days.includes(day)) continue;
    for (let minute = toMinutes(range.from); minute <= toMinutes(range.to); minute += rules.intervalMinutes) minutes.add(minute);
  }
  return [...minutes].sort((a, b) => a - b);
}

/** Why a guest may not book `date` at `minute` now, or null: too soon, too far ahead, or in the past. */
export function outsideWindow(rules, date, minute, now) {
  const ahead = daysBetween(now.date, date);
  if (ahead < 0) return "PAST";
  if (ahead > rules.daysAhead) return "TOO_FAR";
  if (ahead * 1440 + minute < now.minute + rules.leadMinutes) return "TOO_SOON";
  return null;
}

/**
 * The most guests seated at any moment of [start, start + duration), from
 * the day's bookings that hold seats ({ minute, party }). The load only rises
 * where a booking starts, so those are the only moments worth counting.
 */
export function peakGuests(bookings, start, duration) {
  const end = start + duration;
  const moments = [start, ...bookings.map((booking) => booking.minute).filter((minute) => minute > start && minute < end)];
  let peak = 0;
  for (const moment of moments) {
    let seated = 0;
    for (const booking of bookings) if (booking.minute <= moment && moment < booking.minute + duration) seated += booking.party;
    peak = Math.max(peak, seated);
  }
  return peak;
}

/**
 * The day's times for a party of `party`: each with whether it can still be
 * booked — some table big enough and free for the whole stay when the guest
 * picks a table, room among the seats otherwise.
 */
export function availability(rules, date, party, bookings, now) {
  // A time already past, or too soon to book online, is not offered at all:
  // "full" is for a time that has no room, not for one that has gone.
  return slotMinutes(rules, date).filter((minute) => !outsideWindow(rules, date, minute, now)).map((minute) => ({
    time: toClock(minute),
    available: (picksTable(rules, party)
      ? tablesAt(rules, bookings, minute, party).some((table) => table.available)
      : peakGuests(bookings, minute, rules.durationMinutes) + party <= rules.capacity)
  }));
}

function text(label, value, max, { required = false } = {}) {
  const clean = String(value ?? "").trim().replace(/\s+/g, " ");
  if (required && !clean) throw reservationError(`${label} is required`, "INVALID");
  if (clean.length > max) throw reservationError(`${label} is at most ${max} characters`, "INVALID");
  return clean;
}

/**
 * A booking as a guest or the staff send it. Any party size; the staff may
 * leave the phone out (a walk-in who booked at the counter); a guest leaves a
 * mobile number or an email the restaurant can reach them at.
 */
export function normalizeReservationInput(input, rules, { staff = false } = {}) {
  const date = String(input.date ?? "").trim();
  if (!isDate(date)) throw reservationError("The date is YYYY-MM-DD", "INVALID");
  const time = String(input.time ?? "").trim();
  if (!TIME.test(time)) throw reservationError("The time is HH:MM", "INVALID");
  const party = Number(input.party);
  if (!Number.isInteger(party) || party < 1 || party > 500) throw reservationError("The party is 1 or more guests", "INVALID");
  const name = text("The name", input.name, 80, { required: true });
  let phone = text("The phone number", input.phone, 30);
  // A guest leaves a mobile number that could be real, written one way
  // (shared/phone.mjs). The staff may write down a landline at the counter.
  const mobile = phone ? checkMobile(phone) : null;
  if (mobile?.ok) phone = mobile.display;
  else if (phone && !staff) throw reservationError(mobile?.reason === "NOT_MOBILE" ? "Please give a mobile number" : "That is not a mobile number", mobile?.reason === "NOT_MOBILE" ? "NOT_MOBILE" : "BAD_PHONE", 400);
  else if (phone && !PHONE.test(phone)) throw reservationError("That is not a phone number", "INVALID");
  const email = text("The email", input.email, 254).toLowerCase();
  if (email && !EMAIL.test(email)) throw reservationError("That is not an email address", "INVALID");
  // A guest leaves a way to be reached: a mobile number or an email, either will do.
  if (!staff && !phone && !email) throw reservationError("Please leave a mobile number or an email", "CONTACT_REQUIRED", 400);
  const notes = text("The note", input.notes, 500);
  const language = LANGUAGES.includes(input.language) ? input.language : "";
  return { date, time, minute: toMinutes(time), party, name, phone, email, notes, language };
}

/** A reservation's short code, for the phone: no 0/O, 1/I/L. */
const REFERENCE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newReference() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((byte) => REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length]).join("");
}

/** What the staff see. */
export function reservationView(row) {
  return {
    id: row.id,
    reference: row.reference,
    date: row.date,
    time: row.time,
    party: row.party,
    name: row.name,
    phone: row.phone,
    email: row.email,
    notes: row.notes,
    status: row.status,
    table: row.table_no || null,
    source: row.source,
    language: row.language || null,
    // The account it was made from; its email and recent no-shows when the query read them.
    customerId: row.customer_id || null,
    ...(row.account_email !== undefined ? { accountEmail: row.account_email || null } : {}),
    ...(row.guest_no_shows !== undefined ? { guestNoShows: Number(row.guest_no_shows) || 0 } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** What the guest holding the booking's link sees: their own booking, their table included, no staff fields. */
export function guestReservationView(row) {
  const { source: _source, customerId: _customer, accountEmail: _email, guestNoShows: _noShows, ...view } = reservationView(row);
  return view;
}

/** Whether a guest may still cancel online: before the time, and only a booking still holding seats. */
export function guestMayCancel(row, now) {
  if (!["pending", "confirmed"].includes(row.status)) return false;
  const ahead = daysBetween(now.date, row.date);
  return ahead * 1440 + toMinutes(row.time) > now.minute;
}

/** Changes the staff make to a booking; only what is sent changes. */
export function normalizeReservationUpdate(input, current) {
  const merged = {
    date: input.date ?? current.date,
    time: input.time ?? current.time,
    party: input.party ?? current.party,
    name: input.name ?? current.name,
    phone: input.phone ?? current.phone,
    email: input.email ?? current.email,
    notes: input.notes ?? current.notes,
    language: current.language
  };
  const clean = normalizeReservationInput(merged, null, { staff: true });
  let status = current.status;
  if (input.status !== undefined) {
    if (!RESERVATION_STATUSES.includes(input.status)) throw reservationError("Unknown reservation status", "INVALID");
    status = input.status;
  }
  const table = input.table !== undefined ? reservationTable(input.table) : current.table_no || "";
  return { ...clean, status, table };
}

/** The table a booking is given, or "" for none yet. */
export function reservationTable(value) {
  const table = String(value ?? "").trim().toUpperCase();
  if (table && !/^[A-Z0-9][A-Z0-9-]{0,7}$/.test(table)) throw reservationError("Table number must be 1-8 letters or digits", "INVALID");
  return table;
}

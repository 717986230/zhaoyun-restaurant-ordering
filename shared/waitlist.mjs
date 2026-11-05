/**
 * The walk-in waitlist: the rules and views, with no database of its own, the
 * way shared/reservations.mjs is to the bookings. The store is
 * shared/waitlist-store.mjs.
 *
 * When every table is full, the floor takes a party's name and size at the
 * door and they wait their turn. A party is `waiting`, then `notified` when a
 * table frees up (and, if they left an email, told so through the same Brevo
 * pipeline as a booking), then `seated` or `left`. There is no capacity or
 * time maths here — the floor decides who to call; this only keeps the queue
 * and its order.
 */
import { checkMobile } from "./phone.mjs";

export const WAITLIST_STATUSES = ["waiting", "notified", "seated", "left"];
/** Still in the queue, shown to the floor. */
export const ACTIVE_WAITLIST_STATUSES = ["waiting", "notified"];

const PHONE = /^\+?[0-9][0-9 ()/.-]{4,28}[0-9]$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LANGUAGES = ["zh", "en", "de"];

export function waitlistError(message, code, status = 400, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  Object.assign(error, extra);
  return error;
}

function text(label, value, max, { required = false } = {}) {
  const trimmed = String(value ?? "").trim();
  if (required && !trimmed) throw waitlistError(`${label} is required`, "INVALID");
  if (trimmed.length > max) throw waitlistError(`${label} is at most ${max} characters`, "INVALID");
  return trimmed;
}

/**
 * A party the floor adds or edits. Taken by the staff at the door, so a
 * landline is allowed where a mobile is not; a mobile written any way is kept
 * one way (shared/phone.mjs). Name and size are all that is required.
 */
export function normalizeWaitlistInput(input) {
  const party = Number(input.party);
  if (!Number.isInteger(party) || party < 1 || party > 500) throw waitlistError("The party is 1 to 500 guests", "INVALID");
  const name = text("The name", input.name, 80, { required: true });
  let phone = text("The phone number", input.phone, 30);
  const mobile = phone ? checkMobile(phone) : null;
  if (mobile?.ok) phone = mobile.display;
  else if (phone && !PHONE.test(phone)) throw waitlistError("That is not a phone number", "INVALID");
  const email = text("The email", input.email, 254).toLowerCase();
  if (email && !EMAIL.test(email)) throw waitlistError("That is not an email address", "INVALID");
  const notes = text("The note", input.notes, 500);
  const language = LANGUAGES.includes(input.language) ? input.language : "";
  return { party, name, phone, email, notes, language };
}

/** What the floor sees: the party, its place in the queue and how long it has waited. */
export function waitlistView(row, { position = null, nowIso = null } = {}) {
  const waited = nowIso && row.created_at ? Math.max(0, Math.round((Date.parse(nowIso) - Date.parse(row.created_at)) / 60_000)) : null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    party: row.party,
    notes: row.notes,
    status: row.status,
    language: row.language || null,
    position,
    waitedMinutes: Number.isFinite(waited) ? waited : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    notifiedAt: row.notified_at || null
  };
}

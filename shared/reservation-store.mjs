/**
 * Table reservations over any SQLite: one implementation for both backends,
 * over the same small driver as the guests' accounts (shared/customer-store.mjs):
 *
 *   first(sql, ...params) → row | null
 *   all(sql, ...params)   → rows
 *   run(sql, ...params)   → number of rows changed
 *
 * The rules are shared/reservations.mjs. `settings()` is the store's own
 * getSettings: the owner's reservation rules, the time zone and the name.
 *
 * A guest books from their account (signed in), and the booking is theirs
 * there and through a link: the id and a secret token only their phone was
 * given (kept here as a hash), the way a session is.
 */
import { hashSessionToken, newSessionToken } from "./auth.mjs";
import { now, uuid } from "./core.mjs";
import { CUSTOMER_BY_ID_SQL, customerView, noShowBackStatements, noShowPointsStatements, welcomeAtCounterStatements } from "./customer.mjs";
import {
  ACTIVE_RESERVATION_STATUSES, addDays, availability, bookingView, guestLimit, guestMayCancel, guestReservationView, isDate, localNow,
  newReference, NO_SHOW_WINDOW_DAYS, normalizeReservationInput, normalizeReservationUpdate, outsideWindow, peakGuests, phoneKey, RESERVATION_RETENTION_DAYS,
  RESERVATION_STATUSES, reservationError, reservationTable, reservationView, seatSelection, slotMinutes, tableFree, tablesAt, toMinutes
} from "./reservations.mjs";

const ACTIVE_SQL = ACTIVE_RESERVATION_STATUSES.map((status) => `'${status}'`).join(", ");
/** The records: a year at a time at most. */
const MAX_LISTED_DAYS = 366;

const INSERT_RESERVATION_SQL = `INSERT INTO reservations
  (id, reference, token_hash, date, time, party, name, phone, email, notes, language, status, table_no, source, customer_id, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** Bookings as the floor sees them: with the account's email and how often that guest did not come lately. */
const LISTED_SQL = `SELECT reservations.*, customers.email AS account_email,
    (SELECT COUNT(*) FROM reservations AS missed WHERE missed.customer_id = reservations.customer_id AND missed.status = 'no_show' AND missed.date >= ?) AS guest_no_shows
  FROM reservations LEFT JOIN customers ON customers.id = reservations.customer_id`;

export function createReservationStore(driver, { settings }) {
  async function context() {
    const current = await settings();
    return { rules: current.reservations, timeZone: current.timeZone, restaurantName: current.restaurantName, now: localNow(current.timeZone) };
  }

  /** The bookings on `date` that hold seats, as { minute, party, table }. */
  async function seatedOn(date, exceptId = "") {
    const rows = await driver.all(`SELECT id, time, party, table_no FROM reservations WHERE date = ? AND status IN (${ACTIVE_SQL})`, date);
    return rows.filter((row) => row.id !== exceptId).map((row) => ({ id: row.id, minute: toMinutes(row.time), party: row.party, table: row.table_no || "" }));
  }

  const byId = (id) => driver.first("SELECT * FROM reservations WHERE id = ?", String(id));

  /**
   * A guest's name, phone, email and note are kept for a month after the
   * day, then blanked: the count of guests and what became of the booking
   * stay, for the owner's own numbers (GDPR Art. 5(1)(e)).
   */
  async function forgetOld(today) {
    await driver.run(
      "UPDATE reservations SET name = '', phone = '', email = '', notes = '', token_hash = NULL WHERE date < ? AND (name != '' OR phone != '' OR email != '' OR notes != '' OR token_hash IS NOT NULL)",
      addDays(today, -RESERVATION_RETENTION_DAYS)
    );
  }

  /**
   * The guest's bookings still to come and their recent no-shows: by their
   * account, and by the phone number they gave, so a second account with the
   * same number does not start afresh.
   */
  async function guestRecord(customerId, phone, today) {
    const key = phoneKey(phone);
    const theirs = (row) => row.customer_id === customerId || (key && phoneKey(row.phone) === key);
    const upcoming = (await driver.all(`SELECT id, date, phone, customer_id FROM reservations WHERE date >= ? AND status IN (${ACTIVE_SQL})`, today)).filter(theirs);
    const missed = (await driver.all("SELECT phone, customer_id FROM reservations WHERE status = 'no_show' AND date >= ?", addDays(today, -NO_SHOW_WINDOW_DAYS))).filter(theirs);
    return { upcoming, noShows: missed.length };
  }

  /**
   * A booking's new status written, with what it does to the guest's points:
   * marked not kept, the points a missed booking costs; taken back from not
   * kept, those given back. One batch, so the two never part.
   */
  async function writeStatus(row, status, rules, extra = []) {
    const at = now();
    const points = row.customer_id && status !== row.status
      ? (status === "no_show" ? noShowPointsStatements(row.id, rules.noShowPoints, at) : row.status === "no_show" ? noShowBackStatements(row.id, at) : [])
      : [];
    await driver.batch([...extra.length ? extra : [["UPDATE reservations SET status = ?, updated_at = ? WHERE id = ? AND status = ?", [status, at, row.id, row.status]]], ...points]);
  }

  /**
   * Bookings gone past their time by `noShowAfterMinutes` without the guest
   * checked in are marked not kept, and cost their points. Only yesterday's
   * and today's: what happened before is the records', not a new penalty.
   * Run whenever the floor or a guest looks, so no timer is needed.
   */
  async function expireMissed(rules, clock) {
    if (!rules.noShowAfterMinutes) return;
    const rows = await driver.all("SELECT * FROM reservations WHERE status IN ('pending', 'confirmed') AND date >= ? AND date <= ?", addDays(clock.date, -1), clock.date);
    for (const row of rows) {
      if (row.date === clock.date && toMinutes(row.time) + rules.noShowAfterMinutes > clock.minute) continue;
      await writeStatus(row, "no_show", rules);
    }
  }

  async function insert(booking, { status, source, tokenHash, customerId = null }) {
    const at = now();
    const id = uuid();
    for (let attempt = 0; ; attempt += 1) {
      try {
        await driver.run(INSERT_RESERVATION_SQL, id, newReference(), tokenHash, booking.date, booking.time, booking.party, booking.name, booking.phone, booking.email, booking.notes, booking.language, status, booking.table || null, source, customerId, at, at);
        return id;
      } catch (error) {
        // Two bookings drew the same six-letter code: draw again.
        if (attempt < 4 && /UNIQUE/i.test(String(error?.message))) continue;
        throw error;
      }
    }
  }

  return {
    /** The rules a guest meets on the booking page. */
    async booking() {
      const { rules, timeZone, restaurantName } = await context();
      return bookingView(rules, { timeZone, restaurantName });
    },

    /**
     * The times on `date` and whether each still has room for `party`; with
     * `time`, and the guest picking a table, the tables at that time too.
     */
    async availability(date, partyInput, timeInput = null) {
      const { rules, timeZone, restaurantName, now: clock } = await context();
      const booking = bookingView(rules, { timeZone, restaurantName });
      if (!rules.enabled) return { booking, date, party: null, slots: [] };
      if (!isDate(date)) throw reservationError("The date is YYYY-MM-DD", "INVALID");
      const party = Number(partyInput ?? 2);
      if (!Number.isInteger(party) || party < 1) throw reservationError("The party is 1 or more guests", "INVALID");
      if (party > rules.maxParty) throw reservationError(`Online bookings are for up to ${rules.maxParty} guests; please call us for a larger party`, "PARTY_TOO_LARGE", 400, { maxParty: rules.maxParty });
      const bookings = await seatedOn(date);
      const slots = availability(rules, date, party, bookings, clock);
      const time = timeInput && slots.some((slot) => slot.time === timeInput) ? timeInput : null;
      return {
        booking, date, party, slots,
        ...(time && seatSelection(rules) ? { time, tables: tablesAt(rules, bookings, toMinutes(time), party).map((table) => ({ ...table, available: table.available && slots.find((slot) => slot.time === time).available })) } : {})
      };
    },

    /**
     * A new booking. From a guest: only at a time the owner offers, far
     * enough ahead, and with room — checked again after it is written, so
     * two guests taking the last seats at once cannot both have them. From
     * the staff: any time and any size, confirmed at once; the floor knows
     * what it can seat.
     */
    async create(input, { staff = false, customer = null } = {}) {
      const { rules, now: clock } = await context();
      if (!staff && !rules.enabled) throw reservationError("Online reservations are not available", "RESERVATIONS_OFF", 403);
      // Online, only from a guest's account: a booking someone has to stand behind.
      if (!staff && !customer) throw reservationError("Please sign in to book a table", "SIGN_IN_REQUIRED", 401);
      const booking = normalizeReservationInput(staff ? input : {
        ...input,
        name: String(input.name ?? "").trim() || customer.name || customer.email.split("@")[0],
        email: String(input.email ?? "").trim() || customer.email
      }, rules, { staff });
      if (staff) booking.table = reservationTable(input.table);
      else {
        // The limits against bookings made to be broken (shared/reservations.mjs, guestLimit).
        await expireMissed(rules, clock);
        const record = await guestRecord(customer.id, booking.phone, clock.date);
        // Booking is for members with points enough: read now, not from the session.
        const balance = Number((await driver.first("SELECT points FROM customers WHERE id = ?", customer.id))?.points ?? 0);
        const limited = guestLimit(rules, booking.date, record.upcoming, record.noShows, balance);
        if (limited) throw limited;
        if (!slotMinutes(rules, booking.date).includes(booking.minute)) throw reservationError("We do not take bookings at that time", "SLOT_UNAVAILABLE", 409);
        const reason = outsideWindow(rules, booking.date, booking.minute, clock);
        if (reason) throw reservationError(reason === "TOO_SOON" ? "That time is too soon to book online; please call us" : "That day cannot be booked", "SLOT_UNAVAILABLE", 409, { reason });
        const bookings = await seatedOn(booking.date);
        if (seatSelection(rules)) {
          // The guest's own pick: one of the bookable tables, big enough, and free for the whole stay.
          booking.table = reservationTable(input.table);
          const chosen = rules.tables.find((entry) => entry.table === booking.table);
          if (!chosen) throw reservationError("Please pick a table", "TABLE_REQUIRED", 400);
          if (chosen.seats < booking.party) throw reservationError(`Table ${chosen.table} seats ${chosen.seats}`, "TABLE_TOO_SMALL", 400);
          if (!tableFree(bookings, chosen.table, booking.minute, rules.durationMinutes)) throw reservationError("That table has just been booked", "TABLE_TAKEN", 409);
        } else if (peakGuests(bookings, booking.minute, rules.durationMinutes) + booking.party > rules.capacity) {
          throw reservationError("That time is fully booked", "SLOT_FULL", 409);
        }
      }
      const token = staff ? null : newSessionToken();
      const id = await insert(booking, {
        status: staff || rules.autoConfirm ? "confirmed" : "pending",
        source: staff ? "staff" : "online",
        tokenHash: token ? await hashSessionToken(token) : null,
        customerId: customer?.id ?? null
      });
      // Checked again once written: two guests taking the last seats, or the same table, at once cannot both have them.
      if (!staff) {
        const others = await seatedOn(booking.date, id);
        const lost = seatSelection(rules)
          // Both written at once: the one with the lower id keeps the table, whichever checks first.
          ? !tableFree(others.filter((other) => other.id < id), booking.table, booking.minute, rules.durationMinutes)
          : peakGuests(await seatedOn(booking.date), booking.minute, rules.durationMinutes) > rules.capacity;
        if (lost) {
          await driver.run("DELETE FROM reservations WHERE id = ?", id);
          throw seatSelection(rules) ? reservationError("That table has just been booked", "TABLE_TAKEN", 409) : reservationError("That time is fully booked", "SLOT_FULL", 409);
        }
      }
      const row = await byId(id);
      return staff ? { reservation: reservationView(row) } : { reservation: guestReservationView(row), token };
    },

    /** The booking behind a guest's link, or null: a wrong token and no booking look the same. */
    async forGuest(id, token) {
      const row = await byId(id);
      if (!row?.token_hash || !token || (await hashSessionToken(token)) !== row.token_hash) return null;
      const { now: clock } = await context();
      return { ...guestReservationView(row), cancellable: guestMayCancel(row, clock) };
    },

    /** The guest's own bookings, from a month back on, newest day first. */
    async forCustomer(customerId) {
      const { now: clock, rules } = await context();
      await expireMissed(rules, clock);
      const rows = await driver.all("SELECT * FROM reservations WHERE customer_id = ? AND date >= ? ORDER BY date DESC, time DESC LIMIT 50", String(customerId), addDays(clock.date, -RESERVATION_RETENTION_DAYS));
      return rows.map((row) => ({ ...guestReservationView(row), cancellable: guestMayCancel(row, clock) }));
    },

    /** Cancelled by the guest: through the link's token, or signed in to the account it was made from. */
    async cancelForGuest(id, token, customerId = null) {
      const row = await byId(id);
      const byAccount = Boolean(customerId && row?.customer_id === customerId);
      if (!row || (!byAccount && (!row.token_hash || !token || (await hashSessionToken(token)) !== row.token_hash))) return null;
      if (row.status === "cancelled") return { ...guestReservationView(row), cancellable: false };
      const { now: clock } = await context();
      if (!guestMayCancel(row, clock)) throw reservationError("This booking can no longer be cancelled online; please call us", "TOO_LATE", 409);
      await driver.run("UPDATE reservations SET status = 'cancelled', updated_at = ? WHERE id = ?", now(), row.id);
      return { ...guestReservationView(await byId(row.id)), cancellable: false };
    },

    /**
     * The staff's list over days (both included), today by default — the
     * day's list and the records alike. `q` finds a booking by its number,
     * the guest's name, phone or email; `status` is one status, or "active"
     * for those still holding seats.
     */
    async list(fromInput, toInput, { q = "", status = "" } = {}) {
      const { now: clock, rules } = await context();
      await forgetOld(clock.date);
      await expireMissed(rules, clock);
      const from = fromInput || clock.date;
      const to = toInput || from;
      if (!isDate(from) || !isDate(to)) throw reservationError("from and to are dates: YYYY-MM-DD", "INVALID");
      if (to < from) throw reservationError("to comes before from", "INVALID");
      if (addDays(from, MAX_LISTED_DAYS) < to) throw reservationError(`At most ${MAX_LISTED_DAYS} days at once`, "INVALID");
      if (status && status !== "active" && !RESERVATION_STATUSES.includes(status)) throw reservationError("Unknown reservation status", "INVALID");
      const search = String(q ?? "").trim().toLowerCase().slice(0, 64);
      const statuses = status === "active" ? ACTIVE_RESERVATION_STATUSES : status ? [status] : RESERVATION_STATUSES;
      const rows = await driver.all(
        `${LISTED_SQL} WHERE reservations.date >= ? AND reservations.date <= ? AND reservations.status IN (${statuses.map(() => "?").join(", ")})
           AND (? = '' OR lower(reservations.reference) LIKE '%' || ? || '%' OR lower(reservations.name) LIKE '%' || ? || '%'
             OR reservations.phone LIKE '%' || ? || '%' OR lower(reservations.email) LIKE '%' || ? || '%' OR lower(COALESCE(customers.email, '')) LIKE '%' || ? || '%')
         ORDER BY reservations.date, reservations.time, reservations.created_at LIMIT 2000`,
        addDays(clock.date, -NO_SHOW_WINDOW_DAYS), from, to, ...statuses, search, search, search, search, search, search
      );
      return { reservations: rows.map(reservationView), today: clock.date, from, to, capacity: rules.capacity, durationMinutes: rules.durationMinutes };
    },

    /** Today's bookings still to come or at the table, for the POS floor. */
    async today() {
      const { now: clock, rules } = await context();
      await expireMissed(rules, clock);
      const rows = await driver.all(`${LISTED_SQL} WHERE reservations.date = ? AND reservations.status IN (${ACTIVE_SQL}) ORDER BY reservations.time, reservations.created_at LIMIT 500`, addDays(clock.date, -NO_SHOW_WINDOW_DAYS), clock.date);
      return rows.map(reservationView);
    },

    async update(id, input) {
      const current = await byId(id);
      if (!current) return null;
      const next = normalizeReservationUpdate(input, current);
      const { now: clock, rules } = await context();
      await writeStatus(current, next.status, rules, [[
        "UPDATE reservations SET date = ?, time = ?, party = ?, name = ?, phone = ?, email = ?, notes = ?, status = ?, table_no = ?, updated_at = ? WHERE id = ?",
        [next.date, next.time, next.party, next.name, next.phone, next.email, next.notes, next.status, next.table || null, now(), current.id]
      ]]);
      return reservationView(await driver.first(`${LISTED_SQL} WHERE reservations.id = ?`, addDays(clock.date, -NO_SHOW_WINDOW_DAYS), current.id));
    },

    /**
     * A member at the counter (the POS scanned the code on their phone):
     * their first visit's bonus, if they never had it. Returns the guest
     * and whether this gave it, or null for no such guest.
     */
    async memberVisit(customerId) {
      const { rules } = await context();
      const before = await driver.first(CUSTOMER_BY_ID_SQL, String(customerId));
      if (!before) return null;
      if (rules.welcomePoints) await driver.batch(welcomeAtCounterStatements(before.id, rules.welcomePoints, now()));
      const after = await driver.first(CUSTOMER_BY_ID_SQL, before.id);
      return { customer: customerView(after), granted: after.points > before.points, welcomePoints: rules.welcomePoints, minPoints: rules.minPoints };
    },

    /** Gone for good: a guest who asks for their data to be erased (GDPR Art. 17). */
    remove: async (id) => (await driver.run("DELETE FROM reservations WHERE id = ?", String(id))) > 0
  };
}

/**
 * The walk-in waitlist over any SQLite: one implementation for both backends,
 * over the same small driver as the bookings (shared/reservation-store.mjs):
 *
 *   first(sql, ...params) → row | null
 *   all(sql, ...params)   → rows
 *   run(sql, ...params)   → number of rows changed
 *
 * The rules and views are shared/waitlist.mjs. The store keeps no mailer: the
 * http layer sends "your table is ready" when `update` reports `justNotified`,
 * the way it sends a booking's confirmation.
 */
import { now, uuid } from "./core.mjs";
import {
  ACTIVE_WAITLIST_STATUSES,
  normalizeWaitlistInput,
  waitlistError,
  waitlistView,
  WAITLIST_STATUSES,
} from "./waitlist.mjs";
import { DEFAULT_TENANT_ID } from "./tenant.mjs";

const ACTIVE_SQL = ACTIVE_WAITLIST_STATUSES.map((status) => `'${status}'`).join(
  ", ",
);
const INSERT_SQL = `INSERT INTO waitlist (tenant_id, id, name, phone, email, party, notes, language, status, created_at, updated_at, notified_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * The tenant this store reads and writes: `options.tenantId`, or the default
 * tenant when none is named — the one all data predating tenants lives under,
 * so a store built without a tenant keeps working exactly as before. Every
 * statement below takes that tenant as its first bound parameter.
 */
export function createWaitlistStore(driver, options = {}) {
  const tenantId = options.tenantId ?? DEFAULT_TENANT_ID;
  const byId = (id) =>
    driver.first(
      "SELECT * FROM waitlist WHERE tenant_id = ? AND id = ?",
      tenantId,
      String(id),
    );

  return {
    /** The queue: every party still waiting or notified, in the order they arrived. */
    async list() {
      const at = now();
      const rows = await driver.all(
        // Arrival order, strictly: two parties added in the same millisecond
        // share a created_at, so the tiebreak must be the monotonic insertion
        // order (rowid), never the random uuid in `id` — otherwise "first in,
        // first in line" flips at random on a fast machine.
        `SELECT * FROM waitlist WHERE tenant_id = ? AND status IN (${ACTIVE_SQL}) ORDER BY created_at, rowid LIMIT 500`,
        tenantId,
      );
      return {
        entries: rows.map((row, index) =>
          waitlistView(row, { position: index + 1, nowIso: at }),
        ),
        waiting: rows.filter((row) => row.status === "waiting").length,
        notified: rows.filter((row) => row.status === "notified").length,
      };
    },

    /** A party joins the queue at the back. */
    async add(input) {
      const entry = normalizeWaitlistInput(input);
      const at = now();
      const id = uuid();
      await driver.run(
        INSERT_SQL,
        tenantId,
        id,
        entry.name,
        entry.phone,
        entry.email,
        entry.party,
        entry.notes,
        entry.language,
        "waiting",
        at,
        at,
        null,
      );
      return { entry: waitlistView(await byId(id), { nowIso: at }) };
    },

    /**
     * A party changed: its details edited, or moved on in the queue. Moving to
     * `notified` the first time stamps the moment and reports `justNotified`,
     * so the http layer can send the "table is ready" email once.
     */
    async update(id, input) {
      const row = await byId(id);
      if (!row) return null;
      if (
        input.status !== undefined &&
        !WAITLIST_STATUSES.includes(input.status)
      )
        throw waitlistError("Unknown waitlist status", "INVALID");
      const status = input.status ?? row.status;
      const merged = normalizeWaitlistInput({
        name: input.name ?? row.name,
        phone: input.phone ?? row.phone,
        email: input.email ?? row.email,
        party: input.party ?? row.party,
        notes: input.notes ?? row.notes,
        language: input.language ?? row.language,
      });
      const at = now();
      const justNotified = status === "notified" && row.status !== "notified";
      const notifiedAt = justNotified ? at : row.notified_at;
      await driver.run(
        "UPDATE waitlist SET name = ?, phone = ?, email = ?, party = ?, notes = ?, language = ?, status = ?, notified_at = ?, updated_at = ? WHERE tenant_id = ? AND id = ?",
        merged.name,
        merged.phone,
        merged.email,
        merged.party,
        merged.notes,
        merged.language,
        status,
        notifiedAt,
        at,
        tenantId,
        row.id,
      );
      return {
        entry: waitlistView(await byId(id), { nowIso: at }),
        justNotified,
      };
    },

    /** Gone for good: a party added by mistake, or one the floor clears out. */
    remove: async (id) =>
      (await driver.run(
        "DELETE FROM waitlist WHERE tenant_id = ? AND id = ?",
        tenantId,
        String(id),
      )) > 0,
  };
}

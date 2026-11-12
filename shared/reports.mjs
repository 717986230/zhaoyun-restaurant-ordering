/**
 * The manager's sales report over any run of days: what the day closings add
 * up to, and what they do not show — which dishes sold, at what hours, by
 * which waiter.
 *
 * Built from the receipts alone, the register's fiscal record, so it agrees
 * with the Z reports to the cent: a storno carries every line negated, and
 * summing receipts nets it out. Days and hours are the restaurant's own
 * (settings.timeZone), not UTC: a Friday is a Friday in Vienna.
 *
 * Nothing here may import `node:` anything, so it runs unchanged on Workers.
 */
import { parseJson } from "./core.mjs";
import { closingTotals } from "./register.mjs";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_REPORT_DAYS = 366;

function reportError(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = "BAD_RANGE";
  return error;
}

/**
 * `from` and `to` as the manager picks them: calendar days, both included.
 * Returns the UTC window to read receipts from — a day wider on each side,
 * since a day in Vienna starts before or after one in UTC — and the days.
 */
export function reportRange(fromInput, toInput) {
  const from = String(fromInput ?? "");
  const to = String(toInput ?? "");
  if (!DATE.test(from) || !DATE.test(to)) throw reportError("from and to are dates: YYYY-MM-DD");
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) throw reportError("Not a date");
  if (end < start) throw reportError("to comes before from");
  const days = Math.round((end - start) / 86_400_000) + 1;
  if (days > MAX_REPORT_DAYS) throw reportError(`At most ${MAX_REPORT_DAYS} days at once`);
  return {
    from,
    to,
    days,
    readFrom: new Date(start - 86_400_000).toISOString(),
    readTo: new Date(end + 2 * 86_400_000).toISOString()
  };
}

/** A moment as the restaurant's calendar day and hour. */
function localParts(timeZone) {
  const format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  return (iso) => {
    const parts = Object.fromEntries(format.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
  };
}

/** Every day from `from` to `to`, so a day with no sales shows as a zero, not a gap. */
function eachDay(from, days) {
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: days }, (_, index) => new Date(start + index * 86_400_000).toISOString().slice(0, 10));
}

/**
 * The report. `rows` are receipt rows read over `range.readFrom`–`readTo`;
 * the ones outside the manager's days (in the restaurant's time zone) are
 * dropped here.
 */
export function salesReport(rows, range, timeZone) {
  const local = localParts(timeZone);
  const inRange = [];
  for (const row of rows) {
    const at = local(row.created_at);
    if (at.date >= range.from && at.date <= range.to) inRange.push({ row, at });
  }
  const totals = closingTotals(inRange.map(({ row }) => row));

  const byDay = new Map(eachDay(range.from, range.days).map((date) => [date, { date, receipts: 0, grossCents: 0 }]));
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, receipts: 0, grossCents: 0 }));
  const byItem = new Map();
  const byStaff = new Map();
  for (const { row, at } of inRange) {
    // A storno takes its sale back out of the count as well as the money.
    const count = row.type === "storno" ? -1 : 1;
    const day = byDay.get(at.date);
    day.receipts += count;
    day.grossCents += row.total_cents;
    byHour[at.hour].receipts += count;
    byHour[at.hour].grossCents += row.total_cents;

    const staffName = row.staff_name || "";
    const staff = byStaff.get(staffName) ?? { name: staffName, receipts: 0, grossCents: 0, tipsCents: 0 };
    staff.receipts += count;
    staff.grossCents += row.total_cents;
    // Each waiter's tips, for the owner who pays out the card tips.
    for (const payment of parseJson(row.payments_json, [])) staff.tipsCents += payment.tipCents ?? 0;
    byStaff.set(staffName, staff);

    for (const line of parseJson(row.lines_json, [])) {
      if (line.kind !== "item") continue;
      // One dish, whatever the language it was rung up in.
      const key = line.names?.de || line.name;
      const item = byItem.get(key) ?? { name: line.name, names: line.names ?? null, quantity: 0, grossCents: 0 };
      item.quantity += line.quantity;
      item.grossCents += line.totalCents;
      byItem.set(key, item);
    }
  }

  const netSales = totals.sales - totals.stornos;
  return {
    from: range.from,
    to: range.to,
    timeZone,
    totals: { ...totals, receipts: netSales, averageCents: netSales > 0 ? Math.round(totals.grossCents / netSales) : 0 },
    days: [...byDay.values()],
    hours: byHour,
    items: [...byItem.values()].filter((item) => item.quantity !== 0 || item.grossCents !== 0).sort((left, right) => right.grossCents - left.grossCents || right.quantity - left.quantity),
    staff: [...byStaff.values()].sort((left, right) => right.grossCents - left.grossCents)
  };
}

export const REPORT_RECEIPTS_SQL = "SELECT * FROM receipts WHERE created_at >= ? AND created_at < ? ORDER BY receipt_no";

/**
 * 会员数据看板 (member analytics). Read-only: built from the customers table
 * and the two member ledgers (points_ledger, balance_ledger), never writing a
 * line. Scalar "as of now" figures (how many members, balance and points
 * outstanding, the top members) come pre-shaped from SQL; the "over the days"
 * figures are summed here from ledger rows read over the wide window, dropping
 * the ones outside the manager's days in the restaurant's own time zone — the
 * same local-day rule the sales report uses.
 *
 * `data` carries:
 *  - totals:   { members, points, balanceCents } — counts across all members now.
 *  - newMembers:   [{ created_at }]            — accounts opened in the window.
 *  - balanceLedger:[{ customer_id, delta_cents, reason, created_at }]
 *  - pointsLedger: [{ customer_id, delta_cents, created_at }]
 *  - topBalance / topPoints: already ordered and capped by SQL.
 */
export function memberReport(data, range, timeZone) {
  const local = localParts(timeZone);
  const inDays = (iso) => {
    const date = local(iso).date;
    return date >= range.from && date <= range.to;
  };

  let newMembers = 0;
  for (const row of data.newMembers ?? []) if (inDays(row.created_at)) newMembers += 1;

  // Over the days: top-up principal, the house's bonus, and balance spent.
  let topUpCents = 0;
  let bonusCents = 0;
  let spentCents = 0;
  for (const row of data.balanceLedger ?? []) {
    if (!inDays(row.created_at)) continue;
    const delta = row.delta_cents ?? 0;
    if (row.reason === "topup") topUpCents += delta;
    else if (row.reason === "bonus") bonusCents += delta;
    else if (row.reason === "spend") spentCents += -delta;
  }

  // Over the days: points earned (delta > 0) and redeemed (delta < 0).
  let earned = 0;
  let redeemed = 0;
  for (const row of data.pointsLedger ?? []) {
    if (!inDays(row.created_at)) continue;
    const delta = row.delta_cents ?? 0;
    if (delta > 0) earned += delta;
    else redeemed += -delta;
  }

  // 活跃 / 复购: a member counts as active on a day they earned points or spent
  // balance. Active members are the distinct ones; repeat members are those
  // active on two or more days in the window.
  const daysByMember = new Map();
  const note = (customerId, iso) => {
    if (!customerId || !inDays(iso)) return;
    const set = daysByMember.get(customerId) ?? new Set();
    set.add(local(iso).date);
    daysByMember.set(customerId, set);
  };
  for (const row of data.pointsLedger ?? []) if ((row.delta_cents ?? 0) > 0) note(row.customer_id, row.created_at);
  for (const row of data.balanceLedger ?? []) if (row.reason === "spend") note(row.customer_id, row.created_at);
  let repeatBuyers = 0;
  for (const set of daysByMember.values()) if (set.size >= 2) repeatBuyers += 1;
  const buyers = daysByMember.size;

  const totals = data.totals ?? {};
  return {
    from: range.from,
    to: range.to,
    timeZone,
    members: { total: totals.members ?? 0, new: newMembers, active: buyers },
    balance: { outstandingCents: totals.balanceCents ?? 0, topUpCents, bonusCents, spentCents },
    points: { outstanding: totals.points ?? 0, earned, redeemed },
    repeat: { buyers, repeatBuyers, ratePct: buyers > 0 ? Math.round((repeatBuyers / buyers) * 100) : 0 },
    topBalance: (data.topBalance ?? []).map((row) => ({ id: row.id, name: row.name || "", email: row.email || "", balanceCents: row.balance_cents ?? 0 })),
    topPoints: (data.topPoints ?? []).map((row) => ({ id: row.id, name: row.name || "", email: row.email || "", points: row.points ?? 0 }))
  };
}

/** The member ledgers over the wide window, read for memberReport (store.mjs). */
export const MEMBER_BALANCE_LEDGER_SQL = "SELECT customer_id, delta_cents, reason, created_at FROM balance_ledger WHERE created_at >= ? AND created_at < ?";
export const MEMBER_POINTS_LEDGER_SQL = "SELECT customer_id, delta_cents, created_at FROM points_ledger WHERE created_at >= ? AND created_at < ?";
export const MEMBER_NEW_SQL = "SELECT created_at FROM customers WHERE created_at >= ? AND created_at < ?";
export const MEMBER_TOP_BALANCE_SQL = "SELECT c.id, c.name, c.email, mb.balance_cents FROM member_balances mb JOIN customers c ON c.id = mb.customer_id WHERE mb.balance_cents > 0 ORDER BY mb.balance_cents DESC, c.created_at ASC LIMIT 10";
export const MEMBER_TOP_POINTS_SQL = "SELECT id, name, email, points FROM customers WHERE points > 0 ORDER BY points DESC, created_at ASC LIMIT 10";

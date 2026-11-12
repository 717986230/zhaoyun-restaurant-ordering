import assert from "node:assert/strict";
import test from "node:test";
import { memberReport, reportRange } from "../../shared/reports.mjs";

/**
 * 会员数据看板 (shared/reports.mjs, memberReport). Pure aggregation over the
 * two member ledgers and the customers table — no database. We check that the
 * "over the days" sums respect the restaurant's local day, that reasons are
 * summed into the right buckets, and that the repeat rate counts members
 * active on two or more days.
 */

const TZ = "Europe/Vienna";
// A one-day window: 2026-06-01 in Vienna is 2026-05-31T22:00Z .. 2026-06-01T22:00Z.
const range = reportRange("2026-06-01", "2026-06-01");

test("sums top-ups, bonus and spend over the local day, and leaves out-of-day rows out", () => {
  const data = {
    totals: { members: 10, points: 1234, balanceCents: 50000 },
    newMembers: [
      { created_at: "2026-06-01T09:00:00.000Z" }, // in the day
      { created_at: "2026-05-31T20:00:00.000Z" }  // still 31 May in Vienna → out
    ],
    balanceLedger: [
      { customer_id: "a", delta_cents: 10000, reason: "topup", created_at: "2026-06-01T09:00:00.000Z" },
      { customer_id: "a", delta_cents: 1000, reason: "bonus", created_at: "2026-06-01T09:00:00.000Z" },
      { customer_id: "b", delta_cents: -2500, reason: "spend", created_at: "2026-06-01T18:00:00.000Z" },
      // 2026-05-31T21:00Z is 23:00 on 31 May in Vienna → out of the day, not summed.
      { customer_id: "c", delta_cents: 9999, reason: "topup", created_at: "2026-05-31T21:00:00.000Z" }
    ],
    pointsLedger: [],
    topBalance: [{ id: "a", name: "Anna", email: "a@x", balance_cents: 30000 }],
    topPoints: [{ id: "b", name: "", email: "b@x", points: 900 }]
  };
  const report = memberReport(data, range, TZ);
  assert.equal(report.members.total, 10);
  assert.equal(report.members.new, 1, "only the row inside the Vienna day counts");
  assert.equal(report.balance.outstandingCents, 50000);
  assert.equal(report.balance.topUpCents, 10000, "the out-of-day top-up is excluded");
  assert.equal(report.balance.bonusCents, 1000);
  assert.equal(report.balance.spentCents, 2500, "spend is stored as a positive amount");
  assert.equal(report.points.outstanding, 1234);
  assert.deepEqual(report.topBalance[0], { id: "a", name: "Anna", email: "a@x", balanceCents: 30000 });
  assert.deepEqual(report.topPoints[0], { id: "b", name: "", email: "b@x", points: 900 });
});

test("points earned and redeemed split by the sign of the delta", () => {
  const data = {
    totals: { members: 3, points: 0, balanceCents: 0 },
    pointsLedger: [
      { customer_id: "a", delta: 50, created_at: "2026-06-01T10:00:00.000Z" },
      { customer_id: "a", delta: -20, created_at: "2026-06-01T11:00:00.000Z" },
      { customer_id: "b", delta: 30, created_at: "2026-06-01T12:00:00.000Z" }
    ],
    balanceLedger: []
  };
  const report = memberReport(data, range, TZ);
  assert.equal(report.points.earned, 80);
  assert.equal(report.points.redeemed, 20);
});

test("repeat rate counts members active on two or more days", () => {
  // A three-day window so members can be active on more than one day.
  const wide = reportRange("2026-06-01", "2026-06-03");
  const data = {
    totals: { members: 2, points: 0, balanceCents: 0 },
    balanceLedger: [
      { customer_id: "loyal", delta_cents: -100, reason: "spend", created_at: "2026-06-01T10:00:00.000Z" },
      { customer_id: "loyal", delta_cents: -100, reason: "spend", created_at: "2026-06-03T10:00:00.000Z" },
      { customer_id: "once", delta_cents: -100, reason: "spend", created_at: "2026-06-02T10:00:00.000Z" }
    ],
    pointsLedger: [
      // Same member, same day as a spend: still one active day, not two.
      { customer_id: "loyal", delta: 10, created_at: "2026-06-01T11:00:00.000Z" }
    ]
  };
  const report = memberReport(data, wide, TZ);
  assert.equal(report.members.active, 2, "both members were active at least once");
  assert.equal(report.repeat.buyers, 2);
  assert.equal(report.repeat.repeatBuyers, 1, "only the member active on two days repeats");
  assert.equal(report.repeat.ratePct, 50);
});

test("an empty period gives zeroes, not a crash", () => {
  const report = memberReport({ totals: { members: 0, points: 0, balanceCents: 0 } }, range, TZ);
  assert.equal(report.members.total, 0);
  assert.equal(report.repeat.ratePct, 0);
  assert.deepEqual(report.topBalance, []);
  assert.deepEqual(report.topPoints, []);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSegment, matchesSegment, monthOf } from "../../shared/segments.mjs";

const TIERS = {
  enabled: true,
  tiers: [
    { name: "银", level: 1, thresholdCents: 10000, discountPercent: 3 },
    { name: "金", level: 2, thresholdCents: 50000, discountPercent: 5 },
  ],
};

test("an empty segment is everyone", () => {
  assert.deepEqual(normalizeSegment({}), {});
  assert.equal(matchesSegment({ points: 0 }, {}, {}), true);
});

test("normalize keeps only the conditions that were set, bounded", () => {
  const segment = normalizeSegment({
    tiers: ["金", "金", " "],
    minPoints: 100,
    minBalanceCents: 0,
    joinedWithinDays: 0,
    inactiveDays: 30,
    birthdayThisMonth: true,
  });
  assert.deepEqual(segment, { tiers: ["金"], minPoints: 100, inactiveDays: 30, birthdayThisMonth: true });
});

test("a value out of range is refused", () => {
  assert.throws(() => normalizeSegment({ minPoints: -1 }), /out of range/);
  assert.throws(() => normalizeSegment({ minBalanceCents: 100000001 }), /out of range/);
});

test("tier condition matches the member's computed level", () => {
  const gold = { growthCents: 60000 };
  const silver = { growthCents: 20000 };
  const none = { growthCents: 0 };
  const opts = { memberTiers: TIERS };
  assert.equal(matchesSegment(gold, { tiers: ["金"] }, opts), true);
  assert.equal(matchesSegment(silver, { tiers: ["金"] }, opts), false);
  assert.equal(matchesSegment(silver, { tiers: ["银", "金"] }, opts), true);
  assert.equal(matchesSegment(none, { tiers: ["银"] }, opts), false);
});

test("points, balance and lifetime are floors", () => {
  assert.equal(matchesSegment({ points: 120 }, { minPoints: 100 }, {}), true);
  assert.equal(matchesSegment({ points: 80 }, { minPoints: 100 }, {}), false);
  assert.equal(matchesSegment({ balanceCents: 5000 }, { minBalanceCents: 5000 }, {}), true);
  assert.equal(matchesSegment({ growthCents: 9000 }, { minLifetimeCents: 10000 }, {}), false);
});

test("birthday-this-month uses the restaurant's time zone", () => {
  const at = new Date("2026-03-15T00:00:00Z");
  assert.equal(monthOf(at, "UTC"), 3);
  assert.equal(matchesSegment({ birthMonth: 3 }, { birthdayThisMonth: true }, { at, timeZone: "UTC" }), true);
  assert.equal(matchesSegment({ birthMonth: 4 }, { birthdayThisMonth: true }, { at, timeZone: "UTC" }), false);
  assert.equal(matchesSegment({ birthMonth: null }, { birthdayThisMonth: true }, { at, timeZone: "UTC" }), false);
});

test("joined-within-days is a recent-signup window", () => {
  const at = new Date("2026-03-15T12:00:00Z");
  const recent = { createdAt: "2026-03-10T00:00:00Z" };
  const old = { createdAt: "2026-01-01T00:00:00Z" };
  assert.equal(matchesSegment(recent, { joinedWithinDays: 30 }, { at }), true);
  assert.equal(matchesSegment(old, { joinedWithinDays: 30 }, { at }), false);
});

test("inactive-days picks members with no recent order, including those who never ordered", () => {
  const at = new Date("2026-03-15T12:00:00Z");
  const quiet = { lastOrderAt: "2026-01-01T00:00:00Z" };
  const active = { lastOrderAt: "2026-03-14T00:00:00Z" };
  const never = { lastOrderAt: null };
  assert.equal(matchesSegment(quiet, { inactiveDays: 30 }, { at }), true);
  assert.equal(matchesSegment(active, { inactiveDays: 30 }, { at }), false);
  assert.equal(matchesSegment(never, { inactiveDays: 30 }, { at }), true);
});

test("all conditions must hold together (AND)", () => {
  const at = new Date("2026-03-15T12:00:00Z");
  const member = { growthCents: 60000, points: 200, birthMonth: 3, createdAt: "2026-03-10T00:00:00Z", lastOrderAt: null };
  const segment = { tiers: ["金"], minPoints: 100, birthdayThisMonth: true, joinedWithinDays: 30 };
  assert.equal(matchesSegment(member, segment, { at, memberTiers: TIERS, timeZone: "UTC" }), true);
  assert.equal(matchesSegment({ ...member, points: 50 }, segment, { at, memberTiers: TIERS, timeZone: "UTC" }), false);
});

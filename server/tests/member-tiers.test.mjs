import assert from "node:assert/strict";
import test from "node:test";
import { memberTierFor, membershipStatus, normalizeMemberTiers } from "../../shared/customer.mjs";

/**
 * 会员等级 + 会员价 (shared/customer.mjs). Levels are reached by lifetime
 * top-up; a member sits at the highest level their top-ups have passed, and
 * that level's discount is the 会员价 the till offers. The level is derived,
 * never stored.
 */

test("normalizeMemberTiers sorts by threshold and rejects bad input", () => {
  const value = normalizeMemberTiers({
    enabled: true,
    tiers: [
      { name: "金卡", thresholdCents: 50000, discountPercent: 10 },
      { name: "银卡", thresholdCents: 10000, discountPercent: 5 }
    ]
  });
  assert.equal(value.enabled, true);
  assert.deepEqual(value.tiers.map((tier) => tier.name), ["银卡", "金卡"], "sorted ascending by threshold");
  assert.throws(() => normalizeMemberTiers({ enabled: true, tiers: [{ name: "", thresholdCents: 100, discountPercent: 5 }] }), /name/);
  assert.throws(() => normalizeMemberTiers({ enabled: true, tiers: [{ name: "x", thresholdCents: 100, discountPercent: 101 }] }), /discount/);
  assert.throws(() => normalizeMemberTiers({ enabled: true, tiers: [{ name: "a", thresholdCents: 100, discountPercent: 1 }, { name: "b", thresholdCents: 100, discountPercent: 2 }] }), /tier once/);
});

test("a threshold of zero is a valid base tier", () => {
  const value = normalizeMemberTiers({ enabled: true, tiers: [{ name: "普卡", thresholdCents: 0, discountPercent: 0 }] });
  assert.equal(value.tiers[0].thresholdCents, 0);
});

test("memberTierFor picks the highest threshold passed", () => {
  const tiers = normalizeMemberTiers({
    enabled: true,
    tiers: [
      { name: "银卡", thresholdCents: 10000, discountPercent: 5 },
      { name: "金卡", thresholdCents: 50000, discountPercent: 10 }
    ]
  });
  assert.equal(memberTierFor(9999, tiers), null, "below the first threshold is no tier");
  assert.equal(memberTierFor(10000, tiers)?.name, "银卡");
  assert.equal(memberTierFor(49999, tiers)?.name, "银卡");
  assert.equal(memberTierFor(50000, tiers)?.name, "金卡");
  assert.equal(memberTierFor(999999, tiers)?.name, "金卡");
  assert.equal(memberTierFor(10000, tiers)?.level, 1, "银卡 is level 1");
  assert.equal(memberTierFor(50000, tiers)?.level, 2, "金卡 is level 2");
  assert.equal(memberTierFor(50000, tiers)?.count, 2, "two tiers configured");
});

test("tiers off means no tier, whatever the top-up", () => {
  const off = normalizeMemberTiers({ enabled: false, tiers: [{ name: "金卡", thresholdCents: 0, discountPercent: 10 }] });
  assert.equal(memberTierFor(1000000, off), null);
  assert.deepEqual(membershipStatus(1000000, off), { growthCents: 1000000, tier: null, tierLevel: 0, tierCount: 0, discountPercent: 0 });
});

test("membershipStatus carries the level name and its discount", () => {
  const tiers = normalizeMemberTiers({ enabled: true, tiers: [{ name: "金卡", thresholdCents: 50000, discountPercent: 12 }] });
  assert.deepEqual(membershipStatus(60000, tiers), { growthCents: 60000, tier: "金卡", tierLevel: 1, tierCount: 1, discountPercent: 12 });
  assert.deepEqual(membershipStatus(100, tiers), { growthCents: 100, tier: null, tierLevel: 0, tierCount: 1, discountPercent: 0 });
  assert.equal(membershipStatus(-5, tiers).growthCents, 0, "a negative growth never shows");
});

test("tier thresholds count lifetime top-ups, so they may exceed one top-up's 1000-euro cap", () => {
  const tiers = normalizeMemberTiers({ enabled: true, tiers: [{ name: "Gold", thresholdCents: 1_999_900, discountPercent: 10 }] });
  assert.equal(tiers.tiers[0].thresholdCents, 1_999_900);
  assert.throws(() => normalizeMemberTiers({ enabled: true, tiers: [{ name: "X", thresholdCents: 100_000_001, discountPercent: 1 }] }));
});

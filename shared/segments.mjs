/**
 * 会员分群 (member segments): the rules that pick which members a 群发营销
 * (broadcast) reaches, and the test that says whether one member is in a
 * segment. A pure engine — no database, no `node:` anything — so it runs the
 * same on the Node server, on a Worker and in a unit test.
 *
 * A segment is a set of conditions, all of which a member must meet (AND). An
 * empty segment is everyone. The conditions, each optional:
 *
 *   tiers            会员等级 names — the member's level is one of these.
 *   minPoints        积分 at least this many.
 *   minBalanceCents  会员储值 at least this much.
 *   minLifetimeCents 累计充值 (lifetime top-up) at least this much.
 *   birthdayThisMonth the member's birthday falls in the current month.
 *   joinedWithinDays  the account was created within the last so many days (new members).
 *   inactiveDays      no order placed within the last so many days (win-back).
 *
 * The owner's 会员等级 config (memberTiers) turns a member's lifetime top-up
 * into a level name, so a segment by tier means the same thing the till does.
 */
import { membershipStatus } from "./customer.mjs";

export const MAX_SEGMENT_TIERS = 12;
/** A sanity ceiling: a condition never asks for more than this. */
export const MAX_SEGMENT_CENTS = 100_000_000; // 1,000,000 €
export const MAX_SEGMENT_POINTS = 100_000_000;
export const MAX_SEGMENT_DAYS = 3650; // ten years

const DAY_MS = 86_400_000;

/** A whole number within [0, max], or null when the input names no condition. */
function optionalCount(value, max) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > max)
    throw new Error("That number is out of range");
  return Math.floor(number);
}

/** A whole number within [1, max], or null — a window of zero days means no condition. */
function optionalWindow(value, max) {
  const count = optionalCount(value, max);
  if (count === null) return null;
  if (count < 1) return null;
  return count;
}

/**
 * The segment as it is stored and sent: only the conditions that were set,
 * each cleaned and bounded. Throws a plain message on a value out of range.
 */
export function normalizeSegment(input) {
  const source = input && typeof input === "object" ? input : {};
  const tiers = Array.isArray(source.tiers)
    ? [
        ...new Set(
          source.tiers
            .map((name) => String(name ?? "").trim())
            .filter(Boolean)
            .slice(0, MAX_SEGMENT_TIERS),
        ),
      ]
    : [];
  const segment = {};
  if (tiers.length) segment.tiers = tiers;
  const minPoints = optionalCount(source.minPoints, MAX_SEGMENT_POINTS);
  if (minPoints) segment.minPoints = minPoints;
  const minBalanceCents = optionalCount(source.minBalanceCents, MAX_SEGMENT_CENTS);
  if (minBalanceCents) segment.minBalanceCents = minBalanceCents;
  const minLifetimeCents = optionalCount(source.minLifetimeCents, MAX_SEGMENT_CENTS);
  if (minLifetimeCents) segment.minLifetimeCents = minLifetimeCents;
  if (source.birthdayThisMonth) segment.birthdayThisMonth = true;
  const joinedWithinDays = optionalWindow(source.joinedWithinDays, MAX_SEGMENT_DAYS);
  if (joinedWithinDays) segment.joinedWithinDays = joinedWithinDays;
  const inactiveDays = optionalWindow(source.inactiveDays, MAX_SEGMENT_DAYS);
  if (inactiveDays) segment.inactiveDays = inactiveDays;
  return segment;
}

/** The restaurant's current month (1–12) at `at`, in its own time zone. */
export function monthOf(at, timeZone) {
  const month = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "UTC",
    month: "2-digit",
  }).format(at instanceof Date ? at : new Date(at));
  return Number(month);
}

/**
 * Whether one member meets every condition the segment names.
 *
 * `stats` is what the store reads for the member:
 *   growthCents  累计充值 (lifetime top-up)
 *   points       积分 balance
 *   balanceCents 会员储值 balance
 *   birthMonth   birthday month (1–12) or null
 *   createdAt    ISO time the account was made
 *   lastOrderAt  ISO time of their last order, or null
 */
export function matchesSegment(stats, segment, { at = new Date(), timeZone = "UTC", memberTiers } = {}) {
  const rules = segment && typeof segment === "object" ? segment : {};
  const nowMs = (at instanceof Date ? at : new Date(at)).getTime();
  const growthCents = Number(stats?.growthCents ?? 0);
  const points = Number(stats?.points ?? 0);
  const balanceCents = Number(stats?.balanceCents ?? 0);

  if (Array.isArray(rules.tiers) && rules.tiers.length) {
    const tier = membershipStatus(growthCents, memberTiers).tier;
    if (!tier || !rules.tiers.includes(tier)) return false;
  }
  if (rules.minPoints && points < rules.minPoints) return false;
  if (rules.minBalanceCents && balanceCents < rules.minBalanceCents) return false;
  if (rules.minLifetimeCents && growthCents < rules.minLifetimeCents) return false;
  if (rules.birthdayThisMonth) {
    const birthMonth = stats?.birthMonth ? Number(stats.birthMonth) : null;
    if (!birthMonth || birthMonth !== monthOf(nowMs, timeZone)) return false;
  }
  if (rules.joinedWithinDays) {
    const createdMs = stats?.createdAt ? Date.parse(stats.createdAt) : NaN;
    if (!Number.isFinite(createdMs) || createdMs < nowMs - rules.joinedWithinDays * DAY_MS)
      return false;
  }
  if (rules.inactiveDays) {
    const lastMs = stats?.lastOrderAt ? Date.parse(stats.lastOrderAt) : NaN;
    // Never ordered, or last order older than the window: inactive.
    if (Number.isFinite(lastMs) && lastMs >= nowMs - rules.inactiveDays * DAY_MS)
      return false;
  }
  return true;
}

/** The segment as the API gives it back: the normalized rules, nothing more. */
export function segmentView(segment) {
  return normalizeSegment(segment);
}

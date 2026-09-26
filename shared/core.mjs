/**
 * The small things every rule leans on: the clock, ids, SQLite's 0/1
 * flags, euros to cents, lenient JSON and a capped limit.
 *
 * Nothing here may import `node:` anything, so it runs unchanged on Workers.
 */

export function now() {
  return new Date().toISOString();
}

export function uuid() {
  return crypto.randomUUID();
}

export function bool(value, fallback = true) {
  if (value === undefined) return fallback ? 1 : 0;
  return value ? 1 : 0;
}

export function priceToCents(value) {
  const cents = Math.round(Number(value) * 100);
  if (!Number.isFinite(cents) || cents < 0) throw new Error("Price must be a positive number");
  return cents;
}

export function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

/** Caps a client-supplied limit the same way on both backends. */
export function boundedLimit(limit, fallback = 100, max = 500) {
  return Math.min(Number(limit) || fallback, max);
}

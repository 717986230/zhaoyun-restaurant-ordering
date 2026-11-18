/**
 * The API's response helpers, extracted from shared/http.mjs: everything a
 * route answers with, and nothing that knows about a request.
 *
 * These are pure functions of their arguments (a Response, a 400/409 with a
 * code, a body checked against a schema) with no store, no state and no
 * closure over createApi, so they live on their own and are unit-testable in
 * isolation. shared/http.mjs re-exports them, so `import ... from
 * "../shared/http.mjs"` keeps working exactly as before.
 */
import { Value } from "@sinclair/typebox/value";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

/** Constant-time compare, so a wrong token leaks nothing through timing. */
export function tokenMatches(provided, expected) {
  const encoder = new TextEncoder();
  const a = encoder.encode(typeof provided === "string" ? provided : "");
  const b = encoder.encode(expected || "");
  if (!b.length || a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1)
    difference |= a[index] ^ b[index];
  return difference === 0;
}

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...SECURITY_HEADERS, ...headers },
  });
}

export function fail(message, status = 400) {
  return json({ error: message || "Request failed" }, status);
}

/** A refusal that says what it is (`code`) and, for a pause, how long (retry-after). */
export function coded(error) {
  const status = error.status ?? (error.code === "TABLE_LOCKED" ? 409 : 400);
  return json(
    {
      error: error.message || "Request failed",
      ...(error.code ? { code: error.code } : {}),
      // A dish sold out for today (shared/stock.mjs): which, and how many are left.
      ...(error.code === "SOLD_OUT"
        ? { sku: error.sku, left: error.left }
        : {}),
      // An email code (shared/email-verify.mjs): how long to wait, how many tries are left.
      ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
      ...(error.attemptsLeft !== undefined
        ? { attemptsLeft: error.attemptsLeft }
        : {}),
    },
    status,
    error.retryAfter ? { "retry-after": String(error.retryAfter) } : {},
  );
}

/** A table someone is at, or a number already taken: a 409 that says which (`code`). */
const TABLE_CONFLICTS = new Set([
  "TABLE_CLAIMED",
  "TABLE_IN_USE",
  "TABLE_EXISTS",
]);
export function tableRefusal(error) {
  return TABLE_CONFLICTS.has(error.code)
    ? coded({ message: error.message, code: error.code, status: 409 })
    : fail(error.message);
}

/** A booking refused by its rules: the code says why (full, too soon, too large); anything else is a bug. */
export function reservationRefusal(error) {
  if (!error.code) throw error;
  return json(
    {
      error: error.message,
      code: error.code,
      ...(error.reason ? { reason: error.reason } : {}),
      ...(error.maxParty ? { maxParty: error.maxParty } : {}),
      ...(error.limit ? { limit: error.limit } : {}),
      // Booking for members: the points it needs and the guest's.
      ...(error.minPoints !== undefined
        ? { minPoints: error.minPoints, points: error.points }
        : {}),
    },
    error.status ?? 400,
  );
}

/** A delivery order refused by its rules (not switched on, not an order, a step out of turn); anything else is a bug. */
export function deliveryRefusal(error) {
  if (!error.code) throw error;
  return json({ error: error.message, code: error.code }, error.status ?? 400);
}

/**
 * What a platform's "something happened to an order" call is about: the
 * order's id and whether it was cancelled. The platforms name these
 * differently, and send more than cancellations; the rest is not ours.
 */
export function platformEvent(payload) {
  if (!payload || typeof payload !== "object") return null;
  const order = payload.order ?? payload.Order ?? payload;
  const id =
    order.OrderId ??
    order.orderId ??
    order.Id ??
    order.id ??
    order.token ??
    order.orderToken ??
    payload.orderToken ??
    payload.OrderId ??
    payload.orderId;
  const what = [
    payload.status,
    payload.Status,
    payload.event,
    payload.Event,
    payload.type,
    payload.Type,
    order.status,
    order.Status,
  ]
    .filter((value) => typeof value === "string")
    .join(" ");
  if (!id) return null;
  return {
    externalId: String(id),
    cancelled: /cancel/i.test(what),
    reason: String(
      payload.reason ??
        payload.Reason ??
        payload.message ??
        payload.Message ??
        "",
    ).slice(0, 120),
  };
}

/**
 * A body checked against its schema. An invalid one is a 400 that says which
 * field and why, and starts "Invalid request" whichever backend answers.
 */
export async function body(request, schema) {
  let parsed;
  try {
    parsed = (await request.json()) ?? {};
  } catch {
    parsed = {};
  }
  if (!schema) return { value: parsed };
  if (Value.Check(schema, parsed)) return { value: parsed };
  const [problem] = [...Value.Errors(schema, parsed)];
  return {
    invalid: fail(
      problem
        ? `Invalid request: body${problem.path} ${problem.message}`
        : "Invalid request body",
    ),
  };
}

export function segments(pathname) {
  return pathname
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
}

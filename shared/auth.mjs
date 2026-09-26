/**
 * Who may do what: the staff roles and their tokens, the console's password
 * and its sessions, and the audit trail those roles leave.
 *
 * Nothing here may import `node:` anything, so it runs unchanged on Workers.
 */

import { parseJson } from "./core.mjs";

/**
 * Who may do what.
 *
 * Three shared tokens, one per role, and a rank so a route can ask for a
 * minimum rather than enumerate. A manager outranks a waiter outranks the
 * kitchen screen, and the catalogue — the menu, its prices and its allergen
 * declarations — is manager-only on both backends.
 *
 * This lives here because it is the one rule that must not differ between the
 * Node server and the Worker. It did: the Worker had a single token and no
 * roles at all, so a waiter tablet pointed at the Cloudflare deployment would
 * have been able to edit the menu. `shared/contract-suite.mjs` now asks both.
 */
export const STAFF_ROLES = ["kitchen", "staff", "manager"];
export const ROLE_RANK = { kitchen: 1, staff: 2, manager: 3 };

/**
 * `matches(expected)` is the runtime's own constant-time comparison against the
 * token the request carried — `node:crypto` on the server, a hand-rolled loop
 * on the Worker — so only the precedence lives here.
 *
 * Order matters: the manager token wins, and an unset staff or kitchen token
 * never matches, so a deployment that configures only ADMIN_TOKEN has exactly
 * one role rather than three aliases of it.
 */
export function resolveStaffRole(matches, tokens = {}) {
  if (tokens.manager && matches(tokens.manager)) return "manager";
  if (tokens.staff && matches(tokens.staff)) return "staff";
  if (tokens.kitchen && matches(tokens.kitchen)) return "kitchen";
  return null;
}

export function roleAllows(role, minimumRole) {
  return Boolean(role) && ROLE_RANK[role] >= ROLE_RANK[minimumRole];
}

/**
 * One password, on the door of the admin console.
 *
 * A shared token is the right credential for a tablet bolted to a wall and
 * configured once. It is the wrong one for a person with a phone: nobody
 * types 32 random characters to fix a price, and handing one out means
 * handing out the only one there is. So the console has a password instead —
 * set by whoever opens it first, kept as a PBKDF2 hash in the restaurant's
 * own database, and exchanged at sign-in for a session token presented in
 * the same `x-admin-token` header every route already reads.
 *
 * `ADMIN_TOKEN` keeps working where it is configured. It is not the way in
 * any more, but it is the way back in: a deployment whose password has been
 * forgotten is recovered with it rather than rebuilt.
 *
 * PBKDF2 through WebCrypto because it is the one password hash both runtimes
 * have — `node:crypto`'s scrypt is not on Workers, and a second
 * implementation of a password hash is how the two quietly stop agreeing.
 *
 * 100,000 iterations, because that is the most Cloudflare Workers will run:
 * deployed WebCrypto refuses anything higher with "iteration counts above
 * 100000 are not supported", while local `wrangler dev` does not enforce the
 * cap, so a higher number passes every test and fails only in production.
 * server/tests/password.test.mjs holds the constant to it for that reason.
 *
 * That is below OWASP's 600,000 for PBKDF2-HMAC-SHA256. What makes up for it
 * here is that guessing online is throttled to five failures per address per
 * five minutes, and guessing offline needs the database first. Each stored
 * hash records its own iteration count, so raising this later re-hashes on
 * the next password change without invalidating anything.
 */
export const PASSWORD_ITERATIONS = 100_000;
/** The ceiling deployed Workers put on PBKDF2. Not a setting — a fact about
 *  the runtime, stated once so the test can hold PASSWORD_ITERATIONS to it. */
export const WORKERS_PBKDF2_MAX_ITERATIONS = 100_000;
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PASSWORD_MIN = 6;

function base64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function unbase64(value) {
  return Uint8Array.from(atob(String(value)), (character) => character.charCodeAt(0));
}

export function assertPassword(value) {
  const password = String(value ?? "");
  if (password.length < PASSWORD_MIN) throw new Error(`Password must be at least ${PASSWORD_MIN} characters`);
  return password;
}

export async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16)), iterations = PASSWORD_ITERATIONS) {
  const saltBytes = typeof salt === "string" ? unbase64(salt) : salt;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations }, key, 256);
  return { hash: base64(bits), salt: base64(saltBytes), iterations };
}

/**
 * Compares every byte whatever happens, so a wrong digest takes as long to
 * reject as a right one takes to accept. Both sides here are base64 of a
 * fixed-width digest, so returning early on a length mismatch leaks nothing
 * that is secret — the same shape `tokenMatches` uses in the Worker.
 */
export function constantTimeEquals(left, right) {
  const encoder = new TextEncoder();
  const a = encoder.encode(String(left ?? ""));
  const b = encoder.encode(String(right ?? ""));
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

export async function verifyPassword(password, stored) {
  if (!stored?.hash || !stored?.salt) return false;
  const { hash } = await hashPassword(password, stored.salt, Number(stored.iterations) || PASSWORD_ITERATIONS);
  return constantTimeEquals(hash, stored.hash);
}

/** The token a sign-in hands back. Only its SHA-256 is stored, so a stolen
 *  database still holds nothing that can be replayed as a credential. */
export function newSessionToken() {
  return base64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashSessionToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(token)));
  return base64(digest);
}

/** What the console asks before it draws anything: is there a password yet,
 *  or is this the first person through the door. */
export function adminGateView(row) {
  return { configured: Boolean(row?.password_hash) };
}

export function auditView(row) {
  return {
    id: row.id, at: row.at, role: row.role, ip: row.ip, method: row.method,
    route: row.route, status: row.status, detail: parseJson(row.detail_json, {})
  };
}

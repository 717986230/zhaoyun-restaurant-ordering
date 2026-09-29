/**
 * A guest's email address, proved theirs by a code sent to it, before they
 * may book a table (shared/mail.mjs sends it). Proved once per address: an
 * account whose email is verified stays so until the address changes.
 *
 * The code is six digits, good for ten minutes and five tries, and only its
 * hash is kept. A new one may be asked for once a minute and five times an
 * hour: enough for a mail that went astray, not for filling someone's inbox.
 *
 * Nothing here may import `node:` anything, so it runs unchanged on Workers.
 */
import { sha256Hex } from "./register.mjs";

export const EMAIL_CODE_TTL_MS = 10 * 60_000;
export const EMAIL_CODE_RESEND_MS = 60_000;
export const EMAIL_CODES_PER_HOUR = 5;
export const EMAIL_CODE_ATTEMPTS = 5;

/** Six random digits, the first may be 0. */
export function newEmailCode() {
  const [value] = crypto.getRandomValues(new Uint32Array(1));
  return String(value % 1_000_000).padStart(6, "0");
}

/** The code as kept: hashed with the account it was sent for, so one guest's code is no one else's. */
export function emailCodeHash(customerId, code) {
  return sha256Hex(`${customerId}:${String(code).trim()}`);
}

/** "mia@example.com" as the page says where the code went: "m••@example.com". */
export function maskEmail(email) {
  const [local, domain] = String(email).split("@");
  return `${local.slice(0, 1)}${"•".repeat(Math.min(Math.max(local.length - 1, 2), 6))}@${domain}`;
}

export const EMAIL_CODES_SINCE_SQL = "SELECT created_at FROM email_codes WHERE customer_id = ? AND created_at >= ? ORDER BY created_at DESC";
export const INSERT_EMAIL_CODE_SQL = "INSERT INTO email_codes (id, customer_id, email, code_hash, attempts, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, 0, ?, NULL, ?)";
/** The newest code for the account's address, still open. */
export const OPEN_EMAIL_CODE_SQL = "SELECT * FROM email_codes WHERE customer_id = ? AND email = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1";
export const COUNT_EMAIL_CODE_ATTEMPT_SQL = "UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?";
export const USE_EMAIL_CODE_SQL = "UPDATE email_codes SET used_at = ? WHERE id = ? AND used_at IS NULL";
export const VERIFY_EMAIL_SQL = `INSERT INTO customer_verified_emails (customer_id, email, verified_at) VALUES (?, ?, ?)
  ON CONFLICT (customer_id) DO UPDATE SET email = excluded.email, verified_at = excluded.verified_at`;
/** Whether the account's address, as it is now, was proved. */
export const EMAIL_VERIFIED_SQL = `SELECT 1 AS verified FROM customer_verified_emails JOIN customers ON customers.id = customer_verified_emails.customer_id
  WHERE customer_verified_emails.customer_id = ? AND customer_verified_emails.email = customers.email`;
export const DELETE_OLD_EMAIL_CODES_SQL = "DELETE FROM email_codes WHERE created_at < ?";

export const INSERT_OUTBOX_SQL = "INSERT INTO mail_outbox (id, to_email, subject, text, created_at) VALUES (?, ?, ?, ?, ?)";
export const OUTBOX_SQL = "SELECT * FROM mail_outbox ORDER BY created_at DESC, rowid DESC LIMIT ?";

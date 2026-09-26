/**
 * The restaurant's account: what the owner registers once, and signs in with
 * — an account name and a password — on the admin console and when pairing a
 * POS device. The waiters live under it (shared/pos.mjs), each with a PIN.
 *
 * One deployment is one restaurant, so registration is open exactly until
 * the first account exists and closed from then on: the INSERT below carries
 * that condition itself, so two people registering at once cannot both win.
 *
 * Both backends run these statements and these rules; only the way they
 * reach the database differs (server/database.mjs, workers/store.mjs).
 */
import { assertPassword, SESSION_TTL_MS } from "./rules.mjs";

export const ACCOUNT_SESSION_TTL_MS = SESSION_TTL_MS;
/** What a password set at the old one-password door becomes: an account named this. */
export const MIGRATED_LOGIN = "admin";

const LOGIN_PATTERN = /^[a-z0-9][a-z0-9._@-]{2,63}$/;
const NAME_MAX = 40;

/** An account name: 3–64 of a–z, 0–9 and . _ @ -, compared without case. */
export function normalizeLogin(value) {
  const login = String(value ?? "").trim().toLowerCase();
  if (!LOGIN_PATTERN.test(login)) throw new Error("Account name must be 3–64 characters: letters, digits, . _ @ -");
  return login;
}

/** The name shown in the console's head; the account name when none is given. */
export function normalizeAccountName(value, fallback) {
  const name = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, NAME_MAX);
  return name || fallback;
}

/** Everything a registration needs, checked before anything is written. */
export function normalizeRegistration(input) {
  const login = normalizeLogin(input?.login);
  return { login, name: normalizeAccountName(input?.name, login), password: assertPassword(input?.password) };
}

/** An account as the API shows it: never the hash. */
export function accountView(row) {
  return row ? { id: row.id, login: row.login, name: row.name, createdAt: row.created_at } : null;
}

export function storedPassword(row) {
  return { hash: row.password_hash, salt: row.password_salt, iterations: row.password_iterations };
}

export const ACCOUNT_COUNT_SQL = "SELECT COUNT(*) AS count FROM accounts";
export const ACCOUNT_BY_LOGIN_SQL = "SELECT * FROM accounts WHERE login = ?";
export const ACCOUNT_BY_ID_SQL = "SELECT * FROM accounts WHERE id = ?";
/** The first registration only: nothing is inserted once any account exists. */
export const REGISTER_ACCOUNT_SQL = `
  INSERT INTO accounts (id, login, name, password_hash, password_salt, password_iterations, created_at, updated_at)
  SELECT ?, ?, ?, ?, ?, ?, ?, ?
  WHERE NOT EXISTS (SELECT 1 FROM accounts)`;
export const UPDATE_ACCOUNT_SQL = `
  UPDATE accounts SET login = ?, name = ?, password_hash = ?, password_salt = ?, password_iterations = ?, updated_at = ?
  WHERE id = ?`;
/** The owner: the account registered first. */
export const OWNER_ACCOUNT_SQL = "SELECT * FROM accounts ORDER BY created_at, id LIMIT 1";

export const INSERT_ACCOUNT_SESSION_SQL = "INSERT INTO account_sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)";
export const ACCOUNT_SESSION_SQL = `
  SELECT account_sessions.token_hash, account_sessions.expires_at, accounts.*
  FROM account_sessions JOIN accounts ON accounts.id = account_sessions.account_id
  WHERE account_sessions.token_hash = ?`;
export const DELETE_ACCOUNT_SESSION_SQL = "DELETE FROM account_sessions WHERE token_hash = ?";
export const DELETE_ACCOUNT_SESSIONS_SQL = "DELETE FROM account_sessions WHERE account_id = ?";
export const DELETE_EXPIRED_ACCOUNT_SESSIONS_SQL = "DELETE FROM account_sessions WHERE expires_at <= ?";

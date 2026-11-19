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
 * reach the database differs (shared/store.mjs, over each backend's driver).
 */
import { assertPassword, SESSION_TTL_MS } from "./auth.mjs";
import { DEFAULT_TENANT_ID } from "./tenant.mjs";

export const ACCOUNT_SESSION_TTL_MS = SESSION_TTL_MS;
/** What a password set at the old one-password door becomes: an account named this. */
export const MIGRATED_LOGIN = "admin";

/** The platform owner (the 站长): the one account that may create tenants
 *  and their admins. Every other account administers its own tenant only. */
export const OWNER_ROLE = "owner";
export const ADMIN_ROLE = "admin";

const LOGIN_PATTERN = /^[a-z0-9][a-z0-9._@-]{2,63}$/;
const NAME_MAX = 40;
const EMAIL_MAX = 128;

/** An account's email, for the invite that reaches it: empty when the owner
 *  hands the link over instead. */
export function normalizeAccountEmail(value) {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email) return "";
  if (email.length > EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Email must be an address");
  return email;
}

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

/** An account as the API shows it: never the hash — and never the encrypted
 *  password either, which only the owner's explicit view may return. */
export function accountView(row) {
  return row ? { id: row.id, login: row.login, name: row.name, tenantId: row.tenant_id ?? DEFAULT_TENANT_ID, role: row.role ?? ADMIN_ROLE, status: row.status ?? "active", email: row.email ?? "", createdAt: row.created_at } : null;
}

export function storedPassword(row) {
  return { hash: row.password_hash, salt: row.password_salt, iterations: row.password_iterations };
}

export const ACCOUNT_COUNT_SQL = "SELECT COUNT(*) AS count FROM accounts";
export const ACCOUNT_BY_LOGIN_SQL = "SELECT * FROM accounts WHERE login = ?";
export const ACCOUNT_BY_ID_SQL = "SELECT * FROM accounts WHERE id = ?";
export const ACCOUNTS_BY_TENANT_SQL = "SELECT * FROM accounts WHERE tenant_id = ? ORDER BY created_at, id";
/** The first registration only: nothing is inserted once any tenant exists.
 *  A fresh install registers its owner this way; afterwards accounts arrive
 *  only through an invite the owner created (shared/store.mjs). */
/**
 * The one registration that is ever open to the public: the first account,
 * which is the platform's owner, in the default tenant. Once any account
 * exists, registration closes and accounts arrive only through the owner
 * (an invite). Two people registering at once cannot both win: the condition
 * is in the INSERT itself.
 *
 * Parameters, in order: id, tenant_id, role, status, login, name, email,
 * password_hash, password_salt, password_iterations, password_enc,
 * created_at, updated_at. The bootstrap owner has no email and no encrypted
 * password copy: both arrive with the invite flow or a later password set.
 */
export const REGISTER_ACCOUNT_SQL = `
  INSERT INTO accounts (id, tenant_id, role, status, login, name, email, password_hash, password_salt, password_iterations, password_enc, created_at, updated_at)
  SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  WHERE NOT EXISTS (SELECT 1 FROM accounts)`;
export const INSERT_ACCOUNT_SQL = `
  INSERT INTO accounts (id, tenant_id, role, status, login, name, email, password_hash, password_salt, password_iterations, password_enc, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
export const UPDATE_ACCOUNT_SQL = `
  UPDATE accounts SET login = ?, name = ?, email = ?, password_hash = ?, password_salt = ?, password_iterations = ?, password_enc = ?, updated_at = ?
  WHERE id = ?`;
export const UPDATE_ACCOUNT_STATUS_SQL = "UPDATE accounts SET status = ?, updated_at = ? WHERE id = ?";
/** The platform owner: the account registered first, with the owner's role. */
export const OWNER_ACCOUNT_SQL = "SELECT * FROM accounts WHERE role = 'owner' ORDER BY created_at, id LIMIT 1";

/** Tenants. */
export const TENANT_BY_ID_SQL = "SELECT * FROM tenants WHERE id = ?";
export const TENANT_BY_SLUG_SQL = "SELECT * FROM tenants WHERE slug = ?";
export const LIST_TENANTS_SQL = "SELECT * FROM tenants ORDER BY created_at, id";
export const INSERT_TENANT_SQL = "INSERT INTO tenants (id, slug, name, status, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)";
export const UPDATE_TENANT_SQL = "UPDATE tenants SET slug = ?, name = ?, status = ?, config_json = ?, updated_at = ? WHERE id = ?";

/** A tenant's role tokens (its kitchen screen, its staff tablets): the
 *  shared tokens a deployment configures belong to the first tenant only, so
 *  a second restaurant's screens sign in with these instead. Only the
 *  SHA-256 of a token is stored. */
export const INSERT_TENANT_TOKEN_SQL = "INSERT INTO tenant_tokens (token_hash, tenant_id, role, created_at) VALUES (?, ?, ?, ?)";
export const TENANT_TOKEN_SQL = "SELECT * FROM tenant_tokens WHERE token_hash = ?";
export const DELETE_TENANT_TOKENS_SQL = "DELETE FROM tenant_tokens WHERE tenant_id = ? AND role = ?";

/** One-time links: an invite (a new admin sets their password) and a
 *  password reset (an existing account sets a new one). */
export const INSERT_ACCOUNT_TOKEN_SQL = `
  INSERT INTO account_tokens (id, kind, tenant_id, account_id, login, name, email, token_hash, expires_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
export const ACCOUNT_TOKEN_SQL = "SELECT * FROM account_tokens WHERE token_hash = ?";
export const USE_ACCOUNT_TOKEN_SQL = "UPDATE account_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?";
export const DELETE_EXPIRED_ACCOUNT_TOKENS_SQL = "DELETE FROM account_tokens WHERE expires_at <= ?";

export const INSERT_ACCOUNT_SESSION_SQL = "INSERT INTO account_sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)";
export const ACCOUNT_SESSION_SQL = `
  SELECT account_sessions.token_hash, account_sessions.expires_at, accounts.*
  FROM account_sessions JOIN accounts ON accounts.id = account_sessions.account_id
  WHERE account_sessions.token_hash = ?`;
export const DELETE_ACCOUNT_SESSION_SQL = "DELETE FROM account_sessions WHERE token_hash = ?";
export const DELETE_ACCOUNT_SESSIONS_SQL = "DELETE FROM account_sessions WHERE account_id = ?";
export const DELETE_EXPIRED_ACCOUNT_SESSIONS_SQL = "DELETE FROM account_sessions WHERE expires_at <= ?";

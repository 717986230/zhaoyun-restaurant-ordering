/**
 * Tenants: one restaurant per tenant, all in the one database.
 *
 * A tenant is the restaurant itself — its name, its settings, its data. The
 * first tenant owns everything that was there before tenants existed (the
 * migration moves it all there), and every row a tenant owns carries its id,
 * so a tenant's data can be listed, exported and deleted on its own and a new
 * restaurant is provisioned without a code change.
 *
 * Nothing here may import `node:` anything, so it runs unchanged on Workers.
 */

import { MENU_LANGUAGES } from "./settings.mjs";

/** The tenant the migration puts all existing data into. */
export const DEFAULT_TENANT_ID = "t_default";
export const DEFAULT_TENANT_SLUG = "default";

/** A tenant's public key in a URL or a header: 3–64 of a–z, 0–9 and - . */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

export function normalizeTenantSlug(value) {
  const slug = String(value ?? "").trim().toLowerCase();
  if (!SLUG_PATTERN.test(slug)) throw new Error("Tenant address must be 3–64 characters: letters, digits and -");
  return slug;
}

export function normalizeTenantName(value, fallback = "") {
  const name = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  return name || fallback;
}

/**
 * What a tenant is configured with, kept as one JSON object so a new field
 * needs no migration: the name and logo the menu shows, the language and
 * currency it trades in, its tax rate and hours — and, for later, the hooks
 * billing and per-tenant feature flags will hang off (`billing`, `features`).
 * Unknown keys are dropped, so a stale client cannot smuggle settings in.
 */
export function normalizeTenantConfig(input = {}) {
  const value = input && typeof input === "object" ? input : {};
  const config = {};
  if (value.name !== undefined) config.name = normalizeTenantName(value.name);
  if (value.logo !== undefined) {
    const logo = String(value.logo ?? "").trim();
    if (logo.length > 500) throw new Error("Logo must be at most 500 characters");
    if (logo && !logo.startsWith("/") && !logo.startsWith("https://")) throw new Error("Logo must be a path on this server or an https:// address");
    config.logo = logo;
  }
  if (value.language !== undefined) {
    if (!MENU_LANGUAGES.includes(value.language)) throw new Error("Unsupported language");
    config.language = value.language;
  }
  if (value.currency !== undefined) {
    const currency = String(value.currency ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be a three-letter code");
    config.currency = currency;
  }
  if (value.taxPercent !== undefined) {
    const taxPercent = Number(value.taxPercent);
    if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) throw new Error("Tax must be 0 to 100 percent");
    config.taxPercent = taxPercent;
  }
  if (value.hours !== undefined) {
    if (!value.hours || typeof value.hours !== "object" || Array.isArray(value.hours)) throw new Error("Hours must be an object");
    config.hours = value.hours;
  }
  // Hooks for later: what billing will charge against, and which features
  // this tenant has switched on. Passed through as objects, never trusted
  // for anything until the features that read them exist.
  if (value.billing !== undefined) {
    if (!value.billing || typeof value.billing !== "object" || Array.isArray(value.billing)) throw new Error("Billing must be an object");
    config.billing = value.billing;
  }
  if (value.features !== undefined) {
    if (!value.features || typeof value.features !== "object" || Array.isArray(value.features)) throw new Error("Features must be an object");
    config.features = value.features;
  }
  return config;
}

/** A tenant as the API shows it: never its tokens or billing secrets. */
export function tenantView(row) {
  if (!row) return null;
  let config;
  try {
    config = JSON.parse(row.config_json ?? "{}");
    if (!config || typeof config !== "object" || Array.isArray(config)) config = {};
  } catch {
    config = {};
  }
  return {
    id: row.id, slug: row.slug, name: row.name, status: row.status,
    config, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

/** The one-time links: an invite (a new admin sets their password) and a
 *  password reset (an existing account sets a new one). Only the SHA-256 of
 *  the token is stored, so a stolen database holds nothing that can be
 *  replayed — the same shape account sessions already use. */
export const ACCOUNT_TOKEN_KINDS = ["invite", "reset"];
export const ACCOUNT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function accountTokenView(row) {
  if (!row) return null;
  return {
    id: row.id, kind: row.kind, tenantId: row.tenant_id, accountId: row.account_id,
    login: row.login, name: row.name, email: row.email,
    expiresAt: row.expires_at, usedAt: row.used_at, createdAt: row.created_at
  };
}

// ——— The owner's view of a user's password.
//
// Passwords are still checked the way they always were — PBKDF2, in
// shared/auth.mjs — so signing in never depends on this. Beside the hash,
// a password set while a view key is configured also keeps an AES-GCM copy
// of itself, encrypted under a key that lives only in the server's
// environment (PASSWORD_VIEW_KEY, base64 of 32 bytes, never in code or git).
// The owner dashboard decrypts that copy to show a password, and writes a
// new one the same way. A database on its own holds nothing readable; a
// database and the key together hold every password — the user accepted
// that trade for the owner's control, and it is why the key must be kept
// apart from the database.
//
// A password set before any key existed, or while none was configured, has
// no copy: the owner cannot see it until it is set again. That is not a
// failure of the copy — a hash cannot be turned back into a password.

function base64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function unbase64(value) {
  return Uint8Array.from(atob(String(value)), (character) => character.charCodeAt(0));
}

export async function importPasswordViewKey(key) {
  const raw = typeof key === "string" ? unbase64(key.trim()) : key;
  if (!raw || raw.length !== 32) throw new Error("PASSWORD_VIEW_KEY must be base64 of 32 bytes");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** An AES-GCM copy of a password: base64 of the 12-byte nonce and the ciphertext. */
export async function encryptPasswordForOwner(password, key) {
  if (!key) return null;
  const cryptoKey = typeof key === "string" ? await importPasswordViewKey(key) : key;
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    cryptoKey,
    new TextEncoder().encode(String(password))
  );
  const combined = new Uint8Array(nonce.length + ciphertext.byteLength);
  combined.set(nonce, 0);
  combined.set(new Uint8Array(ciphertext), nonce.length);
  return base64(combined);
}

export async function decryptPasswordForOwner(stored, key) {
  if (!stored || !key) return null;
  const cryptoKey = typeof key === "string" ? await importPasswordViewKey(key) : key;
  const combined = unbase64(stored);
  if (combined.length <= 12) throw new Error("Stored password is not readable");
  const nonce = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, cryptoKey, ciphertext);
  return new TextDecoder().decode(plaintext);
}

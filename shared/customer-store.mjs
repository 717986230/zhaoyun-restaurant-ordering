/**
 * Guests' accounts, favourites and points, over any SQLite: one
 * implementation for both backends.
 *
 * The rest of the backends keep a store each, because a synchronous
 * transaction (node:sqlite) and an atomic batch (D1) shape an order's write
 * differently. Nothing here needs more than that both can do: read a row,
 * read rows, run a statement, and run a list of statements all or nothing.
 * `driver` is exactly that:
 *
 *   first(sql, ...params) → row | null
 *   all(sql, ...params)   → rows
 *   run(sql, ...params)   → number of rows changed
 *   batch([[sql, params], …]) → all or nothing
 *
 * `ordersFor(rows)` turns order rows into the API's orders, lines included,
 * the way each backend already does for the board.
 */
import { assertPassword, hashPassword, hashSessionToken, newSessionToken, now, PASSWORD_ITERATIONS, uuid, verifyPassword } from "./rules.mjs";
import {
  ADD_FAVORITE_SQL, CHANGE_POINTS_SQL, CUSTOMER_BY_EMAIL_SQL, CUSTOMER_BY_ID_SQL, CUSTOMER_SESSION_SQL,
  CUSTOMER_SESSION_TTL_MS, customerView, DELETE_CUSTOMER_SESSION_SQL, DELETE_CUSTOMER_SESSIONS_SQL, DELETE_CUSTOMER_STATEMENTS,
  DELETE_EXPIRED_CUSTOMER_SESSIONS_SQL, FAVORITES_SQL, INSERT_CUSTOMER_SESSION_SQL, INSERT_CUSTOMER_SQL, INSERT_POINTS_SQL, isOverdrawn,
  MAX_FAVORITES, normalizeCustomerName, normalizeCustomerRegistration, normalizePointsAdjustment, pointsEntryView, POINTS_HISTORY_SQL,
  REMOVE_FAVORITE_SQL, SEARCH_CUSTOMERS_SQL, storedCustomerPassword, UPDATE_CUSTOMER_SQL
} from "./customer.mjs";
import { CUSTOMER_ORDERS_SQL, GUEST_ORDERS_BY_REQUEST_SQL, MAX_TRACKED_ORDERS } from "./ordering.mjs";

// A salt for nobody: an unknown email costs the same PBKDF2 work as a wrong
// password, so the time a sign-in takes does not say which it was.
const ABSENT_PASSWORD_SALT = "AAAAAAAAAAAAAAAAAAAAAA==";

function coded(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export function createCustomerStore(driver, { ordersFor }) {
  async function openSession(row) {
    const token = newSessionToken();
    const at = now();
    await driver.run(DELETE_EXPIRED_CUSTOMER_SESSIONS_SQL, at);
    await driver.run(INSERT_CUSTOMER_SESSION_SQL, await hashSessionToken(token), row.id, new Date(Date.now() + CUSTOMER_SESSION_TTL_MS).toISOString(), at);
    return { token, expiresInMs: CUSTOMER_SESSION_TTL_MS, customer: customerView(row) };
  }

  async function byId(id) {
    return driver.first(CUSTOMER_BY_ID_SQL, String(id));
  }

  /** Whether the password is this guest's; the row when it is. */
  async function withPassword(id, password) {
    const row = await byId(id);
    return row && (await verifyPassword(String(password ?? ""), storedCustomerPassword(row))) ? row : null;
  }

  async function register(input) {
    const { email, name, password } = normalizeCustomerRegistration(input);
    if (await driver.first(CUSTOMER_BY_EMAIL_SQL, email)) throw coded("This email already has an account: sign in", "EMAIL_TAKEN", 409);
    const stored = await hashPassword(password);
    const id = uuid();
    const at = now();
    try {
      await driver.run(INSERT_CUSTOMER_SQL, id, email, name, stored.hash, stored.salt, stored.iterations, at, at);
    } catch (error) {
      // Two registrations of one email at once: the UNIQUE index decides.
      if (/UNIQUE/i.test(String(error?.message))) throw coded("This email already has an account: sign in", "EMAIL_TAKEN", 409);
      throw error;
    }
    return openSession(await byId(id));
  }

  async function signIn(emailInput, password) {
    const row = await driver.first(CUSTOMER_BY_EMAIL_SQL, String(emailInput ?? "").trim().toLowerCase());
    const stored = row ? storedCustomerPassword(row) : { hash: "", salt: ABSENT_PASSWORD_SALT, iterations: PASSWORD_ITERATIONS };
    const correct = await verifyPassword(String(password ?? ""), stored);
    return row && correct ? openSession(row) : null;
  }

  /** The guest a token belongs to, or null — expired and revoked look the same. */
  async function session(token) {
    if (!token) return null;
    const tokenHash = await hashSessionToken(token);
    const row = await driver.first(CUSTOMER_SESSION_SQL, tokenHash);
    if (!row) return null;
    if (row.expires_at <= now()) {
      await driver.run(DELETE_CUSTOMER_SESSION_SQL, tokenHash);
      return null;
    }
    return customerView(row);
  }

  async function signOut(token) {
    if (token) await driver.run(DELETE_CUSTOMER_SESSION_SQL, await hashSessionToken(token));
  }

  async function favorites(customerId) {
    return (await driver.all(FAVORITES_SQL, customerId)).map((row) => row.product_id);
  }

  async function profile(customerId) {
    const row = await byId(customerId);
    return row ? { customer: customerView(row), favorites: await favorites(customerId) } : null;
  }

  /**
   * A new name, or a new password — always against the password in force, so
   * a phone left unlocked on a table is not enough. A new password ends every
   * other session and hands this one a fresh token. Null on a wrong password.
   */
  async function update(customerId, input) {
    const row = await withPassword(customerId, input?.currentPassword);
    if (!row) return null;
    const name = input.name === undefined ? row.name : normalizeCustomerName(input.name);
    const stored = input.password === undefined ? storedCustomerPassword(row) : await hashPassword(assertPassword(input.password));
    await driver.run(UPDATE_CUSTOMER_SQL, name, stored.hash, stored.salt, stored.iterations, now(), row.id);
    if (input.password === undefined) return { customer: customerView(await byId(row.id)) };
    await driver.run(DELETE_CUSTOMER_SESSIONS_SQL, row.id);
    return openSession(await byId(row.id));
  }

  /** The account and everything that is only theirs, gone (GDPR). Their orders stay the restaurant's. */
  async function removeAccount(customerId) {
    await driver.batch(DELETE_CUSTOMER_STATEMENTS.map((sql) => [sql, [String(customerId)]]));
  }

  async function setFavorite(customerId, productId, on) {
    const id = String(productId);
    if (on) {
      if (!(await driver.first("SELECT id FROM products WHERE id = ?", id))) throw coded("No such dish on the menu", "NOT_FOUND", 404);
      const current = await favorites(customerId);
      if (!current.includes(id) && current.length >= MAX_FAVORITES) throw coded(`At most ${MAX_FAVORITES} favourites`, "TOO_MANY", 400);
      await driver.run(ADD_FAVORITE_SQL, customerId, id, now());
    } else {
      await driver.run(REMOVE_FAVORITE_SQL, customerId, id);
    }
    return favorites(customerId);
  }

  async function adjustPoints(customerId, input) {
    const { delta, note } = normalizePointsAdjustment(input);
    if (!(await byId(customerId))) return null;
    const at = now();
    const id = uuid();
    try {
      await driver.batch([
        [INSERT_POINTS_SQL, [id, String(customerId), delta, "adjust", id, note, at]],
        [CHANGE_POINTS_SQL, [delta, at, String(customerId)]]
      ]);
    } catch (error) {
      if (isOverdrawn(error)) throw coded("The guest does not have that many points", "NOT_ENOUGH_POINTS", 409);
      throw error;
    }
    return customerView(await byId(customerId));
  }

  return {
    register,
    signIn,
    session,
    signOut,
    profile,
    update,
    setFavorite,
    /** Deleting one's own account takes the password. Null on a wrong one. */
    async deleteOwn(customerId, password) {
      if (!(await withPassword(customerId, password))) return null;
      await removeAccount(customerId);
      return true;
    },
    async points(customerId, limit = 50) {
      return (await driver.all(POINTS_HISTORY_SQL, String(customerId), Math.min(Math.max(Number(limit) || 50, 1), 200))).map(pointsEntryView);
    },
    async orders(customerId) {
      return ordersFor(await driver.all(CUSTOMER_ORDERS_SQL, String(customerId), MAX_TRACKED_ORDERS));
    },
    /** A guest without an account follows the orders their phone placed, by the ids it made up for them. */
    async ordersByRequest(ids) {
      const unique = [...new Set(ids.map(String).filter(Boolean))].slice(0, MAX_TRACKED_ORDERS);
      if (!unique.length) return [];
      return ordersFor(await driver.all(GUEST_ORDERS_BY_REQUEST_SQL.replace("(?)", `(${unique.map(() => "?").join(", ")})`), ...unique));
    },

    // ——— The console's side: the manager looks guests up, and helps them.
    async list(query = "", limit = 50) {
      const text = String(query ?? "").trim().toLowerCase().slice(0, 64);
      return (await driver.all(SEARCH_CUSTOMERS_SQL, text, text, text, Math.min(Math.max(Number(limit) || 50, 1), 200))).map(customerView);
    },
    async get(customerId) {
      const row = await byId(customerId);
      return row ? { customer: customerView(row), points: (await driver.all(POINTS_HISTORY_SQL, row.id, 50)).map(pointsEntryView) } : null;
    },
    adjustPoints,
    /** A guest who forgot their password gets a new one at the counter; every session of theirs ends. */
    async resetPassword(customerId, password) {
      const row = await byId(customerId);
      if (!row) return null;
      const stored = await hashPassword(assertPassword(password));
      await driver.run(UPDATE_CUSTOMER_SQL, row.name, stored.hash, stored.salt, stored.iterations, now(), row.id);
      await driver.run(DELETE_CUSTOMER_SESSIONS_SQL, row.id);
      return customerView(await byId(row.id));
    },
    async remove(customerId) {
      if (!(await byId(customerId))) return false;
      await removeAccount(customerId);
      return true;
    }
  };
}

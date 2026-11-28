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
import {
  assertPassword,
  hashPassword,
  hashSessionToken,
  newSessionToken,
  PASSWORD_ITERATIONS,
  verifyPassword,
} from "./auth.mjs";
import { now, uuid } from "./core.mjs";
import {
  ADD_FAVORITE_SQL,
  CHANGE_POINTS_SQL,
  CUSTOMER_BY_CONTACT_SQL,
  CUSTOMER_BY_ID_SQL,
  CUSTOMER_SESSION_SQL,
  CUSTOMER_SESSION_TTL_MS,
  customerView,
  DELETE_CUSTOMER_SESSION_SQL,
  DELETE_CUSTOMER_SESSIONS_SQL,
  DELETE_CUSTOMER_STATEMENTS,
  DELETE_EXPIRED_CUSTOMER_SESSIONS_SQL,
  FAVORITES_SQL,
  INSERT_CUSTOMER_SESSION_SQL,
  INSERT_CUSTOMER_SQL,
  INSERT_POINTS_SQL,
  isOverdrawn,
  isPhoneLogin,
  MAX_FAVORITES,
  normalizeCustomerContacts,
  normalizeCustomerName,
  normalizeEmail,
  normalizeLogin,
  normalizeCustomerRegistration,
  normalizePhone,
  normalizePointsAdjustment,
  pointsEntryView,
  POINTS_HISTORY_SQL,
  REMOVE_FAVORITE_SQL,
  SEARCH_CUSTOMERS_SQL,
  storedCustomerPassword,
  UPDATE_CUSTOMER_EMAIL_SQL,
  UPDATE_CUSTOMER_SQL,
  UPSERT_CUSTOMER_CONTACT_SQL,
  balanceEntryView,
  BALANCE_HISTORY_SQL,
  changeBalanceStatements,
  INSERT_BALANCE_SQL,
  INSERT_OPERATOR_SQL,
  normalizeBalanceAdjustment,
  MEMBER_GROWTH_SQL,
  MEMBER_TIERS_DEFAULTS,
  membershipStatus,
  BIRTHDAY_PERK_DEFAULTS,
  MEMBER_BIRTHDAY_SQL,
  UPSERT_BIRTHDAY_SQL,
  DELETE_BIRTHDAY_SQL,
  MEMBER_CONSENT_SQL,
  UPSERT_CONSENT_SQL,
  UNSUBSCRIBE_BY_TOKEN_SQL,
  normalizeBirthday,
  isBirthdayMonth,
  BIRTHDAYS_DUE_SQL,
  CLAIM_GREETING_SQL,
  RELEASE_GREETING_SQL,
  birthdayDaysFor,
} from "./customer.mjs";
import {
  CUSTOMER_ORDERS_SQL,
  GUEST_ORDERS_BY_REQUEST_SQL,
  MAX_TRACKED_ORDERS,
} from "./ordering.mjs";
import { guestReservationView } from "./reservations.mjs";
import { DEFAULT_TENANT_ID } from "./tenant.mjs";
import {
  COUNT_EMAIL_CODE_ATTEMPT_SQL,
  DELETE_OLD_EMAIL_CODES_SQL,
  EMAIL_CODE_ATTEMPTS,
  EMAIL_CODE_RESEND_MS,
  EMAIL_CODE_TTL_MS,
  EMAIL_CODES_PER_HOUR,
  EMAIL_CODES_SINCE_SQL,
  emailCodeHash,
  INSERT_EMAIL_CODE_SQL,
  INSERT_OUTBOX_SQL,
  newEmailCode,
  OPEN_EMAIL_CODE_SQL,
  OUTBOX_SQL,
  USE_EMAIL_CODE_SQL,
  VERIFY_EMAIL_SQL,
} from "./email-verify.mjs";

// More than any guest has: an export is all of it.
const MAX_EXPORTED_ROWS = 100_000;

// A salt for nobody: an unknown email costs the same PBKDF2 work as a wrong
// password, so the time a sign-in takes does not say which it was.
const ABSENT_PASSWORD_SALT = "AAAAAAAAAAAAAAAAAAAAAA==";

function coded(message, code, status, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  Object.assign(error, extra);
  return error;
}

/**
 * The tenant this store reads and writes: `options.tenantId`, or the default
 * tenant when none is named — the one all data predating tenants lives under,
 * so a store built without a tenant keeps working exactly as before. Every
 * statement below takes that tenant as its first bound parameter.
 */
export function createCustomerStore(
  driver,
  { ordersFor, membershipConfig, tenantId: tenantIdOption } = {},
) {
  const tenantId = tenantIdOption ?? DEFAULT_TENANT_ID;
  // 会员等级 + 生日营销: the owner's levels, birthday perk and time zone, or
  // their defaults when the caller gives no getter (tests).
  const configNow =
    membershipConfig ??
    (async () => ({
      memberTiers: MEMBER_TIERS_DEFAULTS,
      birthdayPerk: BIRTHDAY_PERK_DEFAULTS,
      timeZone: "UTC",
    }));

  /** The restaurant's current month (1–12), for the birthday window. */
  function monthIn(timeZone) {
    const value = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      month: "2-digit",
    }).format(new Date());
    return Number(value);
  }

  /**
   * A member view with their 会员等级 and 生日营销 attached: lifetime top-up
   * (read-only), the level it reaches, that level's 会员价 discount, their
   * birthday, and whether this is their birthday month — in which case the
   * birthday discount is folded into `discountPercent` the till applies. A
   * plain `customerView` when neither is on. Never writes.
   */
  async function withMembership(view) {
    if (!view) return view;
    const { memberTiers, birthdayPerk, timeZone } = await configNow();
    const tiersOn = Boolean(memberTiers?.enabled);
    const perkOn = Boolean(birthdayPerk?.enabled);
    if (!tiersOn && !perkOn) return view;
    const growth = tiersOn
      ? await driver.first(MEMBER_GROWTH_SQL, tenantId, view.id)
      : null;
    const birthday = perkOn
      ? ((await driver.first(MEMBER_BIRTHDAY_SQL, tenantId, view.id)) ?? null)
      : null;
    const base = membershipStatus(
      growth?.growth_cents ?? 0,
      tiersOn ? memberTiers : MEMBER_TIERS_DEFAULTS,
    );
    const birthdayMonth =
      perkOn && isBirthdayMonth(birthday, monthIn(timeZone));
    const discountPercent = Math.max(
      base.discountPercent,
      birthdayMonth ? (birthdayPerk.discountPercent ?? 0) : 0,
    );
    return {
      ...view,
      membership: { ...base, discountPercent, birthdayMonth, birthday },
    };
  }

  async function openSession(row) {
    const token = newSessionToken();
    const at = now();
    await driver.run(DELETE_EXPIRED_CUSTOMER_SESSIONS_SQL, tenantId, at);
    await driver.run(
      INSERT_CUSTOMER_SESSION_SQL,
      tenantId,
      await hashSessionToken(token),
      row.id,
      new Date(Date.now() + CUSTOMER_SESSION_TTL_MS).toISOString(),
      at,
    );
    return {
      token,
      expiresInMs: CUSTOMER_SESSION_TTL_MS,
      customer: await withMembership(customerView(row)),
    };
  }

  async function byId(id) {
    return driver.first(CUSTOMER_BY_ID_SQL, tenantId, String(id));
  }

  /** Whether the password is this guest's; the row when it is. */
  async function withPassword(id, password) {
    const row = await byId(id);
    return row &&
      (await verifyPassword(
        String(password ?? ""),
        storedCustomerPassword(row),
      ))
      ? row
      : null;
  }

  async function findByContactKey(key) {
    if (!key) return null;
    return driver.first(CUSTOMER_BY_CONTACT_SQL, tenantId, key, key, key);
  }

  async function register(input) {
    const { email, contactEmail, phone, name, password } =
      normalizeCustomerRegistration(input);
    for (const key of [email, contactEmail, phone].filter(Boolean)) {
      if (await findByContactKey(key))
        throw coded(
          "This email or number already has an account: sign in",
          "EMAIL_TAKEN",
          409,
        );
    }
    const stored = await hashPassword(password);
    const id = uuid();
    const at = now();
    try {
      await driver.batch([
        [
          INSERT_CUSTOMER_SQL,
          [
            tenantId,
            id,
            email,
            name,
            stored.hash,
            stored.salt,
            stored.iterations,
            at,
            at,
          ],
        ],
        [
          UPSERT_CUSTOMER_CONTACT_SQL,
          [id, tenantId, phone, contactEmail, at],
        ],
      ]);
    } catch (error) {
      // Two registrations of one email at once: the UNIQUE index decides.
      if (/UNIQUE/i.test(String(error?.message)))
        throw coded(
          "This email or number already has an account: sign in",
          "EMAIL_TAKEN",
          409,
        );
      throw error;
    }
    return openSession(await byId(id));
  }

  async function signIn(loginInput, password) {
    const rawObj =
      loginInput && typeof loginInput === "object"
        ? loginInput
        : { email: loginInput };
    const rawEmail = String(rawObj.email ?? "").trim();
    const rawPhone = String(rawObj.phone ?? "").trim();
    let emailRow = null;
    let phoneRow = null;
    if (rawEmail) {
      let emailKey = rawEmail.toLowerCase();
      try {
        emailKey = rawObj.phone !== undefined ? normalizeEmail(rawEmail) : normalizeLogin(rawEmail);
      } catch {
        /* Invalid format: falls through cleanly as unknown account. */
      }
      emailRow = await findByContactKey(emailKey);
    }
    if (rawPhone) {
      let phoneKey = rawPhone;
      try {
        phoneKey = normalizePhone(rawPhone);
      } catch {
        /* Invalid format: falls through cleanly as unknown account. */
      }
      phoneRow = await findByContactKey(phoneKey);
    }
    const row =
      rawEmail && rawPhone
        ? emailRow && phoneRow && emailRow.id === phoneRow.id
          ? emailRow
          : null
        : emailRow ?? phoneRow;
    const stored = row
      ? storedCustomerPassword(row)
      : {
          hash: "",
          salt: ABSENT_PASSWORD_SALT,
          iterations: PASSWORD_ITERATIONS,
        };
    const correct = await verifyPassword(String(password ?? ""), stored);
    return row && correct ? openSession(row) : null;
  }

  /** The guest a token belongs to, or null — expired and revoked look the same. */
  async function session(token) {
    if (!token) return null;
    const tokenHash = await hashSessionToken(token);
    const row = await driver.first(CUSTOMER_SESSION_SQL, tenantId, tokenHash);
    if (!row) return null;
    if (row.expires_at <= now()) {
      await driver.run(DELETE_CUSTOMER_SESSION_SQL, tenantId, tokenHash);
      return null;
    }
    return withMembership(customerView(row));
  }

  async function signOut(token) {
    if (token)
      await driver.run(
        DELETE_CUSTOMER_SESSION_SQL,
        tenantId,
        await hashSessionToken(token),
      );
  }

  async function favorites(customerId) {
    return (await driver.all(FAVORITES_SQL, tenantId, customerId)).map(
      (row) => row.product_id,
    );
  }

  /** 会员营销授权: whether this member has opted in to marketing email. */
  async function marketingConsent(customerId) {
    const row = await driver.first(MEMBER_CONSENT_SQL, tenantId, String(customerId));
    return Boolean(row?.marketing);
  }

  /**
   * The member says yes or no to marketing email. A token is set the first
   * time and kept, so an unsubscribe link in an old email keeps working. Null
   * when there is no such member; otherwise the new state.
   */
  async function setMarketing(customerId, on) {
    const row = await byId(customerId);
    if (!row) return null;
    const existing = await driver.first(MEMBER_CONSENT_SQL, tenantId, row.id);
    const token = existing?.token ?? newSessionToken();
    await driver.run(
      UPSERT_CONSENT_SQL,
      tenantId,
      row.id,
      on ? 1 : 0,
      token,
      now(),
    );
    return Boolean(on);
  }

  async function profile(customerId) {
    const row = await byId(customerId);
    return row
      ? {
          customer: await withMembership(customerView(row)),
          favorites: await favorites(customerId),
          marketing: await marketingConsent(row.id),
        }
      : null;
  }

  /**
   * A new name, or a new password — always against the password in force, so
   * a phone left unlocked on a table is not enough. A new password ends every
   * other session and hands this one a fresh token. Null on a wrong password.
   */
  async function update(customerId, input) {
    const row = await withPassword(customerId, input?.currentPassword);
    if (!row) return null;
    const at = now();
    if (input.phone !== undefined || input.email !== undefined) {
      const currentPhone =
        row.contact_phone || (isPhoneLogin(row.email) ? row.email : "");
      const currentEmail = isPhoneLogin(row.email) ? "" : row.email;
      const contacts = normalizeCustomerContacts({
        phone: input.phone !== undefined ? input.phone : currentPhone,
        email: input.email !== undefined ? input.email : currentEmail,
      });
      for (const key of [
        contacts.primaryEmail,
        contacts.contactEmail,
        contacts.phone,
      ].filter(Boolean)) {
        const existing = await findByContactKey(key);
        if (existing && existing.id !== row.id) {
          throw coded(
            "This email or number already has an account: sign in",
            "EMAIL_TAKEN",
            409,
          );
        }
      }
      try {
        await driver.batch([
          ...(contacts.primaryEmail !== row.email
            ? [[UPDATE_CUSTOMER_EMAIL_SQL, [contacts.primaryEmail, at, tenantId, row.id]]]
            : []),
          [
            UPSERT_CUSTOMER_CONTACT_SQL,
            [row.id, tenantId, contacts.phone, contacts.contactEmail, at],
          ],
        ]);
      } catch (error) {
        if (/UNIQUE/i.test(String(error?.message)))
          throw coded(
            "This email or number already has an account: sign in",
            "EMAIL_TAKEN",
            409,
          );
        throw error;
      }
    }
    const name =
      input.name === undefined ? row.name : normalizeCustomerName(input.name);
    const stored =
      input.password === undefined
        ? storedCustomerPassword(row)
        : await hashPassword(assertPassword(input.password));
    await driver.run(
      UPDATE_CUSTOMER_SQL,
      name,
      stored.hash,
      stored.salt,
      stored.iterations,
      at,
      tenantId,
      row.id,
    );
    if (input.password === undefined)
      return { customer: await withMembership(customerView(await byId(row.id))) };
    await driver.run(DELETE_CUSTOMER_SESSIONS_SQL, tenantId, row.id);
    return openSession(await byId(row.id));
  }

  /** The account and everything that is only theirs, gone (GDPR). Their orders stay the restaurant's. */
  async function removeAccount(customerId) {
    await driver.batch(
      DELETE_CUSTOMER_STATEMENTS.map((sql) => [
        sql,
        [tenantId, String(customerId)],
      ]),
    );
  }

  async function setFavorite(customerId, productId, on) {
    const id = String(productId);
    if (on) {
      if (
        !(await driver.first(
          "SELECT id FROM products WHERE tenant_id = ? AND id = ?",
          tenantId,
          id,
        ))
      )
        throw coded("No such dish on the menu", "NOT_FOUND", 404);
      const current = await favorites(customerId);
      if (!current.includes(id) && current.length >= MAX_FAVORITES)
        throw coded(`At most ${MAX_FAVORITES} favourites`, "TOO_MANY", 400);
      await driver.run(ADD_FAVORITE_SQL, tenantId, customerId, id, now());
    } else {
      await driver.run(REMOVE_FAVORITE_SQL, tenantId, customerId, id);
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
        [
          INSERT_POINTS_SQL,
          [tenantId, id, String(customerId), delta, "adjust", id, note, at],
        ],
        [CHANGE_POINTS_SQL, [delta, at, tenantId, String(customerId)]],
      ]);
    } catch (error) {
      if (isOverdrawn(error))
        throw coded(
          "The guest does not have that many points",
          "NOT_ENOUGH_POINTS",
          409,
        );
      throw error;
    }
    return customerView(await byId(customerId));
  }

  /** A manager's hand-change of a member's balance (退款 / 调整), with a required note and who made it. */
  async function adjustBalance(customerId, input, operator = "") {
    const { deltaCents, note } = normalizeBalanceAdjustment(input);
    if (!(await byId(customerId))) return null;
    const at = now();
    const id = uuid();
    try {
      await driver.batch([
        [
          INSERT_BALANCE_SQL,
          [
            tenantId,
            id,
            String(customerId),
            deltaCents,
            "adjust",
            id,
            note,
            at,
          ],
        ],
        ...(operator
          ? [[INSERT_OPERATOR_SQL, [tenantId, id, String(operator)]]]
          : []),
        ...changeBalanceStatements(
          tenantId,
          String(customerId),
          deltaCents,
          at,
        ),
      ]);
    } catch (error) {
      if (isOverdrawn(error))
        throw coded(
          "The member does not have that much balance",
          "NOT_ENOUGH_BALANCE",
          409,
        );
      throw error;
    }
    return customerView(await byId(customerId));
  }

  async function balanceHistory(customerId, limit = 50) {
    return (
      await driver.all(
        BALANCE_HISTORY_SQL,
        tenantId,
        String(customerId),
        Math.min(Math.max(Number(limit) || 50, 1), 200),
      )
    ).map(balanceEntryView);
  }

  /**
   * A new code for the account's address (shared/email-verify.mjs): once a
   * minute, five times an hour. Returns the address and the code for the
   * caller to send; only the code's hash is kept. The codes are the tenant's
   * own; the old-code purge (DELETE_OLD_EMAIL_CODES_SQL) stays global by
   * design — see shared/email-verify.mjs.
   */
  async function issueEmailCode(customerId) {
    const row = await byId(customerId);
    if (!row) throw coded("Please sign in", "SIGN_IN_REQUIRED", 401);
    if (row.email_verified)
      throw coded("This email is verified already", "ALREADY_VERIFIED", 409);
    if (isPhoneLogin(row.email))
      throw coded(
        "This account signs in by mobile number: there is no email to verify",
        "NO_EMAIL",
        400,
      );
    const nowMs = Date.now();
    await driver.run(
      DELETE_OLD_EMAIL_CODES_SQL,
      new Date(nowMs - 86_400_000).toISOString(),
    );
    const recent = await driver.all(
      EMAIL_CODES_SINCE_SQL,
      tenantId,
      row.id,
      new Date(nowMs - 3_600_000).toISOString(),
    );
    if (recent.length) {
      const wait = Math.ceil(
        (Date.parse(recent[0].created_at) + EMAIL_CODE_RESEND_MS - nowMs) /
          1000,
      );
      if (wait > 0)
        throw coded(
          `Please wait ${wait} seconds before asking for another code`,
          "CODE_TOO_SOON",
          429,
          { retryAfter: wait },
        );
    }
    if (recent.length >= EMAIL_CODES_PER_HOUR)
      throw coded(
        "Too many codes this hour — please try again later",
        "TOO_MANY_CODES",
        429,
        { retryAfter: 3600 },
      );
    const code = newEmailCode();
    const at = new Date(nowMs).toISOString();
    await driver.run(
      INSERT_EMAIL_CODE_SQL,
      tenantId,
      uuid(),
      row.id,
      row.email,
      await emailCodeHash(row.id, code),
      new Date(nowMs + EMAIL_CODE_TTL_MS).toISOString(),
      at,
    );
    return { email: row.email, code };
  }

  /** The code the guest typed, against the newest one sent to their address as it is now. */
  async function verifyEmailCode(customerId, input) {
    const row = await byId(customerId);
    if (!row) throw coded("Please sign in", "SIGN_IN_REQUIRED", 401);
    if (row.email_verified) return customerView(row);
    const code = String(input ?? "").replace(/\s/g, "");
    const open = await driver.first(OPEN_EMAIL_CODE_SQL, tenantId, row.id, row.email);
    if (
      !open ||
      Date.parse(open.expires_at) <= Date.now() ||
      open.attempts >= EMAIL_CODE_ATTEMPTS
    ) {
      throw coded(
        "This code has expired — please ask for a new one",
        "CODE_EXPIRED",
        400,
      );
    }
    if (
      !/^\d{6}$/.test(code) ||
      (await emailCodeHash(row.id, code)) !== open.code_hash
    ) {
      await driver.run(COUNT_EMAIL_CODE_ATTEMPT_SQL, tenantId, open.id);
      const left = EMAIL_CODE_ATTEMPTS - open.attempts - 1;
      throw coded(
        left > 0 ? "Wrong code" : "Wrong code — please ask for a new one",
        left > 0 ? "WRONG_CODE" : "CODE_EXPIRED",
        400,
        { attemptsLeft: Math.max(left, 0) },
      );
    }
    const at = now();
    await driver.batch([
      [USE_EMAIL_CODE_SQL, [at, tenantId, open.id]],
      [VERIFY_EMAIL_SQL, [tenantId, row.id, row.email, at]],
    ]);
    return customerView(await byId(row.id));
  }

  return {
    register,
    signIn,
    issueEmailCode,
    verifyEmailCode,
    async emailVerified(customerId) {
      return Boolean((await byId(customerId))?.email_verified);
    },
    /** MAIL_OUTBOX only (shared/mail.mjs): the messages the tests read instead of an inbox. */
    async recordOutbox(message) {
      await driver.run(
        INSERT_OUTBOX_SQL,
        tenantId,
        uuid(),
        message.to,
        message.subject,
        message.text,
        now(),
      );
    },
    async outbox(limit = 20) {
      return (
        await driver.all(
          OUTBOX_SQL,
          tenantId,
          Math.min(Math.max(Number(limit) || 20, 1), 100),
        )
      ).map((row) => ({
        to: row.to_email,
        subject: row.subject,
        text: row.text,
        createdAt: row.created_at,
      }));
    },
    session,
    signOut,
    profile,
    update,
    setFavorite,
    marketingConsent,
    setMarketing,
    /** One-click unsubscribe by the token in a marketing email. True when a consent was turned off. */
    async unsubscribe(token) {
      const key = String(token ?? "");
      if (!key) return false;
      return (await driver.run(UNSUBSCRIBE_BY_TOKEN_SQL, now(), key)) > 0;
    },
    /** Deleting one's own account takes the password. Null on a wrong one. */
    async deleteOwn(customerId, password) {
      if (!(await withPassword(customerId, password))) return null;
      await removeAccount(customerId);
      return true;
    },
    /**
     * Everything kept about the account (GDPR Art. 15 and 20): the account
     * itself, favourites, every points entry and every order placed with it.
     * Never the password's hash, nor anyone else's data.
     */
    async exportData(customerId) {
      const row = await byId(customerId);
      if (!row) return null;
      return {
        account: { ...customerView(row), updatedAt: row.updated_at },
        favorites: await favorites(row.id),
        points: (
          await driver.all(
            POINTS_HISTORY_SQL,
            tenantId,
            row.id,
            MAX_EXPORTED_ROWS,
          )
        ).map(pointsEntryView),
        balance: (
          await driver.all(
            BALANCE_HISTORY_SQL,
            tenantId,
            row.id,
            MAX_EXPORTED_ROWS,
          )
        ).map(balanceEntryView),
        orders: await ordersFor(
          await driver.all(
            CUSTOMER_ORDERS_SQL,
            tenantId,
            row.id,
            MAX_EXPORTED_ROWS,
          ),
        ),
        reservations: (
          await driver.all(
            "SELECT * FROM reservations WHERE tenant_id = ? AND customer_id = ? ORDER BY date DESC, time DESC LIMIT ?",
            tenantId,
            row.id,
            MAX_EXPORTED_ROWS,
          )
        ).map(guestReservationView),
      };
    },
    async points(customerId, limit = 50) {
      return (
        await driver.all(
          POINTS_HISTORY_SQL,
          tenantId,
          String(customerId),
          Math.min(Math.max(Number(limit) || 50, 1), 200),
        )
      ).map(pointsEntryView);
    },
    async orders(customerId) {
      return ordersFor(
        await driver.all(
          CUSTOMER_ORDERS_SQL,
          tenantId,
          String(customerId),
          MAX_TRACKED_ORDERS,
        ),
      );
    },
    /** A guest without an account follows the orders their phone placed, by the ids it made up for them. */
    async ordersByRequest(ids) {
      const unique = [...new Set(ids.map(String).filter(Boolean))].slice(
        0,
        MAX_TRACKED_ORDERS,
      );
      if (!unique.length) return [];
      return ordersFor(
        await driver.all(
          GUEST_ORDERS_BY_REQUEST_SQL.replace(
            "(?)",
            `(${unique.map(() => "?").join(", ")})`,
          ),
          tenantId,
          ...unique,
        ),
      );
    },

    // ——— The console's side: the manager looks guests up, and helps them.
    async list(query = "", limit = 50) {
      const text = String(query ?? "")
        .trim()
        .toLowerCase()
        .slice(0, 64);
      return (
        await driver.all(
          SEARCH_CUSTOMERS_SQL,
          tenantId,
          text,
          text,
          text,
          text,
          Math.min(Math.max(Number(limit) || 50, 1), 200),
        )
      ).map(customerView);
    },
    async get(customerId) {
      const row = await byId(customerId);
      return row
        ? {
            customer: await withMembership(customerView(row)),
            points: (
              await driver.all(POINTS_HISTORY_SQL, tenantId, row.id, 50)
            ).map(pointsEntryView),
            balance: (
              await driver.all(BALANCE_HISTORY_SQL, tenantId, row.id, 50)
            ).map(balanceEntryView),
          }
        : null;
    },
    adjustPoints,
    adjustBalance,
    balanceHistory,
    /** A member found at the counter by their email or mobile number, or null. */
    async byLogin(login) {
      let key;
      try {
        key = normalizeLogin(login);
      } catch {
        return null;
      }
      const row = await findByContactKey(key);
      return row ? withMembership(customerView(row)) : null;
    },
    /** A guest who forgot their password gets a new one at the counter; every session of theirs ends. */
    async resetPassword(customerId, password) {
      const row = await byId(customerId);
      if (!row) return null;
      const stored = await hashPassword(assertPassword(password));
      await driver.run(
        UPDATE_CUSTOMER_SQL,
        row.name,
        stored.hash,
        stored.salt,
        stored.iterations,
        now(),
        tenantId,
        row.id,
      );
      await driver.run(DELETE_CUSTOMER_SESSIONS_SQL, tenantId, row.id);
      return customerView(await byId(row.id));
    },
    /** A guest as they see themselves, or null. */
    byIdView: async (customerId) =>
      withMembership(customerView(await byId(customerId))),
    /** 生日营销: a member's own birth month and day, or null. */
    async birthday(customerId) {
      return (
        (await driver.first(
          MEMBER_BIRTHDAY_SQL,
          tenantId,
          String(customerId),
        )) ?? null
      );
    },
    /** A member sets their birthday (month and day only); null when there is no such member. */
    async setBirthday(customerId, input) {
      const row = await byId(customerId);
      if (!row) return null;
      const birthday = normalizeBirthday(input);
      await driver.run(
        UPSERT_BIRTHDAY_SQL,
        tenantId,
        row.id,
        birthday.month,
        birthday.day,
        now(),
      );
      return birthday;
    },
    /** 生日祝福邮件: members to greet on `date` ({ year, month, day }), not yet greeted this year. */
    async birthdaysDue(date, limit = 200) {
      const days = birthdayDaysFor(date);
      return driver.all(
        BIRTHDAYS_DUE_SQL,
        tenantId,
        date.month,
        days[0],
        days[1] ?? days[0],
        date.year,
        limit,
      );
    },
    /** Claims this year's greeting for a member: true when this run is the one to send it. */
    async claimGreeting(customerId, year) {
      return (
        (await driver.run(
          CLAIM_GREETING_SQL,
          tenantId,
          String(customerId),
          year,
          now(),
        )) > 0
      );
    },
    /** Gives a claim back after a failed send, so the next run tries again. */
    async releaseGreeting(customerId, year) {
      await driver.run(
        RELEASE_GREETING_SQL,
        tenantId,
        String(customerId),
        year,
      );
    },
    /** A member clears their birthday. */
    async clearBirthday(customerId) {
      await driver.run(DELETE_BIRTHDAY_SQL, tenantId, String(customerId));
      return true;
    },
    async remove(customerId) {
      if (!(await byId(customerId))) return false;
      await removeAccount(customerId);
      return true;
    },
  };
}

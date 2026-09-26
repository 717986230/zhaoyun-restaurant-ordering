import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createDatabase } from "../database.mjs";
import { hashPassword } from "../../shared/rules.mjs";

const migration = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations", "0055_accounts.sql"), "utf8");

function withDirectory(run) {
  const directory = mkdtempSync(path.join(tmpdir(), "zy-account-"));
  return Promise.resolve(run(directory)).finally(() => rmSync(directory, { recursive: true, force: true }));
}

/** The password an owner set at the old one-password door, as it was stored there. */
async function setOldDoorPassword(db, password) {
  const stored = await hashPassword(password);
  db.exec("DELETE FROM accounts");
  db.prepare("INSERT INTO admin_gate (id, password_hash, password_salt, password_iterations, updated_at) VALUES (1, ?, ?, ?, '2026-09-01T00:00:00.000Z')")
    .run(stored.hash, stored.salt, stored.iterations);
  db.prepare("INSERT INTO admin_sessions (token_hash, expires_at, created_at) VALUES ('old', '2099-01-01', '2026-09-01')").run();
}

/**
 * Nobody is locked out by the change from one password to an account: the
 * password set at the old door is the account "admin"'s, on the Node server
 * when it starts and on D1 when 0055 runs.
 */
test("a password set at the old door becomes the account admin, on Node and on D1", () => withDirectory(async (directory) => {
  const file = path.join(directory, "db.sqlite");
  createDatabase(file).close();
  const raw = new DatabaseSync(file);
  await setOldDoorPassword(raw, "altes-passwort-1");
  raw.close();

  const database = createDatabase(file);
  assert.deepEqual(database.accountStatus(), { registered: true });
  const session = await database.signInAccount("admin", "altes-passwort-1");
  assert.equal(session.account.login, "admin");
  assert.equal((await database.signInAccount("admin", "falsch-falsch")), null);
  database.close();

  const d1 = new DatabaseSync(path.join(directory, "d1.sqlite"));
  d1.exec(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations", "0001_init.sql"), "utf8"));
  await setOldDoorPassword(d1, "altes-passwort-2");
  d1.exec(migration);
  const account = d1.prepare("SELECT login FROM accounts").all();
  assert.deepEqual(account.map((row) => row.login), ["admin"]);
  assert.equal(d1.prepare("SELECT COUNT(*) AS n FROM admin_gate").get().n, 0, "the old door is emptied");
  assert.equal(d1.prepare("SELECT COUNT(*) AS n FROM admin_sessions").get().n, 0, "and its sessions end");
  d1.exec(migration);
  assert.equal(d1.prepare("SELECT COUNT(*) AS n FROM accounts").get().n, 1, "running it twice changes nothing");
  d1.close();
}));

test("two registrations at once: one account, the other refused", () => withDirectory(async (directory) => {
  const database = createDatabase(path.join(directory, "db.sqlite"));
  const results = await Promise.all([
    database.registerAccount({ login: "first", password: "passwort-eins" }),
    database.registerAccount({ login: "second", password: "passwort-zwei" })
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(database.accountStatus().registered, true);
  database.close();
}));

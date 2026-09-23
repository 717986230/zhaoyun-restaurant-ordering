import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPassword, hashPassword, PASSWORD_ITERATIONS, verifyPassword, WORKERS_PBKDF2_MAX_ITERATIONS
} from "../../shared/rules.mjs";

/**
 * Deployed Workers refuse PBKDF2 above 100,000 iterations; local `wrangler
 * dev` and Node do not. So the contract suite passes at any count, and the only
 * place a count that is too high shows up is a restaurant owner's phone,
 * failing to set the admin password. This is the check that would have caught
 * it before it shipped.
 */
test("the password hash stays within what deployed Workers will run", () => {
  assert.ok(
    PASSWORD_ITERATIONS <= WORKERS_PBKDF2_MAX_ITERATIONS,
    `PASSWORD_ITERATIONS is ${PASSWORD_ITERATIONS}; Cloudflare Workers reject PBKDF2 above ${WORKERS_PBKDF2_MAX_ITERATIONS}`
  );
});

test("a stored hash verifies the password it was made from, and nothing else", async () => {
  const stored = await hashPassword("kueche-passwort");
  assert.equal(stored.iterations, PASSWORD_ITERATIONS, "the count used is recorded with the hash");
  assert.equal(await verifyPassword("kueche-passwort", stored), true);
  assert.equal(await verifyPassword("kueche-passwort!", stored), false);
});

test("six characters is enough for the console's password, five is not", () => {
  assert.equal(assertPassword("123456"), "123456");
  assert.throws(() => assertPassword("12345"), /at least 6 characters/);
});

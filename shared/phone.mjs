/**
 * A guest's mobile number, checked and written one way: "+43 660 1112233"
 * (`display`; `e164` is the same without spaces).
 *
 * No text message is sent to prove it (the owner's choice): the number is
 * checked for being one a phone could have. Written the way a guest in
 * Austria writes it — "0660 111 22 33", "+43 660 1112233", "0043 660…" —
 * it comes out the same, so the per-guest limits (reservations.mjs,
 * phoneKey) meet it however it was typed.
 *
 * Austrian and German numbers must be mobile numbers, by their prefixes;
 * a number from another country is checked for its length (E.164: a
 * country code and at most fifteen digits in all).
 */

/** Mobile prefixes after the country code, and how long the national number may be. */
const MOBILE = {
  // 0650–0699: every Austrian network, old six-digit subscriber numbers too.
  43: { prefix: /^6[5-9]/, min: 9, max: 13 },
  // 015x, 016x, 017x.
  49: { prefix: /^1[5-7]/, min: 10, max: 12 }
};

/**
 * `{ ok: true, e164, display }`, or `{ ok: false, reason }` with the reason as a
 * code: "EMPTY", "FORMAT" (letters, too short, too long) or "NOT_MOBILE".
 * A national number ("0660…") is read as Austrian unless `country` says
 * which country code to read it with.
 */
export function checkMobile(value, { country = "43" } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: false, reason: "EMPTY" };
  // What people put between digits; anything else (letters, "#") is not a number.
  if (!/^\+?[0-9 ()./-]+$/.test(raw)) return { ok: false, reason: "FORMAT" };
  let digits = raw.replace(/[^0-9+]/g, "");
  if (digits.indexOf("+") > 0) return { ok: false, reason: "FORMAT" };
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = `${country}${digits.slice(1)}`;
  else return { ok: false, reason: "FORMAT" };
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) return { ok: false, reason: "FORMAT" };
  // "0666 666 66 66": a number no network hands out.
  if (/^(\d)\1+$/.test(digits.slice(-9))) return { ok: false, reason: "FORMAT" };
  for (const [code, rule] of Object.entries(MOBILE)) {
    if (!digits.startsWith(code)) continue;
    const national = digits.slice(code.length);
    // A landline is a number, just not one to reach a guest on the way.
    if (!rule.prefix.test(national)) return { ok: false, reason: "NOT_MOBILE" };
    if (national.length < rule.min || national.length > rule.max) return { ok: false, reason: "FORMAT" };
    // As the floor reads it out and dials it: "+43 660 1234567".
    return { ok: true, e164: `+${digits}`, display: `+${code} ${national.slice(0, 3)} ${national.slice(3)}` };
  }
  return { ok: true, e164: `+${digits}`, display: `+${digits}` };
}

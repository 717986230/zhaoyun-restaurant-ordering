import test from "node:test";
import assert from "node:assert/strict";
import { checkMobile } from "../../shared/phone.mjs";

/** However a guest in Austria writes their mobile number, it comes out one way; anything else says why. */
test("a guest's mobile number is checked and written one way", () => {
  for (const typed of ["0660 1234567", "+43 660 1234567", "0043 660 123 45 67", "+43 (660) 123-4567", "0660/1234567"]) {
    assert.deepEqual(checkMobile(typed), { ok: true, e164: "+436601234567", display: "+43 660 1234567" }, typed);
  }
  assert.equal(checkMobile("0664 123456").display, "+43 664 123456", "an old six-digit subscriber number");
  assert.equal(checkMobile("+49 151 12345678").display, "+49 151 12345678");
  assert.equal(checkMobile("+44 7911 123456").display, "+447911123456", "another country: by its length");
  assert.equal(checkMobile("").reason, "EMPTY");
  for (const typed of ["call me", "660 1234567", "12345", "0660 12", "+43 660 12345678901", "0660 666666666", "+1 23", "06601234567#"]) {
    assert.equal(checkMobile(typed).reason, "FORMAT", typed);
  }
  for (const typed of ["01 5877777", "+43 1 5877777", "02742 123456", "+49 30 1234567"]) {
    assert.equal(checkMobile(typed).reason, "NOT_MOBILE", typed);
  }
});

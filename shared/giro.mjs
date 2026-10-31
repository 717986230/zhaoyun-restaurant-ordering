/**
 * EPC GiroCode: the QR a guest scans with their bank app to pay by SEPA
 * transfer, no card terminal and no payment processor in between. The shop
 * fills in its own account once (beneficiary + IBAN, BIC optional); the POS
 * then shows a code for the amount due, and the guest's bank app opens a
 * transfer already filled in. Nothing but a picture is involved — the money
 * moves bank to bank — so this adds no processing fee and no new dependency.
 *
 * The payload is the EPC069-12 "BCD" format (version 002, UTF-8). This module
 * is pure and has no DOM or `node:` imports, so it runs on Workers and is unit
 * tested on its own; the POS turns the string it returns into a QR image.
 */

export const SEPA_PAYMENT_DEFAULTS = { enabled: false, beneficiary: "", iban: "", bic: "" };

/** The most a GiroCode may carry: 999,999,999.99 €, per the EPC spec. */
export const SEPA_MAX_CENTS = 99_999_999_999;

const IBAN_RE = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/;
const BIC_RE = /^[A-Z0-9]{8}([A-Z0-9]{3})?$/;

/** One line, trimmed, with the line breaks that would corrupt the payload gone. */
function oneLine(value, max) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

/** An IBAN as the spec wants it: no spaces, upper case. Does not validate. */
export function normalizeIban(value) {
  return String(value ?? "").replace(/\s+/g, "").toUpperCase();
}

export function isValidIban(iban) {
  return IBAN_RE.test(iban);
}

/** A BIC upper-cased and space-stripped; "" stays "" (BIC is optional in v002). */
export function normalizeBic(value) {
  return String(value ?? "").replace(/\s+/g, "").toUpperCase();
}

/**
 * The shop's SEPA settings as they are stored: a flag and the account. The
 * form of a non-empty IBAN or BIC is checked here, so a typo is caught when
 * the owner saves, not when a guest tries to pay.
 */
export function normalizeSepaPayment(value) {
  const input = value && typeof value === "object" ? value : {};
  const iban = normalizeIban(input.iban);
  if (iban && !isValidIban(iban)) throw new Error("IBAN has the wrong form");
  const bic = normalizeBic(input.bic);
  if (bic && !BIC_RE.test(bic)) throw new Error("BIC has the wrong form");
  return {
    enabled: Boolean(input.enabled),
    beneficiary: oneLine(input.beneficiary, 70),
    iban,
    bic
  };
}

/** "EUR12.50" for the amount line; throws if it is outside what a GiroCode holds. */
export function epcAmount(cents) {
  if (!Number.isInteger(cents) || cents < 1 || cents > SEPA_MAX_CENTS) throw new Error("Amount is out of range for a GiroCode");
  return `EUR${(cents / 100).toFixed(2)}`;
}

/**
 * The scannable payload for one payment. `beneficiary` and `iban` are the
 * shop's, `amountCents` the amount due, `reference` the free-text note the
 * guest's bank shows (the table or pickup number). Throws if the account or
 * amount is missing or malformed, so the POS never shows an unscannable code.
 */
export function epcQrPayload({ beneficiary, iban, amountCents, reference = "", bic = "" } = {}) {
  const name = oneLine(beneficiary, 70);
  if (!name) throw new Error("A beneficiary name is required");
  const account = normalizeIban(iban);
  if (!isValidIban(account)) throw new Error("A valid IBAN is required");
  const swift = normalizeBic(bic);
  if (swift && !BIC_RE.test(swift)) throw new Error("BIC has the wrong form");
  return [
    "BCD",
    "002",
    "1",
    "SCT",
    swift,
    name,
    account,
    epcAmount(amountCents),
    "",
    "",
    oneLine(reference, 140)
  ].join("\n");
}

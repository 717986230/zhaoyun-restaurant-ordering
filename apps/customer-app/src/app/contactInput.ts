import { checkMobile } from "../../../../shared/phone.mjs";

export interface CountryDialOption {
  code: string;
  flag: string;
  label: string;
}

export const COUNTRY_DIAL_CODES: readonly CountryDialOption[] = [
  { code: "43", flag: "🇦🇹", label: "+43" },
  { code: "49", flag: "🇩🇪", label: "+49" },
  { code: "41", flag: "🇨🇭", label: "+41" },
  { code: "86", flag: "🇨🇳", label: "+86" },
  { code: "39", flag: "🇮🇹", label: "+39" },
  { code: "33", flag: "🇫🇷", label: "+33" },
  { code: "44", flag: "🇬🇧", label: "+44" },
  { code: "31", flag: "🇳🇱", label: "+31" },
  { code: "34", flag: "🇪🇸", label: "+34" },
  { code: "1", flag: "🇺🇸", label: "+1" }
];

export const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

export type ContactValidation =
  | { ok: true; kind: "email"; value: string }
  | { ok: true; kind: "phone"; value: string; e164: string }
  | { ok: false; reason: "EMPTY" | "EMAIL_FORMAT" | "NOT_MOBILE" | "PHONE_FORMAT" };

/**
 * Validates and normalizes an email address or mobile phone number with an
 * optional country dial code (default "43" for Austria).
 *
 * - Inputs containing "@" are validated strictly as email addresses.
 * - Inputs starting with "+" or "00" or national trunk "0" pass straight to
 *   `checkMobile(raw, { country: dialCode })`.
 * - Bare subscriber digits (e.g. "13800138000" under +86 or "6601234567" under +43)
 *   are prefixed with `+${dialCode}` before validation.
 */
export function validateEmailOrPhone(raw: string, dialCode = "43"): ContactValidation {
  const clean = raw.trim();
  if (!clean) return { ok: false, reason: "EMPTY" };
  if (clean.includes("@")) {
    return EMAIL_SHAPE.test(clean)
      ? { ok: true, kind: "email", value: clean }
      : { ok: false, reason: "EMAIL_FORMAT" };
  }
  const hasExplicitPrefix = clean.startsWith("+") || clean.startsWith("00") || clean.startsWith("0");
  const candidate = hasExplicitPrefix
    ? clean
    : `+${dialCode}${clean.replace(/[^0-9]/g, "")}`;
  const mobile = checkMobile(candidate, { country: dialCode });
  if (mobile.ok) {
    return {
      ok: true,
      kind: "phone",
      value: clean.startsWith("+") || clean.startsWith("00") ? clean : hasExplicitPrefix ? clean : mobile.e164,
      e164: mobile.e164
    };
  }
  return {
    ok: false,
    reason: mobile.reason === "NOT_MOBILE" ? "NOT_MOBILE" : "PHONE_FORMAT"
  };
}

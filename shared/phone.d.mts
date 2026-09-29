/** Types for shared/phone.mjs, which the booking page runs too (the same rule on both sides). */
export type MobileCheck = { ok: true; e164: string; display: string } | { ok: false; reason: "EMPTY" | "FORMAT" | "NOT_MOBILE" };
export function checkMobile(value: unknown, options?: { country?: string }): MobileCheck;

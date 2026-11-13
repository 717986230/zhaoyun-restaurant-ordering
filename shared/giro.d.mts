/** Types for shared/giro.mjs, the EPC GiroCode payload the POS renders as a QR. */
export interface SepaPayment {
  enabled: boolean;
  beneficiary: string;
  iban: string;
  bic: string;
}
export const SEPA_PAYMENT_DEFAULTS: SepaPayment;
export const SEPA_MAX_CENTS: number;
export function normalizeIban(value: unknown): string;
export function isValidIban(iban: string): boolean;
export function normalizeBic(value: unknown): string;
export function normalizeSepaPayment(value: unknown): SepaPayment;
export function epcAmount(cents: number): string;
export function epcQrPayload(input: { beneficiary: string; iban: string; amountCents: number; reference?: string; bic?: string }): string;

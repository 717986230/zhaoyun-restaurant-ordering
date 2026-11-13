import { describe, expect, it } from "vitest";
// The shared rule the POS and the backend both use, tested on its own.
import { epcAmount, epcQrPayload, isValidIban, normalizeIban, normalizeSepaPayment } from "../../../shared/giro.mjs";

const IBAN = "AT611904300234573201";

describe("normalizeIban / isValidIban", () => {
  it("strips spaces and upper-cases", () => {
    expect(normalizeIban(" at61 1904 3002 3457 3201 ")).toBe(IBAN);
  });
  it("accepts a well-formed IBAN and rejects a malformed one", () => {
    expect(isValidIban(IBAN)).toBe(true);
    expect(isValidIban("AT61")).toBe(false);
    expect(isValidIban("1234567890123456")).toBe(false);
  });
});

describe("normalizeSepaPayment", () => {
  it("fills defaults and normalizes the account", () => {
    expect(normalizeSepaPayment({ enabled: true, beneficiary: "  Zhaoyun GmbH ", iban: "at61 1904 3002 3457 3201", bic: "gibaatwwxxx" }))
      .toEqual({ enabled: true, beneficiary: "Zhaoyun GmbH", iban: IBAN, bic: "GIBAATWWXXX" });
  });
  it("tolerates an empty account (owner enables first, fills later)", () => {
    expect(normalizeSepaPayment({ enabled: true })).toEqual({ enabled: true, beneficiary: "", iban: "", bic: "" });
  });
  it("rejects a malformed IBAN when one is given", () => {
    expect(() => normalizeSepaPayment({ iban: "AT99" })).toThrow();
  });
  it("rejects a malformed BIC when one is given", () => {
    expect(() => normalizeSepaPayment({ bic: "TOO-SHORT" })).toThrow();
  });
});

describe("epcAmount", () => {
  it("formats cents as EUR with two decimals", () => {
    expect(epcAmount(1250)).toBe("EUR12.50");
    expect(epcAmount(1)).toBe("EUR0.01");
  });
  it("rejects zero, negatives and non-integers", () => {
    expect(() => epcAmount(0)).toThrow();
    expect(() => epcAmount(-5)).toThrow();
    expect(() => epcAmount(12.5)).toThrow();
  });
});

describe("epcQrPayload", () => {
  it("builds the 11-line BCD/002 payload", () => {
    const payload = epcQrPayload({ beneficiary: "Zhaoyun GmbH", iban: IBAN, amountCents: 4200, reference: "Tisch 7" });
    expect(payload.split("\n")).toEqual([
      "BCD", "002", "1", "SCT", "", "Zhaoyun GmbH", IBAN, "EUR42.00", "", "", "Tisch 7"
    ]);
  });
  it("includes the BIC when given and strips line breaks from the reference", () => {
    const payload = epcQrPayload({ beneficiary: "Z", iban: IBAN, bic: "GIBAATWWXXX", amountCents: 100, reference: "a\nb" });
    const lines = payload.split("\n");
    expect(lines[4]).toBe("GIBAATWWXXX");
    expect(lines[10]).toBe("a b");
  });
  it("throws without a beneficiary or a valid IBAN", () => {
    expect(() => epcQrPayload({ beneficiary: "", iban: IBAN, amountCents: 100 })).toThrow();
    expect(() => epcQrPayload({ beneficiary: "Z", iban: "AT00", amountCents: 100 })).toThrow();
  });
});

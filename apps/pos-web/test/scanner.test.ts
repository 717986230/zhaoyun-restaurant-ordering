import { describe, expect, it } from "vitest";
import { bookingReferenceFrom, scannedFrom } from "../src/BookingScanner";

describe("a code read at the door", () => {
  it("is a booking's: its number, from the QR code or typed", () => {
    expect(scannedFrom("ZYRES:PR6RPB")).toEqual({ kind: "booking", reference: "PR6RPB" });
    expect(scannedFrom(" pr6 rpb ")).toEqual({ kind: "booking", reference: "PR6RPB" });
    expect(bookingReferenceFrom("ZYRES:ab")).toBeNull();
  });

  it("is a member's: their account, for the first visit's points", () => {
    expect(scannedFrom("ZYMEM:3f2b1c9e-0d4a-4c1b-9e8f-1a2b3c4d5e6f")).toEqual({ kind: "member", id: "3f2b1c9e-0d4a-4c1b-9e8f-1a2b3c4d5e6f" });
    expect(scannedFrom("ZYMEM:short")).toBeNull();
  });

  it("is nothing else: a link or a stranger's code is not read as either", () => {
    expect(scannedFrom("https://example.com/menu")).toBeNull();
    expect(scannedFrom("ZYMEM:../../admin")).toBeNull();
  });
});

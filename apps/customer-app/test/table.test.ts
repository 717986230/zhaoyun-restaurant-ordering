import { describe, expect, it } from "vitest";
import { DEFAULT_TABLE_NO, normalizeTableNo, normalizeToken, resolveTableNo } from "../src/app/table";

describe("Table identity", () => {
  it("prefers the table from the kiosk url over the stored one", () => {
    expect(resolveTableNo("?table=12", "07")).toEqual({ tableNo: "12", configured: true, token: "" });
  });

  it("uses the stored table when the url carries none", () => {
    expect(resolveTableNo("", "a-3")).toEqual({ tableNo: "A-3", configured: true, token: "" });
  });

  it("reports unconfigured devices instead of pretending they are table 08", () => {
    expect(resolveTableNo("", null)).toEqual({ tableNo: DEFAULT_TABLE_NO, configured: false, token: "" });
    expect(resolveTableNo("?table=", "  ")).toEqual({ tableNo: DEFAULT_TABLE_NO, configured: false, token: "" });
  });

  it("rejects table numbers the backend would not accept", () => {
    expect(normalizeTableNo("../etc")).toBeNull();
    expect(normalizeTableNo("-1")).toBeNull();
    expect(normalizeTableNo("123456789")).toBeNull();
    expect(normalizeTableNo("  t-12 ")).toBe("T-12");
    expect(normalizeTableNo("terrasse")).toBe("TERRASSE");
  });

  it("takes the table token from the kiosk link", () => {
    expect(resolveTableNo("?table=12&k=abcdefgh1234", null)).toEqual({ tableNo: "12", configured: true, token: "abcdefgh1234" });
  });

  it("keeps the stored token only for the table it belongs to", () => {
    expect(resolveTableNo("?table=12", "12", "abcdefgh1234").token).toBe("abcdefgh1234");
    expect(resolveTableNo("?table=13", "12", "abcdefgh1234").token).toBe("");
  });

  it("ignores tokens that cannot be real", () => {
    expect(normalizeToken("short")).toBe("");
    expect(normalizeToken("../../etc/passwd")).toBe("");
    expect(normalizeToken("Ab_1-cdefghij")).toBe("Ab_1-cdefghij");
  });
});

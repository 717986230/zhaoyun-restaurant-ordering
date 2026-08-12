import { describe, expect, it } from "vitest";
import { DEFAULT_TABLE_NO, normalizeTableNo, resolveTableNo } from "../src/app/table";

describe("Table identity", () => {
  it("prefers the table from the kiosk url over the stored one", () => {
    expect(resolveTableNo("?table=12", "07")).toEqual({ tableNo: "12", configured: true });
  });

  it("uses the stored table when the url carries none", () => {
    expect(resolveTableNo("", "a-3")).toEqual({ tableNo: "A-3", configured: true });
  });

  it("reports unconfigured devices instead of pretending they are table 08", () => {
    expect(resolveTableNo("", null)).toEqual({ tableNo: DEFAULT_TABLE_NO, configured: false });
    expect(resolveTableNo("?table=", "  ")).toEqual({ tableNo: DEFAULT_TABLE_NO, configured: false });
  });

  it("rejects table numbers the backend would not accept", () => {
    expect(normalizeTableNo("../etc")).toBeNull();
    expect(normalizeTableNo("-1")).toBeNull();
    expect(normalizeTableNo("123456789")).toBeNull();
    expect(normalizeTableNo("  t-12 ")).toBe("T-12");
    expect(normalizeTableNo("terrasse")).toBe("TERRASSE");
  });
});

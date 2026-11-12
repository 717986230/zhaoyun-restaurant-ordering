import { describe, expect, it } from "vitest";
import type { ApiSalesReport } from "@zhaoyun/contracts";
import type { CopyKey } from "../../app/i18n";
import { fullReportRows } from "./ReportsPanel";

/** The copy function echoes its key, so the test asserts structure, not wording. */
const t = (key: CopyKey) => key as string;
const itemName = (item: ApiSalesReport["items"][number]) => item.name;

function report(overrides: Partial<ApiSalesReport> = {}): ApiSalesReport {
  return {
    from: "2026-10-01",
    to: "2026-10-01",
    timeZone: "Europe/Vienna",
    totals: {
      sales: 2, stornos: 0, firstReceiptNo: 1, lastReceiptNo: 2,
      grossCents: 5000, vat: [{ percent: 10, grossCents: 5000, netCents: 4545, vatCents: 455 }],
      payments: { cash: 3000, card: 2000, voucher: 0, balance: 0 }, vouchersSoldCents: 0,
      cashCents: 3000, receipts: 2, averageCents: 2500
    },
    days: [{ date: "2026-10-01", receipts: 2, grossCents: 5000 }],
    hours: [],
    items: [{ name: "Schnitzel", names: null, quantity: 3, grossCents: 4200 }],
    staff: [{ name: "Anna", receipts: 2, grossCents: 5000, tipsCents: 150 }],
    ...overrides
  };
}

describe("fullReportRows", () => {
  it("leads with the title and the date span", () => {
    const rows = fullReportRows(report(), t, itemName);
    expect(rows[0]).toEqual(["reportsTitle", "2026-10-01 — 2026-10-01"]);
  });

  it("writes euro amounts with two decimals, not cents", () => {
    const rows = fullReportRows(report(), t, itemName);
    expect(rows).toContainEqual(["reportGross", "50.00"]);
    expect(rows).toContainEqual(["reportAverage", "25.00"]);
  });

  it("includes a payments section and every payment type", () => {
    const rows = fullReportRows(report(), t, itemName).map((row) => row[0]);
    expect(rows).toContain("reportPayments");
    expect(rows).toContain("reportCash");
    expect(rows).toContain("reportCard");
    expect(rows).toContain("reportVoucher");
  });

  it("lists each dish with quantity and gross", () => {
    const rows = fullReportRows(report(), t, itemName);
    expect(rows).toContainEqual(["Schnitzel", 3, "42.00"]);
  });

  it("lists each waiter with tips", () => {
    const rows = fullReportRows(report(), t, itemName);
    expect(rows).toContainEqual(["Anna", 2, "50.00", "1.50"]);
  });

  it("omits the discounts line when there were none", () => {
    const rows = fullReportRows(report(), t, itemName).map((row) => row[0]);
    expect(rows).not.toContain("reportDiscounts");
  });

  it("shows the discounts line when there were some", () => {
    const rows = fullReportRows(report({ totals: { ...report().totals, discountCents: -250 } }), t, itemName);
    expect(rows).toContainEqual(["reportDiscounts", "-2.50"]);
  });
});

import { describe, expect, it } from "vitest";
import { splitCents } from "../src/PayScreen";

describe("AA 均分: splitting a bill by headcount", () => {
  it("splits to the cent, the shares adding back to the total", () => {
    for (const total of [0, 1, 100, 1000, 3001, 9999, 123_45]) {
      for (const n of [1, 2, 3, 4, 7, 20]) {
        const shares = splitCents(total, n);
        expect(shares).toHaveLength(n);
        expect(shares.reduce((sum, share) => sum + share, 0)).toBe(total);
      }
    }
  });

  it("gives the odd cents one each to the first shares, none off by more than a cent", () => {
    // 30.01 three ways: 10.01, 10.00, 10.00.
    expect(splitCents(3001, 3)).toEqual([1001, 1000, 1000]);
    // 10.00 three ways: 3.34, 3.33, 3.33.
    expect(splitCents(1000, 3)).toEqual([334, 333, 333]);
    const shares = splitCents(9998, 7);
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
  });
});

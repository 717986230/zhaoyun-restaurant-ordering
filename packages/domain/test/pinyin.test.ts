import { describe, expect, it } from "vitest";
import { matchesTextOrPinyin, pinyinInitials } from "../src/index";

describe("Pinyin initials dish search", () => {
  it("extracts lowercase initials from Chinese characters and keeps ASCII/digits", () => {
    expect(pinyinInitials("水煮牛肉")).toBe("sznr");
    expect(pinyinInitials("牛肉拉面")).toBe("nrlm");
    expect(pinyinInitials("25周年特饮")).toBe("25znty");
  });

  it("matches direct substrings as well as Pinyin initials", () => {
    expect(matchesTextOrPinyin("sz", ["水煮牛肉", "Sichuan Rindfleisch"])).toBe(true);
    expect(matchesTextOrPinyin("sznr", ["水煮牛肉"])).toBe(true);
    expect(matchesTextOrPinyin("rind", ["水煮牛肉", "Sichuan Rindfleisch"])).toBe(true);
    expect(matchesTextOrPinyin("水煮", ["水煮牛肉"])).toBe(true);
    expect(matchesTextOrPinyin("xyz", ["水煮牛肉", "Rindfleisch"])).toBe(false);
  });
});

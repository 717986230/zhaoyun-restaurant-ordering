import { describe, expect, it } from "vitest";
import { NAV_ALL, NAV_FEATURED, NAV_SETS, orderNavTabs } from "../src/index";

const tabs = [NAV_FEATURED, NAV_SETS, NAV_ALL, "RAMEN", "SUSHI", "DRINKS"];

describe("the menu's tab order", () => {
  it("puts the set menus first and keeps the usual order behind them", () => {
    expect(orderNavTabs(tabs)).toEqual([NAV_SETS, NAV_FEATURED, NAV_ALL, "RAMEN", "SUSHI", "DRINKS"]);
  });

  it("puts the owner's two next, and the rest in their usual order", () => {
    expect(orderNavTabs(tabs, ["SUSHI", NAV_ALL])).toEqual([NAV_SETS, "SUSHI", NAV_ALL, NAV_FEATURED, "RAMEN", "DRINKS"]);
  });

  it("cannot conflict: a repeat counts once, a missing tab is skipped, a third is ignored", () => {
    expect(orderNavTabs(tabs, ["SUSHI", "SUSHI", "GONE", "RAMEN", "DRINKS"])).toEqual([NAV_SETS, "SUSHI", "RAMEN", NAV_FEATURED, NAV_ALL, "DRINKS"]);
    // The set menus cannot be moved from first, nor listed twice.
    expect(orderNavTabs(tabs, [NAV_SETS, "RAMEN"])).toEqual([NAV_SETS, "RAMEN", NAV_FEATURED, NAV_ALL, "SUSHI", "DRINKS"]);
  });

  it("without a set menus page, the owner's choices lead", () => {
    expect(orderNavTabs([NAV_FEATURED, NAV_ALL, "RAMEN"], ["RAMEN"])).toEqual(["RAMEN", NAV_FEATURED, NAV_ALL]);
  });
});

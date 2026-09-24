import { describe, expect, it } from "vitest";
import { NAV_ALL, NAV_FEATURED, NAV_SETS, orderNavTabs } from "../src/index";

const tabs = [NAV_FEATURED, NAV_SETS, NAV_ALL, "RAMEN", "SUSHI", "DRINKS"];

describe("the menu's tab order", () => {
  it("keeps the usual order when the owner has chosen nothing", () => {
    expect(orderNavTabs(tabs)).toEqual(tabs);
  });

  it("puts the owner's three first, and the rest in their usual order", () => {
    expect(orderNavTabs(tabs, ["SUSHI", NAV_SETS, NAV_ALL])).toEqual(["SUSHI", NAV_SETS, NAV_ALL, NAV_FEATURED, "RAMEN", "DRINKS"]);
    // Nothing is fixed: any tab may lead, the set menus and the promotions included.
    expect(orderNavTabs(tabs, ["RAMEN"])[0]).toBe("RAMEN");
  });

  it("cannot conflict: a repeat counts once, a missing tab is skipped, a fourth is ignored", () => {
    expect(orderNavTabs(tabs, ["SUSHI", "SUSHI", "GONE", "RAMEN", NAV_SETS, "DRINKS"])).toEqual(["SUSHI", "RAMEN", NAV_SETS, NAV_FEATURED, NAV_ALL, "DRINKS"]);
  });

  it("a page that is not on the menu is passed over", () => {
    expect(orderNavTabs([NAV_ALL, "RAMEN"], [NAV_SETS, "RAMEN"])).toEqual(["RAMEN", NAV_ALL]);
  });
});

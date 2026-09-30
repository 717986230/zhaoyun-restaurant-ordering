import { describe, expect, it } from "vitest";
import { drinkTabs, NAV_ALL, NAV_DRINKS, NAV_FEATURED, NAV_SETS, orderNavTabs } from "../src/index";

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

describe("the drinks page", () => {
  const drinks = new Set(["COFFEE", "TEA", "BEER"]);

  it("takes the place of the first drink category, and the others drop out", () => {
    expect(drinkTabs(["RAMEN", "COFFEE", "SUSHI", "TEA", "BEER"], drinks)).toEqual(["RAMEN", NAV_DRINKS, "SUSHI"]);
  });

  it("is not there on a menu with no drinks", () => {
    expect(drinkTabs(["RAMEN", "SUSHI"], drinks)).toEqual(["RAMEN", "SUSHI"]);
  });

  it("can be pinned like any other tab", () => {
    expect(orderNavTabs([NAV_ALL, ...drinkTabs(["RAMEN", "BEER"], drinks)], [NAV_DRINKS])).toEqual([NAV_DRINKS, NAV_ALL, "RAMEN"]);
  });
});

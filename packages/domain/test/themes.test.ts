import { describe, expect, it } from "vitest";
import { festiveThemeInSeason, inSeason, MENU_THEMES, themeOutOfSeason } from "../src/index";

const on = (month: number, day: number) => new Date(2026, month - 1, day);

describe("a festive style's season", () => {
  it("covers the days in its window, and no others", () => {
    const christmas = MENU_THEMES.christmas.festive!.season;
    expect(inSeason(christmas, on(12, 20))).toBe(true);
    expect(inSeason(christmas, on(10, 12))).toBe(false);
  });

  it("wraps the new year when the window does", () => {
    const window = { from: [12, 28] as [number, number], to: [1, 3] as [number, number] };
    expect(inSeason(window, on(12, 31))).toBe(true);
    expect(inSeason(window, on(1, 2))).toBe(true);
    expect(inSeason(window, on(6, 1))).toBe(false);
  });

  it("flags a festive style left on past its season, and nothing in season", () => {
    expect(themeOutOfSeason("christmas", on(10, 12))?.id).toBe("christmas");
    expect(themeOutOfSeason("christmas", on(12, 20))).toBeUndefined();
    // An everyday style has no season, so it is never out of one.
    expect(themeOutOfSeason("jade", on(10, 12))).toBeUndefined();
  });

  it("names the festive style that fits a date, if any", () => {
    expect(festiveThemeInSeason(on(12, 20))?.id).toBe("christmas");
    expect(festiveThemeInSeason(on(10, 30))?.id).toBe("halloween");
    // Mid-October falls between National Day and Halloween: nothing fits.
    expect(festiveThemeInSeason(on(10, 12))).toBeUndefined();
  });
});

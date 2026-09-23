import { describe, expect, it } from "vitest";
import { DEFAULT_MENU_LANGUAGES, LANGUAGE_INFO, MENU_LANGUAGES, resolveMenuLanguage } from "../src/languages";
import { DEFAULT_MENU_LANGUAGES as RULE_DEFAULT, MENU_LANGUAGES as RULE_LANGUAGES } from "../../../shared/rules.mjs";

describe("menu languages", () => {
  it("agree with the backend's list and default", () => {
    expect(MENU_LANGUAGES).toEqual(RULE_LANGUAGES);
    expect(DEFAULT_MENU_LANGUAGES).toEqual(RULE_DEFAULT);
  });

  it("each have a flag an <img> can draw", () => {
    for (const language of MENU_LANGUAGES) {
      const { flag } = LANGUAGE_INFO[language];
      expect(flag.startsWith("data:image/svg+xml,")).toBe(true);
      expect(decodeURIComponent(flag)).toMatch(/^data:image\/svg\+xml,<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*>.*<\/svg>$/s);
    }
  });

  it("keep the guest's own pick while the menu still offers it", () => {
    expect(resolveMenuLanguage("en", ["en", "de"], ["de-AT"])).toBe("en");
  });

  it("drop a pick the restaurant has since switched off", () => {
    // A guest who chose Chinese last week, after the restaurant turned it off.
    expect(resolveMenuLanguage("zh", ["en", "de"], ["en-GB"])).toBe("en");
  });

  it("follow the phone's language when it is offered", () => {
    expect(resolveMenuLanguage(null, ["en", "de"], ["de-AT", "en"])).toBe("de");
    expect(resolveMenuLanguage(null, ["zh", "en", "de"], ["zh-CN"])).toBe("zh");
  });

  it("fall back to German, then English, then Chinese", () => {
    expect(resolveMenuLanguage(null, ["en", "de"], ["fr-FR"])).toBe("de");
    expect(resolveMenuLanguage(null, ["zh", "en"], ["fr-FR"])).toBe("en");
    expect(resolveMenuLanguage(null, ["zh"], [])).toBe("zh");
  });
});

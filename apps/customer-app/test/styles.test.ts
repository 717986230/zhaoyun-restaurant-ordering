import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MENU_THEMES } from "@zhaoyun/domain";

/**
 * The palette, as assertions.
 *
 * Two stylesheets carry the whole look of the system, and both had grown by
 * accretion: a colour was needed, a hex was typed, and after a hundred of those
 * there was no palette left to change — only a hundred edits to make. So every
 * colour now lives in one `:root` block per file and nothing else may write one
 * down. That is the first test here, and it is what makes re-skinning the app a
 * ten-line diff.
 *
 * The rest are the parts a designer's eye is not allowed to decide alone.
 * Allergen letters are legal information under the LMIV: a guest with a peanut
 * allergy reads `A · C · N` off a tablet in a dim dining room, so its contrast
 * is a requirement, not a preference. And the palette has one accent on
 * purpose — gold on near-black is exactly the look the restaurant is trying not
 * to have — so a warm saturated colour creeping back into the guest app fails
 * here rather than being noticed a year later.
 */

// Vitest runs from the repository root, and under the jsdom environment
// `import.meta.url` is an http: URL rather than a file one.
const sheet = (name: string) => readFileSync(resolve(process.cwd(), "src", name), "utf8");
const sheets = { guest: sheet("styles.css"), admin: sheet("admin.css") };

/** Everything after the `:root` block — the part that may only use tokens. */
function body(css: string): string {
  const start = css.indexOf(":root {");
  const end = css.indexOf("\n}\n", start);
  if (start !== 0 || end < 0) throw new Error("the stylesheet must open with its :root token block");
  return css.slice(end + 3);
}

function tokens(css: string): Map<string, string> {
  const block = css.slice(0, css.indexOf("\n}\n"));
  return new Map([...block.matchAll(/^\s+(--[a-z0-9-]+):\s*([^;]+);/gm)].map((match) => [match[1], match[2].trim()]));
}

function rgb(value: string): [number, number, number] {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((at) => parseInt(hex[1].slice(at, at + 2), 16)) as [number, number, number];
  const parts = value.match(/^rgba?\(([^)]+)\)$/);
  if (!parts) throw new Error(`not a colour: ${value}`);
  const [r, g, b] = parts[1].split(",").map((part) => Number.parseFloat(part));
  return [r, g, b];
}

/** WCAG 2.1 relative luminance and contrast, so the thresholds below are the standard's. */
function contrast(foreground: string, background: string): number {
  const luminance = (value: string) => {
    const channels = rgb(value).map((channel) => {
      const ratio = channel / 255;
      return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

function hsl(value: string): { hue: number; saturation: number } {
  const [r, g, b] = rgb(value).map((channel) => channel / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return { hue: 0, saturation: 0 };
  const lightness = (max + min) / 2;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const hue = max === r ? 60 * (((g - b) / delta + 6) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
  return { hue, saturation };
}

describe.each(Object.entries(sheets))("%s stylesheet", (_name, css) => {
  it("writes no colour outside the token block", () => {
    const raw = body(css).match(/#[0-9a-f]{3,8}\b|\brgba?\([^)]*\)|:\s*(?:white|black|red|green|blue|gr[ae]y)\b/gi) || [];
    expect(raw).toEqual([]);
  });

  it("references only tokens it defines", () => {
    const defined = tokens(css);
    const referenced = new Set([...body(css).matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]));
    // `--art` and `--swatch` are the exceptions: each product, and each menu
    // style swatch, sets its own colour inline rather than through a token.
    const inlineExceptions = new Set(["--art", "--swatch"]);
    const missing = [...referenced].filter((token) => !inlineExceptions.has(token) && !defined.has(token));
    expect(missing).toEqual([]);
  });
});

describe("contrast", () => {
  const guest = tokens(sheets.guest);
  const admin = tokens(sheets.admin);
  const pairs: Array<[string, string, string, number]> = [
    // Guest app. The allergen list and the ingredient text are read off a
    // tablet in a dim room; 4.5 is the floor for anything smaller than 18px.
    ["guest body text", guest.get("--ink")!, guest.get("--panel")!, 7],
    ["guest secondary text", guest.get("--ink-2")!, guest.get("--panel")!, 7],
    ["guest muted labels", guest.get("--muted")!, guest.get("--panel")!, 4.5],
    // Worst case for light text is the lightest surface, not the darkest.
    ["guest smallest type", guest.get("--faint")!, guest.get("--panel-3")!, 4.5],
    ["guest muted labels on a raised surface", guest.get("--muted")!, guest.get("--panel-3")!, 4.5],
    ["guest accent text", guest.get("--accent")!, guest.get("--panel")!, 4.5],
    ["label on the accent button", guest.get("--accent-ink")!, guest.get("--accent")!, 4.5],
    ["guest warning text", guest.get("--danger")!, guest.get("--bg")!, 4.5],
    ["guest warning text on a card", guest.get("--danger-ink")!, guest.get("--panel")!, 4.5],
    // Staff console, used under restaurant lighting on whatever phone is nearest.
    ["admin body text", admin.get("--a-ink")!, admin.get("--a-card")!, 7],
    ["admin muted text", admin.get("--a-muted")!, admin.get("--a-card")!, 4.5],
    ["admin smallest type", admin.get("--a-faint")!, admin.get("--a-card")!, 4.5],
    ["admin smallest type on the shell", admin.get("--a-faint")!, admin.get("--a-shell")!, 4.5],
    ["admin accent text", admin.get("--a-accent-ink")!, admin.get("--a-accent-wash")!, 4.5],
    ["label on the admin accent button", admin.get("--a-on-accent")!, admin.get("--a-accent")!, 4.5],
    ["admin error text", admin.get("--a-danger")!, admin.get("--a-danger-wash")!, 4.5],
    ["admin header text", admin.get("--a-head-ink")!, admin.get("--a-head")!, 7],
    ["admin header labels", admin.get("--a-head-muted")!, admin.get("--a-head")!, 4.5],
    // The printed table card. Ink on paper, and it still has to survive a copier.
    ["table card heading", admin.get("--paper-ink")!, admin.get("--paper")!, 7],
    ["table card caption", admin.get("--paper-muted")!, admin.get("--paper")!, 4.5]
  ];

  it.each(pairs)("%s clears %s on %s at %d:1", (_what, foreground, background, floor) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(floor);
  });
});

describe("the guest palette", () => {
  it("has one accent, and no gold", () => {
    // Anything saturated must be either the celadon accent or the one warm
    // colour that means "look here". Gold lands at roughly 36°, so a gold
    // creeping back in fails this.
    const offenders = [...tokens(sheets.guest)]
      .filter(([, value]) => /^#[0-9a-f]{6}$/i.test(value))
      .map(([token, value]) => ({ token, ...hsl(value) }))
      .filter(({ hue, saturation }) => saturation > 0.15 && !(hue >= 130 && hue <= 180) && !(hue >= 5 && hue <= 25));
    expect(offenders).toEqual([]);
  });
});

describe("menu styles", () => {
  // A 菜单样式 pick only ever swaps the accent group at runtime — every other
  // token stays what src/styles.css declares — so a preset only has to clear
  // the same floor the shipped accent does: readable against --panel, its
  // own label readable on it, and no gold hue sneaking in as a "style".
  const panel = tokens(sheets.guest).get("--panel")!;

  it.each(Object.values(MENU_THEMES))("$id ($nameZh) clears the accent contrast floor", (theme) => {
    expect(contrast(theme.accent, panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.accentInk, theme.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(Object.values(MENU_THEMES))("$id ($nameZh) stays out of gold", (theme) => {
    const { hue, saturation } = hsl(theme.accent);
    expect(saturation > 0.15 && !(hue >= 130 && hue <= 180) && !(hue >= 5 && hue <= 25)).toBe(false);
  });
});

describe("the light menu", () => {
  // The same floors as the dark menu, read off the --light-* tokens that
  // `:root[data-theme="light"]` switches to. A guest by a window reads the
  // allergen letters in daylight, which is no excuse for grey on white.
  const guest = tokens(sheets.guest);
  const light = (name: string) => guest.get(`--light-${name}`)!;
  const pairs: Array<[string, string, string, number]> = [
    ["body text", light("ink"), light("panel"), 7],
    ["secondary text", light("ink-2"), light("panel"), 7],
    ["muted labels", light("muted"), light("panel"), 4.5],
    ["smallest type on a raised surface", light("faint"), light("panel-3"), 4.5],
    ["muted labels on a raised surface", light("muted"), light("panel-3"), 4.5],
    ["warning text", light("danger"), light("bg"), 4.5],
    ["warning text on a card", light("danger-ink"), light("panel"), 4.5]
  ];

  it.each(pairs)("%s clears %s on %s at %d:1", (_what, foreground, background, floor) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(floor);
  });

  it("switches only to tokens it defines, and only tokens the dark menu has", () => {
    const start = sheets.guest.indexOf(':root[data-theme="light"] {');
    expect(start).toBeGreaterThan(0);
    const block = sheets.guest.slice(start, sheets.guest.indexOf("\n}\n", start));
    const switched = [...block.matchAll(/^\s+(--[a-z0-9-]+):\s*var\((--light-[a-z0-9-]+)\);/gm)];
    expect(switched.length).toBeGreaterThan(20);
    for (const [, token, source] of switched) {
      expect(guest.has(token), `${token} is not a dark-menu token`).toBe(true);
      expect(source).toBe(`--light-${token.slice(2)}`);
      expect(guest.has(source), `${source} is not defined`).toBe(true);
    }
  });

  it.each(Object.values(MENU_THEMES))("$id ($nameZh) has a light accent that clears the same floor", (theme) => {
    expect(contrast(theme.light.accent, light("panel"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.light.accentInk, theme.light.accent)).toBeGreaterThanOrEqual(4.5);
    const { hue, saturation } = hsl(theme.light.accent);
    expect(saturation > 0.15 && !(hue >= 130 && hue <= 180) && !(hue >= 5 && hue <= 25)).toBe(false);
  });
});

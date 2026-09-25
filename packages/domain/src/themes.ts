export type MenuThemeId =
  | "jade" | "teal" | "terracotta"
  | "spring-festival" | "valentine" | "easter" | "back-to-school"
  | "mid-autumn" | "national-day" | "christmas" | "halloween";

type Accent = { accent: string; accentStrong: string; accentInk: string; accentLine: string; accentWash: string };

export interface MenuTheme {
  id: MenuThemeId;
  nameZh: string;
  nameDe: string;
  nameEn: string;
  accent: string;
  accentStrong: string;
  accentInk: string;
  accentLine: string;
  accentWash: string;
  /** The same style on the light menu: a darker shade of the same hue, held
   *  to the same floor against the light panel, with white as its label. */
  light: Accent;
  /** A festive set: two motifs, repeated faintly over the whole menu in the
   *  accent, and the room's glow in the same colour. The rest of the palette
   *  is the one every style shares, so a guest can still read every line. */
  festive?: { motifs: [string, string]; garland: string };
}

/**
 * The festive sets' motifs: SVG drawn around 0,0 within about ±11, in one
 * colour (`{c}`) that the menu fills in with the accent. Line art and simple
 * shapes, so at a tenth of their strength they read as a pattern, not a
 * picture behind the dishes.
 */
const MOTIF = {
  lantern: '<g fill="none" stroke="{c}"><ellipse rx="7.5" ry="8"/><path d="M-4 -8h8M-4 8h8M0 -11v3M0 8v4M-2.5 12h5M-7.5 0h15"/></g>',
  blossom: '<g fill="{c}"><circle cy="-5" r="3"/><circle cx="4.8" cy="-1.5" r="3"/><circle cx="3" cy="4" r="3"/><circle cx="-3" cy="4" r="3"/><circle cx="-4.8" cy="-1.5" r="3"/></g>',
  heart: '<path fill="{c}" d="M0 7C-9 0-10-7-5-9c3-1 5 1 5 3 0-2 2-4 5-3 5 2 4 9-5 16z"/>',
  heartLine: '<path fill="none" stroke="{c}" d="M0 7C-9 0-10-7-5-9c3-1 5 1 5 3 0-2 2-4 5-3 5 2 4 9-5 16z"/>',
  egg: '<g fill="none" stroke="{c}"><ellipse rx="7" ry="9.5"/><path d="M-7 0l2.3-2.5 2.3 2.5 2.4-2.5 2.3 2.5 2.4-2.5 2.3 2.5"/></g>',
  dots: '<g fill="{c}"><circle r="2"/><circle cx="-8" cy="6" r="1.4"/><circle cx="7" cy="-7" r="1.4"/></g>',
  pencil: '<g fill="none" stroke="{c}" transform="rotate(-35)"><path d="M-2.5-11h5v16h-5zM-2.5 5L0 11l2.5-6M-2.5-7h5"/></g>',
  apple: '<g fill="none" stroke="{c}"><path d="M0-4c-4-3-9-1-9 4 0 6 4 10 9 8 5 2 9-2 9-8 0-5-5-7-9-4zM0-4c0-3 1-5 3-6M1-7c3-2 5-1 6 0-2 2-4 2-6 0"/></g>',
  moon: '<path fill="{c}" d="M3-9a9 9 0 1 0 0 18A7.5 7.5 0 1 1 3-9z"/>',
  cloud: '<path fill="none" stroke="{c}" d="M-10 4c-3-3 0-8 4-6 1-4 7-5 9-1 4-2 8 2 6 6zM-4 4c0-2 2-3 4-2"/>',
  star: '<path fill="{c}" d="M0-9l2.2 6.3h6.6l-5.3 4 2 6.4L0 3.9l-5.5 3.8 2-6.4-5.3-4h6.6z"/>',
  starSmall: '<path fill="{c}" transform="scale(.55)" d="M0-9l2.2 6.3h6.6l-5.3 4 2 6.4L0 3.9l-5.5 3.8 2-6.4-5.3-4h6.6z"/>',
  snowflake: '<g fill="none" stroke="{c}"><path d="M0-10v20M-8.7-5l17.4 10M-8.7 5l17.4-10M-2.5-7.5L0-5l2.5-2.5M-2.5 7.5L0 5l2.5 2.5"/></g>',
  tree: '<path fill="{c}" d="M0-11l7 9H3l6 8H-9l6-8h-4zM-1.5 6h3v4h-3z"/>',
  pumpkin: '<g fill="none" stroke="{c}"><path d="M0-5c-11-1-11 14 0 13 11 1 11-14 0-13zM0-5c-4 2-4 11 0 13M0-5c4 2 4 11 0 13M0-5c0-3 1-5 3-6"/></g>',
  bat: '<path fill="{c}" transform="scale(1.05)" d="M0-1.5C-.7-3.6-1.9-4-2.6-3l-.6 2C-5-3.2-8.2-3.4-10.5-1.2c2 .1 3 1.2 3.2 3.3C-5.3.9-3.3 1-2 2.9L0 4.6l2-1.7C3.3 1 5.3.9 7.3 2.1c.2-2.1 1.2-3.2 3.2-3.3C8.2-3.4 5-3.2 3.2-1l-.6-2C1.9-4 .7-3.6 0-1.5z"/>'
};

/**
 * What hangs on a festive set's garland — the string of ornaments strung
 * under the categories, the way a restaurant hangs lanterns for the new year
 * or lights for Christmas. Drawn around 0,0, hanging down from it.
 */
const ORNAMENT = {
  lantern: '<g fill="{c}"><rect x="-2.5" y="-1" width="5" height="2"/><ellipse cy="7.5" rx="6.5" ry="6.5"/><rect x="-2.5" y="13.5" width="5" height="2"/></g><path fill="none" stroke="{c}" d="M0 15.5v5M-4 7.5h8"/>',
  moonLantern: '<circle fill="{c}" cy="7" r="6"/><path fill="none" stroke="{c}" d="M0 13v6"/>',
  heart: '<path fill="{c}" transform="translate(0 7) scale(.62)" d="M0 7C-9 0-10-7-5-9c3-1 5 1 5 3 0-2 2-4 5-3 5 2 4 9-5 16z"/>',
  egg: '<ellipse fill="{c}" cy="7" rx="4.6" ry="6.2"/>',
  pennant: '<path fill="{c}" d="M-6.5 0h13L0 13z"/>',
  starFlag: '<path fill="{c}" d="M-7 0h14v11L0 16l-7-5z"/>',
  bulb: '<g fill="{c}"><rect x="-2" y="0" width="4" height="3"/><ellipse cy="8" rx="3.6" ry="5.4"/></g>',
  bat: '<path fill="{c}" transform="translate(0 6) scale(.8)" d="M0-1.5C-.7-3.6-1.9-4-2.6-3l-.6 2C-5-3.2-8.2-3.4-10.5-1.2c2 .1 3 1.2 3.2 3.3C-5.3.9-3.3 1-2 2.9L0 4.6l2-1.7C3.3 1 5.3.9 7.3 2.1c.2-2.1 1.2-3.2 3.2-3.3C8.2-3.4 5-3.2 3.2-1l-.6-2C1.9-4 .7-3.6 0-1.5z"/>'
};

const festive = (first: string, second: string, garland: string) => ({ motifs: [first, second] as [string, string], garland });

/**
 * What a menu style change is allowed to touch: the accent, and for a
 * festive set a faint pattern and the room's glow in that accent. Every
 * other token — backgrounds, ink, the one warm "look here" colour — stays
 * exactly what `src/styles.css` declares, because those are the pairs
 * `apps/customer-app/test/styles.test.ts` holds to a WCAG floor. Each accent
 * here clears the same floor against `--panel` and against itself as a
 * button label. An everyday style's hue sits in one of the two bands that
 * test enforces on the shipped default — a celadon green or the one warm
 * colour; a festive set may take its season's colour, but never gold on
 * near-black.
 */
export const MENU_THEMES: Record<MenuThemeId, MenuTheme> = {
  jade: {
    id: "jade", nameZh: "墨玉", nameDe: "Jade", nameEn: "Jade",
    accent: "#8fb0a3", accentStrong: "#a9c7ba", accentInk: "#0c100f",
    accentLine: "rgba(143, 176, 163, 0.45)", accentWash: "rgba(143, 176, 163, 0.14)",
    light: { accent: "#2f6b56", accentStrong: "#245745", accentInk: "#ffffff", accentLine: "rgba(47, 107, 86, 0.4)", accentWash: "rgba(47, 107, 86, 0.1)" }
  },
  teal: {
    id: "teal", nameZh: "远山", nameDe: "Fernberg", nameEn: "Distant Hills",
    accent: "#7fb3ab", accentStrong: "#a0cdc5", accentInk: "#081211",
    accentLine: "rgba(127, 179, 171, 0.45)", accentWash: "rgba(127, 179, 171, 0.14)",
    light: { accent: "#2b6a62", accentStrong: "#20554e", accentInk: "#ffffff", accentLine: "rgba(43, 106, 98, 0.4)", accentWash: "rgba(43, 106, 98, 0.1)" }
  },
  terracotta: {
    id: "terracotta", nameZh: "赤陶", nameDe: "Terrakotta", nameEn: "Terracotta",
    accent: "#c98868", accentStrong: "#dba98c", accentInk: "#170c08",
    accentLine: "rgba(201, 136, 104, 0.45)", accentWash: "rgba(201, 136, 104, 0.14)",
    light: { accent: "#a4512f", accentStrong: "#8a4226", accentInk: "#ffffff", accentLine: "rgba(164, 81, 47, 0.4)", accentWash: "rgba(164, 81, 47, 0.1)" }
  },
  // Festive sets: the accent, the glow and a pattern for the season, swapped
  // back to an everyday style when it is over. Each clears the same contrast
  // floor as the everyday ones, on the dark menu and the light.
  "spring-festival": {
    id: "spring-festival", nameZh: "春节", nameDe: "Neujahrsfest", nameEn: "Spring Festival",
    accent: "#ec7a63", accentStrong: "#f49c89", accentInk: "#1a0906",
    accentLine: "rgba(236, 122, 99, 0.45)", accentWash: "rgba(236, 122, 99, 0.14)",
    light: { accent: "#b52a1c", accentStrong: "#962216", accentInk: "#ffffff", accentLine: "rgba(181, 42, 28, 0.4)", accentWash: "rgba(181, 42, 28, 0.1)" },
    festive: festive(MOTIF.lantern, MOTIF.blossom, ORNAMENT.lantern)
  },
  valentine: {
    id: "valentine", nameZh: "情人节", nameDe: "Valentinstag", nameEn: "Valentine's Day",
    accent: "#ec8fae", accentStrong: "#f3b0c6", accentInk: "#1c080f",
    accentLine: "rgba(236, 143, 174, 0.45)", accentWash: "rgba(236, 143, 174, 0.14)",
    light: { accent: "#b02d5c", accentStrong: "#92244b", accentInk: "#ffffff", accentLine: "rgba(176, 45, 92, 0.4)", accentWash: "rgba(176, 45, 92, 0.1)" },
    festive: festive(MOTIF.heart, MOTIF.heartLine, ORNAMENT.heart)
  },
  easter: {
    id: "easter", nameZh: "复活节", nameDe: "Ostern", nameEn: "Easter",
    accent: "#b8a2e0", accentStrong: "#cfc0ec", accentInk: "#120c1c",
    accentLine: "rgba(184, 162, 224, 0.45)", accentWash: "rgba(184, 162, 224, 0.14)",
    light: { accent: "#6b4aa3", accentStrong: "#583c88", accentInk: "#ffffff", accentLine: "rgba(107, 74, 163, 0.4)", accentWash: "rgba(107, 74, 163, 0.1)" },
    festive: festive(MOTIF.egg, MOTIF.dots, ORNAMENT.egg)
  },
  "back-to-school": {
    id: "back-to-school", nameZh: "开学季", nameDe: "Schulbeginn", nameEn: "Back to School",
    accent: "#80aee6", accentStrong: "#a3c6ef", accentInk: "#08101c",
    accentLine: "rgba(128, 174, 230, 0.45)", accentWash: "rgba(128, 174, 230, 0.14)",
    light: { accent: "#2957a3", accentStrong: "#204687", accentInk: "#ffffff", accentLine: "rgba(41, 87, 163, 0.4)", accentWash: "rgba(41, 87, 163, 0.1)" },
    festive: festive(MOTIF.pencil, MOTIF.apple, ORNAMENT.pennant)
  },
  "mid-autumn": {
    id: "mid-autumn", nameZh: "中秋节", nameDe: "Mondfest", nameEn: "Mid-Autumn",
    accent: "#a8b6de", accentStrong: "#c4cee9", accentInk: "#0b0e18",
    accentLine: "rgba(168, 182, 222, 0.45)", accentWash: "rgba(168, 182, 222, 0.14)",
    light: { accent: "#3e4f8c", accentStrong: "#324073", accentInk: "#ffffff", accentLine: "rgba(62, 79, 140, 0.4)", accentWash: "rgba(62, 79, 140, 0.1)" },
    festive: festive(MOTIF.moon, MOTIF.cloud, ORNAMENT.moonLantern)
  },
  "national-day": {
    id: "national-day", nameZh: "国庆节", nameDe: "Nationalfeiertag", nameEn: "National Day",
    accent: "#ee6f78", accentStrong: "#f49399", accentInk: "#1c0708",
    accentLine: "rgba(238, 111, 120, 0.45)", accentWash: "rgba(238, 111, 120, 0.14)",
    light: { accent: "#b8202e", accentStrong: "#991a26", accentInk: "#ffffff", accentLine: "rgba(184, 32, 46, 0.4)", accentWash: "rgba(184, 32, 46, 0.1)" },
    festive: festive(MOTIF.star, MOTIF.starSmall, ORNAMENT.starFlag)
  },
  christmas: {
    id: "christmas", nameZh: "圣诞节", nameDe: "Weihnachten", nameEn: "Christmas",
    accent: "#7cc49b", accentStrong: "#9fd6b7", accentInk: "#07120c",
    accentLine: "rgba(124, 196, 155, 0.45)", accentWash: "rgba(124, 196, 155, 0.14)",
    light: { accent: "#1d6b42", accentStrong: "#175636", accentInk: "#ffffff", accentLine: "rgba(29, 107, 66, 0.4)", accentWash: "rgba(29, 107, 66, 0.1)" },
    festive: festive(MOTIF.snowflake, MOTIF.tree, ORNAMENT.bulb)
  },
  halloween: {
    id: "halloween", nameZh: "万圣节", nameDe: "Halloween", nameEn: "Halloween",
    accent: "#ec8c4c", accentStrong: "#f2a978", accentInk: "#1a0c04",
    accentLine: "rgba(236, 140, 76, 0.45)", accentWash: "rgba(236, 140, 76, 0.14)",
    light: { accent: "#a84b12", accentStrong: "#8c3e0f", accentInk: "#ffffff", accentLine: "rgba(168, 75, 18, 0.4)", accentWash: "rgba(168, 75, 18, 0.1)" },
    festive: festive(MOTIF.pumpkin, MOTIF.bat, ORNAMENT.bat)
  }
};

export const MENU_THEME_IDS = Object.keys(MENU_THEMES) as MenuThemeId[];

export const DEFAULT_MENU_THEME: MenuThemeId = "jade";

/**
 * A festive set's garland as a CSS image, `none` for an everyday style: a
 * 56px length of string sagging between two points, one ornament hung from
 * the middle of it, repeated across the screen.
 */
export function themeGarland(theme: MenuTheme, colour: string): string {
  if (!theme.festive) return "none";
  const ornament = theme.festive.garland.replaceAll("{c}", colour);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="32" viewBox="0 0 56 32">`
    + `<path d="M0 3Q28 13 56 3" fill="none" stroke="${colour}" stroke-width="1.2" opacity="0.5"/>`
    + `<g transform="translate(28 8)" opacity="0.85" stroke-width="1.2" stroke-linecap="round"><path d="M0 0v3" stroke="${colour}"/><g transform="translate(0 3)">${ornament}</g></g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * A festive set's pattern as a CSS image, `none` for an everyday style: one
 * 120px tile, the two motifs staggered across it, drawn in `colour` — faint,
 * to sit behind the whole menu. The `band` is the same pattern two tiles
 * tall, stronger at the top and fading out, for the header: laid over the
 * faint one on the same grid, the header wears the season and the list stays
 * quiet.
 */
export function themePattern(theme: MenuTheme, colour: string, kind: "tile" | "band" = "tile"): string {
  if (!theme.festive) return "none";
  const [first, second] = theme.festive.motifs.map((motif) => motif.replaceAll("{c}", colour));
  const tile = (y: number) => `<g transform="translate(0 ${y})">`
    + `<g transform="translate(30 32) rotate(-8) scale(1.35)">${first}</g><g transform="translate(90 92) rotate(10) scale(1.35)">${first}</g>`
    + `<g transform="translate(92 30) scale(1.35)">${second}</g><g transform="translate(28 90) scale(1.35)">${second}</g></g>`;
  const style = `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"`;
  const svg = kind === "tile"
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><g opacity="0.12" ${style}>${tile(0)}</g></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="240" viewBox="0 0 120 240"><defs>`
      + `<linearGradient id="f" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`
      + `<mask id="m"><rect width="120" height="240" fill="url(#f)"/></mask></defs>`
      + `<g mask="url(#m)" opacity="0.22" ${style}>${tile(0)}${tile(120)}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

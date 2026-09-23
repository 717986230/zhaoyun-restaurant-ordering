export type MenuThemeId = "jade" | "teal" | "terracotta";

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
  light: { accent: string; accentStrong: string; accentInk: string; accentLine: string; accentWash: string };
}

/**
 * The one thing a menu style change is allowed to touch: the accent. Every
 * other token — backgrounds, ink, the one warm "look here" colour — stays
 * exactly what `src/styles.css` declares, because those are the pairs
 * `apps/customer-app/test/styles.test.ts` holds to a WCAG floor. Each accent
 * here clears the same floor against `--panel` and against itself as a
 * button label, and its hue sits in one of the same two bands that test
 * enforces on the shipped default — a celadon green or the one warm colour —
 * so picking a menu style is not a way to reintroduce gold on near-black.
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
  }
};

export const MENU_THEME_IDS = Object.keys(MENU_THEMES) as MenuThemeId[];

export const DEFAULT_MENU_THEME: MenuThemeId = "jade";

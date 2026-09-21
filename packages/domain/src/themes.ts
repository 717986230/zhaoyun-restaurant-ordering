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
    accentLine: "rgba(143, 176, 163, 0.45)", accentWash: "rgba(143, 176, 163, 0.14)"
  },
  teal: {
    id: "teal", nameZh: "远山", nameDe: "Fernberg", nameEn: "Distant Hills",
    accent: "#7fb3ab", accentStrong: "#a0cdc5", accentInk: "#081211",
    accentLine: "rgba(127, 179, 171, 0.45)", accentWash: "rgba(127, 179, 171, 0.14)"
  },
  terracotta: {
    id: "terracotta", nameZh: "赤陶", nameDe: "Terrakotta", nameEn: "Terracotta",
    accent: "#c98868", accentStrong: "#dba98c", accentInk: "#170c08",
    accentLine: "rgba(201, 136, 104, 0.45)", accentWash: "rgba(201, 136, 104, 0.14)"
  }
};

export const MENU_THEME_IDS = Object.keys(MENU_THEMES) as MenuThemeId[];

export const DEFAULT_MENU_THEME: MenuThemeId = "jade";

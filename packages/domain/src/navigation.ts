import type { MenuLanguage } from "./languages.js";

/**
 * The order of the menu's tabs.
 *
 * The owner may say which three tabs come first — the set menus page, the
 * promotions page, "all", or any category — and everything else follows in
 * its usual order: promotions, set menus, all, then the categories as the
 * dishes are sorted. One function for the guest menu and the admin console's
 * preview, so what the owner sees is what a guest gets.
 *
 * It cannot conflict: a tab named twice counts once, a tab that is not on
 * the menu (a category since emptied, a page switched off or outside its
 * hours) is skipped and the next one moves up, and nothing but the first
 * three counts.
 */
export const NAV_FEATURED = "__featured__";
export const NAV_SETS = "__sets__";
/** Every drink on one page — coffee, tea, soft drinks, beer, wine — whatever
 *  category each is kept in for the kitchen and the reports. */
export const NAV_DRINKS = "__drinks__";
export const NAV_ALL = "ALLE";
/** Positions the owner chooses: the first, second and third tab. */
export const NAV_PINNED_MAX = 3;

export function orderNavTabs(available: readonly string[], pinned: readonly string[] = []): string[] {
  const chosen: string[] = [];
  for (const tab of pinned) {
    if (chosen.length === NAV_PINNED_MAX) break;
    if (available.includes(tab) && !chosen.includes(tab)) chosen.push(tab);
  }
  return [...chosen, ...available.filter((tab) => !chosen.includes(tab))];
}

/**
 * The categories as tabs, the drinks' folded into one: the drinks page takes
 * the place of the first drink category, and the others drop out. A menu
 * with no drinks has no drinks page.
 */
export function drinkTabs(categories: readonly string[], drinkCategories: ReadonlySet<string>): string[] {
  const tabs: string[] = [];
  for (const category of categories) {
    if (!drinkCategories.has(category)) tabs.push(category);
    else if (!tabs.includes(NAV_DRINKS)) tabs.push(NAV_DRINKS);
  }
  return tabs;
}

const DEFAULT_CATEGORY_ZH: Record<string, string> = {
  RAMEN: "拉面",
  SPECIALS: "特色菜",
  BAO: "刈包",
  NIGIRI: "握寿司",
  MAKI: "细卷",
  "MAKI SESAM": "芝麻卷",
  SASHIMI: "刺身",
  "URAMAKI ROLLS": "反卷",
  "MAIN DISHES": "主菜",
  STARTER: "前菜",
  "FRIED UDON": "炒乌冬",
  "SIDE DISHES": "配菜",
  DESSERT: "甜品",
  "NON-ALCOHOLIC": "无酒精饮品",
  BEER: "啤酒",
  "WINE APERITIF": "红酒与开胃酒",
  COFFEE: "咖啡",
  SET: "套餐"
};

/** Default display label for a menu category when no custom navLabel is set. */
export function defaultCategoryLabel(category: string, language: MenuLanguage): string {
  if (language === "zh") {
    return DEFAULT_CATEGORY_ZH[category.trim().toUpperCase()] ?? category;
  }
  return category;
}

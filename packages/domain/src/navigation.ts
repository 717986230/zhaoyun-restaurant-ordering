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

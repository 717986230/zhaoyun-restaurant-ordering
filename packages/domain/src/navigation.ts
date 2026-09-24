/**
 * The order of the menu's tabs.
 *
 * The set menus' tab is always first. The owner may say which two tabs come
 * next — the promotions page, "all", or any category — and everything else
 * follows in its usual order: promotions, all, then the categories as the
 * dishes are sorted. One function for the guest menu and the admin console's
 * preview, so what the owner sees is what a guest gets.
 *
 * It cannot conflict: a tab named twice counts once, a tab that is not on
 * the menu (a category since emptied, the promotions page switched off) is
 * skipped and the next one moves up, and nothing but the first two counts.
 */
export const NAV_FEATURED = "__featured__";
export const NAV_SETS = "__sets__";
export const NAV_ALL = "ALLE";
/** Positions the owner chooses: the second and the third tab. */
export const NAV_PINNED_MAX = 2;

export function orderNavTabs(available: readonly string[], pinned: readonly string[] = []): string[] {
  const rest = available.filter((tab) => tab !== NAV_SETS);
  const chosen: string[] = [];
  for (const tab of pinned) {
    if (chosen.length === NAV_PINNED_MAX) break;
    if (rest.includes(tab) && !chosen.includes(tab)) chosen.push(tab);
  }
  return [...(available.includes(NAV_SETS) ? [NAV_SETS] : []), ...chosen, ...rest.filter((tab) => !chosen.includes(tab))];
}

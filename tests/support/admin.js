/**
 * The console's settings cards open folded, and remember on the device which
 * the owner opened (SettingsPanel.tsx, Section). The specs that work inside
 * the cards start with every one open; a spec that folds or opens one keeps
 * what it did across a reload, as the owner would.
 */
export const SETTINGS_CARDS = [
  "restaurant", "appearance", "app-icons", "languages", "nav", "tabNames", "featured", "sets", "vat", "company", "modules", "staff", "tables", "password",
  "guest-ordering", "guest-accounts", "guest-loyalty", "guest-list"
];

export function openSettingsCards(page) {
  return page.addInitScript((ids) => {
    if (localStorage.getItem("zy_admin_opened") === null) localStorage.setItem("zy_admin_opened", JSON.stringify(ids));
  }, SETTINGS_CARDS);
}

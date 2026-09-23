/**
 * The set menus the restaurant starts with, built from dishes on the menu.
 *
 * A set is an ordinary product that lists the dishes it packages
 * (`bundleItems`), so these are data, not a feature: the owner edits, copies
 * or deletes them in the admin console like any dish. They are added once —
 * the Node server marks `seeded_set_menus` in app_settings, D1 gets them from
 * migrations/0050_set_menus.sql, generated from this file — so a set the owner
 * deletes stays deleted.
 *
 * What is written here is what a person decides: the name, the price, what
 * goes in. What follows from that is worked out, never typed: a set's
 * allergens are every allergen of every dish in it, because a guest reads
 * them as a legal statement and a hand-copied list goes stale the day one
 * dish's recipe changes.
 */
export const SET_MENU_SEED_KEY = "seeded_set_menus";

export const SET_MENUS = [
  {
    id: "set-ramen-for-two", sku: "SET-1", price: 34.9, people: "2 Personen", time: "25 min",
    names: { zh: "双人拉面套餐", de: "Ramen-Menü für zwei", en: "Ramen Set for Two" },
    description: "Zwei Ramen nach Wahl des Hauses, Veggie Gyoza zum Teilen und zweimal Miso-Suppe.",
    items: [["photo-r1", 1], ["photo-r2", 1], ["photo-v5", 1], ["photo-v14", 2]]
  },
  {
    id: "set-sushi", sku: "SET-2", price: 32.9, people: "1–2 Personen", time: "20 min",
    names: { zh: "寿司拼盘套餐", de: "Sushi-Menü", en: "Sushi Set" },
    description: "Nigiri, Sake Maki und eine Rainbow Roll, dazu Miso-Suppe.",
    items: [["photo-n2-6", 1], ["photo-m2", 1], ["photo-x1", 1], ["photo-v14", 1]]
  },
  {
    id: "set-hot-pot-for-two", sku: "SET-3", price: 59.9, people: "2 Personen", time: "35 min",
    names: { zh: "双人火锅套餐", de: "Hot-Pot-Menü für zwei", en: "Hot Pot Set for Two" },
    description: "Rind- und Meeresfrüchte-Hot-Pot, Reis und Mochi zum Abschluss.",
    items: [["photo-h2", 1], ["photo-h3", 1], ["photo-side-rice", 2], ["photo-d1", 2]]
  },
  {
    id: "set-szechuan", sku: "SET-4", price: 33.9, people: "2 Personen", time: "25 min",
    names: { zh: "川味套餐", de: "Szechuan-Menü", en: "Szechuan Set" },
    description: "Szechuan-Rind, Mapo Tofu und Chili-Wontons, dazu zweimal Reis.",
    items: [["photo-t1", 1], ["photo-t4", 1], ["photo-v13", 1], ["photo-side-rice", 2]]
  },
  {
    id: "set-lunch", sku: "SET-5", price: 19.9, people: "1 Person", time: "15 min",
    names: { zh: "午间套餐", de: "Mittagsmenü", en: "Lunch Set" },
    description: "Bulgogi mit Reis, Edamame und Miso-Suppe.",
    items: [["photo-b6", 1], ["photo-v1", 1], ["photo-v14", 1], ["photo-side-rice", 1]]
  },
  {
    id: "set-family", sku: "SET-6", price: 72.9, people: "4 Personen", time: "35 min",
    names: { zh: "家庭套餐（4人）", de: "Familienmenü für vier", en: "Family Set for Four" },
    description: "Vier Hauptgerichte, Frühlingsrollen und Gyoza zum Teilen, Matcha-Tiramisu zum Dessert.",
    items: [["photo-b1", 1], ["photo-b8", 1], ["photo-b11", 1], ["photo-u2", 1], ["photo-v4", 2], ["photo-v6", 2], ["photo-d2", 2]]
  },
  {
    id: "set-dessert", sku: "SET-7", price: 15.9, people: "2 Personen", time: "10 min",
    names: { zh: "甜品三重奏", de: "Dessert-Trio", en: "Dessert Trio" },
    description: "Mochi, Matcha-Tiramisu und Apfel-Gyoza.",
    items: [["photo-d1", 1], ["photo-d2", 1], ["photo-d3", 1]]
  }
];

/**
 * The sets as product inputs, given the dishes they are made of. A set whose
 * dishes are not all on the menu is left out rather than half-described.
 */
export function setMenuProducts(dishes, firstSortOrder = 1000) {
  const byId = new Map(dishes.map((dish) => [String(dish.id), dish]));
  return SET_MENUS.flatMap((set, index) => {
    const parts = set.items.map(([id]) => byId.get(id));
    if (parts.some((dish) => !dish)) return [];
    const allergens = [...new Set(parts.flatMap((dish) => dish.allergens ?? []))].sort();
    return [{
      id: set.id,
      sku: set.sku,
      kind: "food",
      category: "SET",
      names: set.names,
      description: set.description,
      price: set.price,
      allergens,
      details: { time: set.time, people: set.people, level: "", ingredients: "" },
      bundleItems: set.items.map(([productId, quantity]) => ({ productId, quantity })),
      sortOrder: firstSortOrder + index,
      printStation: "kitchen",
      vatPercent: 10
    }];
  });
}

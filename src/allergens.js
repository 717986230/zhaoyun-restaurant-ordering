// Austrian allergen letter codes (Codex Alimentarius Austriacus / LMIV Anhang II).
// Menus in Austria must declare these 14 groups, so they are an enum, not free text.
export const ALLERGENS = [
  { code: "A", zh: "含麸质谷物", de: "Glutenhaltiges Getreide", en: "Cereals containing gluten" },
  { code: "B", zh: "甲壳类", de: "Krebstiere", en: "Crustaceans" },
  { code: "C", zh: "蛋", de: "Eier", en: "Eggs" },
  { code: "D", zh: "鱼", de: "Fisch", en: "Fish" },
  { code: "E", zh: "花生", de: "Erdnüsse", en: "Peanuts" },
  { code: "F", zh: "大豆", de: "Soja", en: "Soybeans" },
  { code: "G", zh: "奶（含乳糖）", de: "Milch und Laktose", en: "Milk and lactose" },
  { code: "H", zh: "坚果", de: "Schalenfrüchte", en: "Tree nuts" },
  { code: "L", zh: "芹菜", de: "Sellerie", en: "Celery" },
  { code: "M", zh: "芥末", de: "Senf", en: "Mustard" },
  { code: "N", zh: "芝麻", de: "Sesam", en: "Sesame" },
  { code: "O", zh: "二氧化硫和亚硫酸盐", de: "Schwefeldioxid und Sulfite", en: "Sulphur dioxide and sulphites" },
  { code: "P", zh: "羽扇豆", de: "Lupinen", en: "Lupin" },
  { code: "R", zh: "软体动物", de: "Weichtiere", en: "Molluscs" }
];

export const ALLERGEN_CODES = ALLERGENS.map((allergen) => allergen.code);

const byCode = new Map(ALLERGENS.map((allergen) => [allergen.code, allergen]));
const order = new Map(ALLERGEN_CODES.map((code, index) => [code, index]));

export function isAllergenCode(value) {
  return byCode.has(String(value ?? "").trim().toUpperCase());
}

export function allergenLabel(code, language) {
  const allergen = byCode.get(String(code ?? "").trim().toUpperCase());
  return allergen ? allergen[language] || allergen.en : "";
}

/** Uppercases, drops unknown codes and duplicates, and keeps the printed menu order. */
export function normalizeAllergens(values) {
  const source = Array.isArray(values) ? values : String(values ?? "").split(",");
  const codes = new Set();
  for (const value of source) {
    const code = String(value ?? "").trim().toUpperCase();
    if (byCode.has(code)) codes.add(code);
  }
  return [...codes].sort((left, right) => order.get(left) - order.get(right));
}

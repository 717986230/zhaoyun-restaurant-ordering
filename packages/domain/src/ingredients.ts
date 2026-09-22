/**
 * The menu, taken apart.
 *
 * A dish arrives from the kitchen as one line of German — `Ramen, Gemüse, Ei`
 * — and a set of allergen letters that apply to the dish as a whole. A guest
 * reading `A · C · F` off a tablet learns that the bowl contains gluten, egg
 * and soy somewhere, but not where, so the one question they actually have
 * ("which part is the egg, and can it be left out?") stays unanswered.
 *
 * This glossary answers it. Each German term the menu uses is given its
 * Chinese and English name and the allergens that term itself carries, so a
 * dish can be shown as its parts with the letters attached to the part they
 * come from.
 *
 * The rule that keeps this safe is `deconstruct` below: a letter is shown on a
 * part only if the dish already declares it. Allergen declarations are legal
 * statements under the LMIV, and a glossary must never be allowed to invent
 * one — it may only explain the ones the kitchen has already made. Anything
 * declared that no part accounts for is handed back separately rather than
 * quietly dropped, because that gap is usually a missing ingredient rather
 * than a wrong letter.
 */

export interface IngredientEntry {
  zh: string;
  en: string;
  /** Allergen letters this ingredient carries on its own, in menu order. */
  allergens: string[];
  /** A serving size or vessel rather than an ingredient — `0.33L`, `Flasche`. */
  portion?: true;
}

export const ingredients: Record<string, IngredientEntry> = {
  // Vegetables, herbs, aromatics
  "Gemüse": { zh: "蔬菜", en: "Vegetables", allergens: [] },
  "Saison-Gemüse": { zh: "时令蔬菜", en: "Seasonal vegetables", allergens: [] },
  "Salat": { zh: "沙拉", en: "Salad", allergens: [] },
  "Karotten": { zh: "胡萝卜", en: "Carrots", allergens: [] },
  "Gurke": { zh: "黄瓜", en: "Cucumber", allergens: [] },
  "Gurken": { zh: "黄瓜", en: "Cucumber", allergens: [] },
  "Pak Choi": { zh: "小白菜", en: "Pak choi", allergens: [] },
  "Zwiebel": { zh: "洋葱", en: "Onion", allergens: [] },
  "Jungzwiebel": { zh: "葱", en: "Spring onion", allergens: [] },
  "Bärlauch": { zh: "熊葱", en: "Wild garlic", allergens: [] },
  "Koriander": { zh: "香菜", en: "Coriander", allergens: [] },
  "Basilikum": { zh: "罗勒", en: "Basil", allergens: [] },
  "Minze": { zh: "薄荷", en: "Mint", allergens: [] },
  "Kresse": { zh: "水芹", en: "Cress", allergens: [] },
  "Thai-Kräuter": { zh: "泰式香草", en: "Thai herbs", allergens: [] },
  "Szechuan-Chili": { zh: "川味辣椒", en: "Szechuan chilli", allergens: [] },
  "frischer Chili": { zh: "鲜辣椒", en: "Fresh chilli", allergens: [] },
  "trockener Chili": { zh: "干辣椒", en: "Dried chilli", allergens: [] },
  "Algen": { zh: "海藻", en: "Seaweed", allergens: [] },
  "Nori": { zh: "海苔", en: "Nori", allergens: [] },

  // Fruit
  "Mango": { zh: "芒果", en: "Mango", allergens: [] },
  "Avocado": { zh: "牛油果", en: "Avocado", allergens: [] },
  "Ananas": { zh: "菠萝", en: "Pineapple", allergens: [] },
  "Apfel": { zh: "苹果", en: "Apple", allergens: [] },
  "Limette": { zh: "青柠", en: "Lime", allergens: [] },
  "Holunder": { zh: "接骨木花", en: "Elderflower", allergens: [] },

  // Meat and poultry
  "Huhn": { zh: "鸡肉", en: "Chicken", allergens: [] },
  "Hühnerfleisch": { zh: "鸡肉", en: "Chicken", allergens: [] },
  "Hühnerfilet": { zh: "鸡柳", en: "Chicken fillet", allergens: [] },
  "Hühnerstreifen": { zh: "鸡肉丝", en: "Chicken strips", allergens: [] },
  "Rind": { zh: "牛肉", en: "Beef", allergens: [] },
  "Rindfleisch": { zh: "牛肉", en: "Beef", allergens: [] },
  "Koreanisches Rindfleisch": { zh: "韩式牛肉", en: "Bulgogi beef", allergens: ["F", "N"] },
  "Lammfleisch": { zh: "羊肉", en: "Lamb", allergens: [] },
  "Ente": { zh: "鸭肉", en: "Duck", allergens: [] },
  "Entenfleisch": { zh: "鸭肉", en: "Duck", allergens: [] },
  "Knusperente": { zh: "脆皮鸭", en: "Crispy duck", allergens: [] },

  // Fish and seafood
  "Lachs": { zh: "三文鱼", en: "Salmon", allergens: ["D"] },
  "flambierter Lachs": { zh: "火炙三文鱼", en: "Torched salmon", allergens: ["D"] },
  "Lachs-Tatar": { zh: "三文鱼塔塔", en: "Salmon tartare", allergens: ["D"] },
  "Lachstempura": { zh: "三文鱼天妇罗", en: "Salmon tempura", allergens: ["A", "C", "D"] },
  "Thunfisch": { zh: "金枪鱼", en: "Tuna", allergens: ["D"] },
  "Hamachi": { zh: "油甘鱼", en: "Yellowtail", allergens: ["D"] },
  "Aal": { zh: "鳗鱼", en: "Eel", allergens: ["D"] },
  "flambierter Aal": { zh: "火炙鳗鱼", en: "Torched eel", allergens: ["D"] },
  "Masago": { zh: "多春鱼子", en: "Capelin roe", allergens: ["D"] },
  "Garnelen": { zh: "虾", en: "Prawns", allergens: ["B"] },
  "Gebackene Garnelen": { zh: "炸虾", en: "Fried prawns", allergens: ["A", "B", "C"] },
  "Meeresfrüchte": { zh: "海鲜", en: "Seafood", allergens: ["B", "R"] },
  "Oktopus-Bällchen": { zh: "章鱼小丸子", en: "Takoyaki", allergens: ["A", "C", "D", "R"] },

  // Soy, egg, dairy
  "Tofu": { zh: "豆腐", en: "Tofu", allergens: ["F"] },
  "Sojabohnen": { zh: "毛豆", en: "Soybeans", allergens: ["F"] },
  "Miso": { zh: "味噌", en: "Miso", allergens: ["F"] },
  "Ei": { zh: "鸡蛋", en: "Egg", allergens: ["C"] },
  "Milch": { zh: "牛奶", en: "Milk", allergens: ["G"] },
  "Kokosmilch": { zh: "椰奶", en: "Coconut milk", allergens: [] },
  "Cream Cheese": { zh: "奶油奶酪", en: "Cream cheese", allergens: ["G"] },
  "Mascarpone": { zh: "马斯卡彭", en: "Mascarpone", allergens: ["G"] },

  // Starches
  "Reis": { zh: "米饭", en: "Rice", allergens: [] },
  "Gekochter Reis": { zh: "白米饭", en: "Steamed rice", allergens: [] },
  "Eierreis": { zh: "蛋炒饭", en: "Egg fried rice", allergens: ["C"] },
  "Ramen": { zh: "拉面", en: "Ramen noodles", allergens: ["A"] },
  "Udon": { zh: "乌冬面", en: "Udon noodles", allergens: ["A"] },
  "Reisnudeln": { zh: "米粉", en: "Rice noodles", allergens: [] },
  "Glasnudel": { zh: "粉丝", en: "Glass noodles", allergens: [] },
  "Reiskuchen": { zh: "年糕", en: "Rice cake", allergens: [] },
  "Mochi": { zh: "麻糬", en: "Mochi", allergens: [] },
  "Teig": { zh: "面皮", en: "Dough", allergens: ["A"] },
  "Teigtaschen": { zh: "饺子", en: "Dumplings", allergens: ["A"] },
  "Gedämpfte Teigtaschen": { zh: "蒸饺", en: "Steamed dumplings", allergens: ["A"] },
  "Gyoza": { zh: "煎饺", en: "Gyoza", allergens: ["A"] },
  "Panko": { zh: "面包糠", en: "Panko", allergens: ["A"] },
  "Crispy Panko": { zh: "脆面包糠", en: "Crispy panko", allergens: ["A"] },
  "Süßkartoffeltempura": { zh: "红薯天妇罗", en: "Sweet potato tempura", allergens: ["A"] },
  "Biskuit": { zh: "蛋糕胚", en: "Sponge", allergens: ["A", "C"] },

  // Sauces and seasoning
  "Soße": { zh: "酱汁", en: "Sauce", allergens: ["A", "F"] },
  "Sushi-Soße": { zh: "寿司酱", en: "Sushi sauce", allergens: ["A", "F"] },
  "Teriyaki": { zh: "照烧", en: "Teriyaki", allergens: ["A", "F"] },
  "Teriyaki-Soße": { zh: "照烧酱", en: "Teriyaki sauce", allergens: ["A", "F"] },
  "Mayo": { zh: "蛋黄酱", en: "Mayonnaise", allergens: ["C"] },
  "Mayo-Soße": { zh: "蛋黄酱", en: "Mayo sauce", allergens: ["C"] },
  "Spicy Mayo": { zh: "辣蛋黄酱", en: "Spicy mayo", allergens: ["C"] },
  "koreanisch": { zh: "韩式辣酱", en: "Korean chilli sauce", allergens: ["A", "F"] },
  "Koreanischer scharfer Salat": { zh: "韩式辣拌菜", en: "Korean spicy salad", allergens: ["F", "N"] },
  "gelbes Curry": { zh: "黄咖喱", en: "Yellow curry", allergens: [] },
  "Sesam": { zh: "芝麻", en: "Sesame", allergens: ["N"] },
  "Erdnuss": { zh: "花生", en: "Peanut", allergens: ["E"] },
  "Meersalz": { zh: "海盐", en: "Sea salt", allergens: [] },
  "Matcha": { zh: "抹茶", en: "Matcha", allergens: [] },
  "Eis": { zh: "冰淇淋", en: "Ice cream", allergens: ["G"] },

  // Drinks
  "Kaffee": { zh: "咖啡", en: "Coffee", allergens: [] },
  "Tee": { zh: "茶", en: "Tea", allergens: [] },
  "Aperol": { zh: "艾普罗", en: "Aperol", allergens: ["O"] },
  "Prosecco": { zh: "普罗塞克", en: "Prosecco", allergens: ["O"] },

  // Serving sizes, not ingredients
  "0.10L": { zh: "0.10 升", en: "0.10 l", allergens: [], portion: true },
  "0.125L": { zh: "0.125 升", en: "0.125 l", allergens: [], portion: true },
  "0.25L": { zh: "0.25 升", en: "0.25 l", allergens: [], portion: true },
  "0.33L": { zh: "0.33 升", en: "0.33 l", allergens: [], portion: true },
  "0.50L": { zh: "0.50 升", en: "0.50 l", allergens: [], portion: true },
  "Flasche": { zh: "瓶装", en: "Bottle", allergens: [], portion: true }
};

export interface DishPart {
  /** The German term exactly as the menu writes it. */
  de: string;
  zh: string;
  en: string;
  /** Allergens this part explains — always a subset of the dish's own. */
  allergens: string[];
  /** True when the glossary has never seen this term. */
  unknown?: true;
}

export interface Deconstruction {
  parts: DishPart[];
  /** Serving sizes and vessels, kept out of the parts but not thrown away. */
  portions: DishPart[];
  /** Declared allergens no part accounts for — a gap in the data, shown as one. */
  unattributed: string[];
}

/** Splits an ingredient line the way the menu writes it, in either comma. */
export function ingredientTerms(line: string): string[] {
  return String(line ?? "").split(/[,，]/).map((term) => term.trim()).filter(Boolean);
}

export function deconstruct(product: { details: { ingredients: string }; allergens: string[] }): Deconstruction {
  const declared = new Set(product.allergens);
  const parts: DishPart[] = [];
  const portions: DishPart[] = [];
  const explained = new Set<string>();

  for (const term of ingredientTerms(product.details.ingredients)) {
    const entry = ingredients[term];
    if (!entry) {
      parts.push({ de: term, zh: term, en: term, allergens: [], unknown: true });
      continue;
    }
    // Only ever explain a letter the kitchen already declared.
    const allergens = entry.allergens.filter((code) => declared.has(code));
    for (const code of allergens) explained.add(code);
    const part: DishPart = { de: term, zh: entry.zh, en: entry.en, allergens };
    (entry.portion ? portions : parts).push(part);
  }

  return { parts, portions, unattributed: product.allergens.filter((code) => !explained.has(code)) };
}

export type AllergenCode = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "L" | "M" | "N" | "O" | "P" | "R";
export type AllergenLanguage = "zh" | "de" | "en";

export interface Allergen {
  code: AllergenCode;
  zh: string;
  de: string;
  en: string;
}

export declare const ALLERGENS: readonly Allergen[];
export declare const ALLERGEN_CODES: readonly AllergenCode[];
export declare function isAllergenCode(value: string): value is AllergenCode;
export declare function allergenLabel(code: string, language: AllergenLanguage): string;
export declare function normalizeAllergens(values: readonly string[] | string): AllergenCode[];

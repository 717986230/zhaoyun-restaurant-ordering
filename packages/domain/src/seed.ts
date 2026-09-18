/**
 * Service calls a guest can raise from the table. The names use the same
 * three-language shape as product and modifier names so every label in the
 * customer app resolves the same way.
 */
export const services = [
  { id: "water", names: { zh: "加水", de: "Wasser", en: "Water" } },
  { id: "utensils", names: { zh: "餐具", de: "Besteck", en: "Cutlery" } },
  { id: "napkin", names: { zh: "纸巾", de: "Servietten", en: "Napkins" } },
  { id: "takeaway", names: { zh: "打包", de: "Mitnehmen", en: "To go" } },
  { id: "clear", names: { zh: "收空盘", de: "Abräumen", en: "Clear plates" } },
  { id: "pay", names: { zh: "结账", de: "Bezahlen", en: "Pay" } }
] as const;

export type ServiceId = (typeof services)[number]["id"];

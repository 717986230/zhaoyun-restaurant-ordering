/** The languages a guest can switch the menu into, in flag order. */
export type MenuLanguage = "zh" | "en" | "de";

export const MENU_LANGUAGES: MenuLanguage[] = ["zh", "en", "de"];

/** What the menu offers until a manager says otherwise: the restaurant is in
 *  Austria, and English and German cover most of the room. */
export const DEFAULT_MENU_LANGUAGES: MenuLanguage[] = ["en", "de"];

function svg(viewBox: string, body: string): string {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`)}`;
}

/** A five-pointed star as polygon points, pointing at `rotation` degrees. */
function star(cx: number, cy: number, radius: number, rotation = -90): string {
  const points: string[] = [];
  for (let index = 0; index < 10; index += 1) {
    const r = index % 2 === 0 ? radius : radius * 0.382;
    const angle = ((rotation + index * 36) * Math.PI) / 180;
    points.push(`${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`);
  }
  return `<polygon points="${points.join(" ")}" fill="#ffde00"/>`;
}

/** Each small star points at the centre of the large one, as on the flag. */
function towardBig(x: number, y: number): number {
  return (Math.atan2(5 - y, 5 - x) * 180) / Math.PI;
}

/**
 * Flags as SVG data URLs rather than emoji: Windows draws a flag emoji as the
 * two letters of its country code, and a data URL renders the same in an
 * `<img>` everywhere, in either app, with no stylesheet colours involved.
 * English is the Union Flag — the language, not a country the guest is from.
 */
const FLAGS: Record<MenuLanguage, string> = {
  zh: svg("0 0 30 20", `<rect width="30" height="20" fill="#ee1c25"/>${star(5, 5, 3)}${
    ([[10, 2], [12, 4], [12, 7], [10, 9]] as const).map(([x, y]) => star(x, y, 1, towardBig(x, y))).join("")}`),
  en: svg("0 0 60 30", `<clipPath id="s"><path d="M0,0 v30 h60 v-30 z"/></clipPath><clipPath id="t"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z"/></clipPath><g clip-path="url(#s)"><path d="M0,0 v30 h60 v-30 z" fill="#012169"/><path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/><path d="M0,0 L60,30 M60,0 L0,30" clip-path="url(#t)" stroke="#c8102e" stroke-width="4"/><path d="M30,0 v30 M0,15 h60" stroke="#fff" stroke-width="10"/><path d="M30,0 v30 M0,15 h60" stroke="#c8102e" stroke-width="6"/></g>`),
  de: svg("0 0 5 3", `<rect width="5" height="3" fill="#ffce00"/><rect width="5" height="2" fill="#dd0000"/><rect width="5" height="1" fill="#000"/>`)
};

export const LANGUAGE_INFO: Record<MenuLanguage, { name: string; nameZh: string; flag: string }> = {
  zh: { name: "中文", nameZh: "中文", flag: FLAGS.zh },
  en: { name: "English", nameZh: "英语", flag: FLAGS.en },
  de: { name: "Deutsch", nameZh: "德语", flag: FLAGS.de }
};

/**
 * The language a guest sees: the one they picked, if the menu still offers it;
 * otherwise their phone's language, if offered; otherwise German, English,
 * Chinese — the first of those the restaurant has switched on.
 */
export function resolveMenuLanguage(
  chosen: MenuLanguage | null | undefined,
  offered: readonly MenuLanguage[],
  browserLanguages: readonly string[] = []
): MenuLanguage {
  const available = offered.length ? offered : DEFAULT_MENU_LANGUAGES;
  if (chosen && available.includes(chosen)) return chosen;
  for (const tag of browserLanguages) {
    const primary = tag.toLowerCase().split("-")[0] as MenuLanguage;
    if (available.includes(primary)) return primary;
  }
  return (["de", "en", "zh"] as const).find((language) => available.includes(language)) ?? "de";
}

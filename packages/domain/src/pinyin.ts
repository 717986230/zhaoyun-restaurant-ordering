const ZH_COLLATOR = typeof Intl !== "undefined" ? new Intl.Collator("zh-CN") : null;
const PINYIN_LETTERS = "abcdefghjklmnopqrstwxyz";
const PINYIN_BOUNDS = "吖八嚓咑妸发旮哈讥咔拉妈拿哦啪期然撒塌挖昔压匝";

/**
 * Extract lowercase Pinyin initials from Chinese characters while preserving
 * ASCII letters and digits (e.g. "水煮牛肉" -> "sznr", "25周年" -> "25zn").
 */
export function pinyinInitials(text: string): string {
  if (!text) return "";
  let out = "";
  for (const ch of text) {
    if (ch >= "\u4e00" && ch <= "\u9fff") {
      if (!ZH_COLLATOR || ZH_COLLATOR.compare(ch, "吖") < 0) continue;
      let idx = 0;
      for (let i = 0; i < PINYIN_BOUNDS.length; i++) {
        const bound = PINYIN_BOUNDS[i];
        if (bound && ZH_COLLATOR.compare(ch, bound) >= 0) idx = i;
      }
      out += PINYIN_LETTERS.charAt(idx);
    } else if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9")) {
      out += ch.toLowerCase();
    }
  }
  return out;
}

/**
 * Return true when a trimmed lowercase `needle` matches any candidate value
 * directly or via CJK Pinyin initials (e.g. "sz" matching "水煮牛肉").
 */
export function matchesTextOrPinyin(needle: string, values: Array<string | null | undefined>): boolean {
  if (!needle) return true;
  const asciiNeedle = /^[a-z0-9]+$/.test(needle);
  for (const raw of values) {
    if (!raw) continue;
    if (raw.toLowerCase().includes(needle)) return true;
    if (asciiNeedle && /[\u4e00-\u9fff]/.test(raw) && pinyinInitials(raw).includes(needle)) return true;
  }
  return false;
}

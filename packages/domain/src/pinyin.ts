const ZH_COLLATOR = typeof Intl !== "undefined" ? new Intl.Collator("zh-CN") : null;
const PINYIN_LETTERS = "abcdefghjklmnopqrstwxyz";
const PINYIN_BOUNDS = "吖八嚓咑妸发旮哈讥咔拉妈拿哦啪期然撒塌挖昔压匝";
const CHAR_INITIAL_CACHE = new Map<string, string>();
const PINYIN_CACHE = new Map<string, string>();
const PINYIN_CACHE_MAX = 2000;

function cjkInitial(ch: string): string {
  const cached = CHAR_INITIAL_CACHE.get(ch);
  if (cached !== undefined) return cached;
  let initial = "";
  if (ZH_COLLATOR && ZH_COLLATOR.compare(ch, "吖") >= 0) {
    let idx = 0;
    for (let i = 0; i < PINYIN_BOUNDS.length; i++) {
      const bound = PINYIN_BOUNDS[i];
      if (bound && ZH_COLLATOR.compare(ch, bound) >= 0) idx = i;
    }
    initial = PINYIN_LETTERS.charAt(idx);
  }
  CHAR_INITIAL_CACHE.set(ch, initial);
  return initial;
}

/**
 * Extract lowercase Pinyin initials from Chinese characters while preserving
 * ASCII letters and digits (e.g. "水煮牛肉" -> "sznr", "25周年" -> "25zn").
 */
export function pinyinInitials(text: string): string {
  if (!text) return "";
  const hit = PINYIN_CACHE.get(text);
  if (hit !== undefined) return hit;
  let out = "";
  for (const ch of text) {
    if (ch >= "\u4e00" && ch <= "\u9fff") {
      out += cjkInitial(ch);
    } else if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9")) {
      out += ch.toLowerCase();
    }
  }
  if (PINYIN_CACHE.size >= PINYIN_CACHE_MAX) PINYIN_CACHE.clear();
  PINYIN_CACHE.set(text, out);
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

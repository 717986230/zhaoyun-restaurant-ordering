/**
 * 会员等级的视觉与特权等级 (member-tier visuals).
 *
 * The owner names and prices each 会员等级 themselves (shared/customer.mjs). What
 * a level *looks* like — its 龙纹徽章 (dragon badge) material and, from level 5,
 * the exclusive member interface — follows the level's rank from the bottom, so
 * every restaurant's ladder reads the same: climb and the metal warms from
 * bronze to the 暗黑龙王 (dark dragon king, 5+) and finally the 鎏金龙王 (gilded
 * dragon king, 7+) glass skin. Shared by the guest app, the admin console and
 * the till so one badge is drawn the same everywhere.
 */

export type MemberTierTheme = "bronze" | "silver" | "gold" | "platinum" | "dark" | "gilded";

/** The exclusive member-interface skin a level unlocks, or null for none. */
export type MemberTierSkin = null | "dark" | "gilded";

export interface MemberTierVisual {
  /** Badge material / colourway, used as a CSS `data-tier-theme` hook. */
  theme: MemberTierTheme;
  /** 龙王称号 — the flavour rank shown beside the owner's own tier name. */
  rank: string;
  /** The exclusive full-screen member skin this level turns on (5+ / 7+). */
  skin: MemberTierSkin;
}

const RANKS: Record<MemberTierTheme, string> = {
  bronze: "青铜龙纹",
  silver: "白银龙纹",
  gold: "黄金龙纹",
  platinum: "铂金龙鳞",
  dark: "暗黑龙王",
  gilded: "鎏金龙王"
};

/** The theme a 1-indexed level sits in (0 or below = no tier reached). */
export function memberTierTheme(level: number): MemberTierTheme | null {
  if (!Number.isFinite(level) || level < 1) return null;
  if (level >= 7) return "gilded";
  if (level >= 5) return "dark";
  if (level >= 4) return "platinum";
  if (level >= 3) return "gold";
  if (level >= 2) return "silver";
  return "bronze";
}

/** The full visual for a level: badge material, 龙王称号, and exclusive skin. */
export function memberTierVisual(level: number): MemberTierVisual | null {
  const theme = memberTierTheme(level);
  if (!theme) return null;
  const skin: MemberTierSkin = theme === "gilded" ? "gilded" : theme === "dark" ? "dark" : null;
  return { theme, rank: RANKS[theme], skin };
}

/** Roman numeral for the badge face (I–VIII). Plain number past VIII. */
export function tierNumeral(level: number): string {
  const numerals = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII"];
  return numerals[level] ?? String(level);
}

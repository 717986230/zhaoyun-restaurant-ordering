import { memberTierTheme, tierNumeral, type MemberTierTheme } from "@zhaoyun/domain";
import type { PosKey, PosTranslate } from "./i18n";

const RANK_KEY: Record<MemberTierTheme, PosKey> = {
  bronze: "rankBronze", silver: "rankSilver", gold: "rankGold", platinum: "rankPlatinum", dark: "rankDark", gilded: "rankGilded"
};

/** 会员龙纹小徽章 at the till, so staff see a member's standing while they pay
 *  from stored value (shared src/member-tier.css). */
export function TierChip({ level, t }: { level: number; t: PosTranslate }) {
  const theme = memberTierTheme(level);
  if (!theme) return null;
  return (
    <span className="tier-chip" data-tier-theme={theme} title={t(RANK_KEY[theme])}>
      <span className="tier-chip-coin" aria-hidden="true">{tierNumeral(level)}</span>
      <span className="tier-chip-text">{t(RANK_KEY[theme])}</span>
    </span>
  );
}

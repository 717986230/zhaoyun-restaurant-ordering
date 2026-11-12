import { memberTierTheme, tierNumeral, type MemberTierTheme } from "@zhaoyun/domain";
import { useI18n } from "../../app/i18n";
import type { CopyKey } from "../../app/i18n";

const RANK_KEY: Record<MemberTierTheme, CopyKey> = {
  bronze: "rankBronze", silver: "rankSilver", gold: "rankGold", platinum: "rankPlatinum", dark: "rankDark", gilded: "rankGilded"
};

/** 会员等级的龙纹小徽章 for the console: a coin with the 龙 glyph, the level
 *  numeral and the rank, coloured by the level (shared src/member-tier.css). */
export function TierChip({ level }: { level: number }) {
  const { t } = useI18n();
  const theme = memberTierTheme(level);
  if (!theme) return null;
  return (
    <span className="tier-chip" data-tier-theme={theme} title={t(RANK_KEY[theme])}>
      <span className="tier-chip-coin" aria-hidden="true">{tierNumeral(level)}</span>
      <span className="tier-chip-text">{t(RANK_KEY[theme])}</span>
    </span>
  );
}

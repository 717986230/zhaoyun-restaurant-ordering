import { useId } from "react";
import { tierNumeral } from "@zhaoyun/domain";

/**
 * 会员龙纹徽章 — a member's medallion: an ornate tier-coloured frame around a
 * round avatar slot. The frame's metal warms as the level climbs (recoloured by
 * `data-tier-theme`), a 鎏金 (gilded) badge sweeps a foil sheen, a flaming pearl
 * crowns it and a numeral plate marks the level. The centre holds the member's
 * uploaded avatar when there is one; until then it falls back to their initial.
 * Drawn from primitives, so it stays light and crisp at any size.
 */
export function MemberBadge({ level, rank, size = "md", animate = false, avatarUrl, initial }: {
  level: number;
  rank: string;
  size?: "sm" | "md" | "lg";
  animate?: boolean;
  /** The member's photo, once uploads land; otherwise the initial is shown. */
  avatarUrl?: string;
  /** Fallback glyph for the avatar slot — usually the first letter of a name. */
  initial?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const disc = `disc-${uid}`;
  const foil = `foil-${uid}`;
  const clip = `clip-${uid}`;
  const numeral = tierNumeral(level);
  return (
    <span className={`member-badge member-badge-${size}${animate ? " is-animating" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 120 120" role="presentation" focusable="false">
        <defs>
          <radialGradient id={disc} cx="50%" cy="38%" r="72%">
            <stop offset="0%" style={{ stopColor: "var(--badge-disc-1)" }} />
            <stop offset="100%" style={{ stopColor: "var(--badge-disc-2)" }} />
          </radialGradient>
          <linearGradient id={foil} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--badge-foil-1)" }} />
            <stop offset="50%" style={{ stopColor: "var(--badge-foil-2)" }} />
            <stop offset="100%" style={{ stopColor: "var(--badge-foil-1)" }} />
          </linearGradient>
          <clipPath id={clip}><circle cx="60" cy="58" r="31" /></clipPath>
        </defs>
        {/* medallion frame */}
        <circle cx="60" cy="60" r="57" fill={`url(#${disc})`} stroke="var(--badge-ring)" strokeWidth="2.5" />
        <circle cx="60" cy="60" r="51" fill="none" stroke="var(--badge-ring)" strokeWidth="1" strokeDasharray="1.6 4.2" opacity="0.7" />
        {/* avatar slot */}
        <circle cx="60" cy="58" r="33" fill="var(--badge-disc-2)" stroke="var(--badge-ring)" strokeWidth="1.5" />
        {avatarUrl
          ? <image href={avatarUrl} x="29" y="27" width="62" height="62" clipPath={`url(#${clip})`} preserveAspectRatio="xMidYMid slice" />
          : <text x="60" y="70" textAnchor="middle" className="member-badge-initial" fill={`url(#${foil})`}>{(initial ?? "").slice(0, 1).toUpperCase()}</text>}
        {/* flaming pearl crowning the frame */}
        <circle cx="60" cy="18" r="4.6" fill={`url(#${foil})`} />
        <path d="M60 11c2.7 2.1 2.7 5 0 7.2-2.7-2.2-2.7-5.1 0-7.2z" fill={`url(#${foil})`} opacity="0.85" />
        {/* level numeral plate */}
        <g className="member-badge-rank">
          <rect x="44" y="92" width="32" height="15" rx="7.5" fill="var(--badge-plate)" stroke="var(--badge-ring)" strokeWidth="0.8" />
          <text x="60" y="103" textAnchor="middle" className="member-badge-numeral" fill="var(--badge-foil-2)">{numeral}</text>
        </g>
      </svg>
      <span className="member-badge-sheen" />
      <span className="sr-only">{rank}</span>
    </span>
  );
}

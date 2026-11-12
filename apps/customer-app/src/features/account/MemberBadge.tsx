import { useId } from "react";
import { tierNumeral } from "@zhaoyun/domain";

/**
 * 龙纹徽章 — a member's dragon medallion. One vector emblem, recoloured by the
 * level's `data-tier-theme` (src/styles.css): the metal warms as the level
 * climbs, and a 鎏金 (gilded) badge sweeps a foil sheen. The 龙 glyph is the
 * centrepiece — a single calligraphic character, as premium cards do — over a
 * 戏珠 (toying-with-the-pearl) flame. All original, drawn from primitives, so it
 * stays light and crisp at any size and in any language.
 */
export function MemberBadge({ level, rank, size = "md", animate = false }: {
  level: number;
  rank: string;
  size?: "sm" | "md" | "lg";
  animate?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const disc = `disc-${uid}`;
  const foil = `foil-${uid}`;
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
        </defs>
        {/* medallion body */}
        <circle cx="60" cy="60" r="57" fill={`url(#${disc})`} stroke="var(--badge-ring)" strokeWidth="2.5" />
        <circle cx="60" cy="60" r="51" fill="none" stroke="var(--badge-ring)" strokeWidth="1" strokeDasharray="1.6 4.2" opacity="0.7" />
        <circle cx="60" cy="60" r="45" fill="none" stroke="var(--badge-ring)" strokeWidth="0.8" opacity="0.5" />
        {/* flaming pearl the dragon toys with */}
        <circle cx="60" cy="24" r="4.4" fill={`url(#${foil})`} />
        <path d="M60 17.5c2.6 2 2.6 4.8 0 7-2.6-2.2-2.6-5 0-7z" fill={`url(#${foil})`} opacity="0.85" />
        {/* 龙 — the dragon king */}
        <text x="60" y="74" textAnchor="middle" className="member-badge-glyph" fill={`url(#${foil})`}>龙</text>
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

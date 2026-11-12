import { useEffect, useState } from "react";
import type { ApiCustomer } from "@zhaoyun/contracts";
import { memberTierVisual } from "@zhaoyun/domain";
import { g, tierRank } from "../../app/guest-i18n";
import type { Language } from "../../app/i18n";
import { MemberBadge } from "./MemberBadge";
import { playChime, prefersReducedMotion } from "./useTierEntry";

const SEEN = "member-entrance-";

function seen(id: string): boolean {
  try { return window.sessionStorage.getItem(SEEN + id) === "1"; } catch { return false; }
}
function markSeen(id: string): void {
  try { window.sessionStorage.setItem(SEEN + id, "1"); } catch { /* private mode */ }
}
/** Signing out lets the next sign-in on this phone make its entrance again. */
export function forgetEntrances(): void {
  try {
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith(SEEN)) window.sessionStorage.removeItem(key);
    }
  } catch { /* private mode */ }
}

/**
 * 会员入场 — the moment a tiered member signs in (or first opens the menu this
 * visit): a full-screen reveal of their medallion, 龙王称号 and level name over
 * their tier's skin, with the entry chime. Once per visit; a tap dismisses it.
 */
export function MemberEntrance({ customer, language }: { customer: ApiCustomer | null; language: Language }) {
  const level = customer?.membership?.tierLevel ?? 0;
  const visual = memberTierVisual(level);
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!customer || !visual || seen(customer.id)) return;
    markSeen(customer.id);
    setOpen(true);
    setLeaving(false);
    playChime(visual.theme);
    const linger = prefersReducedMotion() ? 2200 : 3200;
    const out = window.setTimeout(() => setLeaving(true), linger);
    const done = window.setTimeout(() => setOpen(false), linger + 500);
    return () => { window.clearTimeout(out); window.clearTimeout(done); };
  }, [customer?.id, visual?.theme]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !customer || !visual) return null;
  const name = customer.name || customer.email.split("@")[0] || customer.email;
  return (
    <div
      className={`member-entrance tier-skin-${visual.skin ?? "plain"}${leaving ? " is-leaving" : ""}`}
      data-tier-theme={visual.theme}
      role="status"
      aria-live="polite"
      onClick={() => { setLeaving(true); window.setTimeout(() => setOpen(false), 400); }}
    >
      <div className="member-entrance-rays" aria-hidden="true" />
      <div className="member-entrance-card">
        <MemberBadge level={level} rank={tierRank(language, visual.theme)} size="lg" animate initial={name} />
        <span className="member-entrance-rank">{tierRank(language, visual.theme)}</span>
        <strong className="member-entrance-name">{customer.membership?.tier}</strong>
        <span className="member-entrance-welcome">{g(language, "welcome", { name })}</span>
      </div>
    </div>
  );
}

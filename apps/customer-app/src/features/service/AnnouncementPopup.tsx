import { useEffect, useRef, useState } from "react";
import { m, useReducedMotion } from "motion/react";
import type { ApiMenuSettings, MenuLanguage } from "@zhaoyun/contracts";
import { t } from "../../app/i18n";
import type { Language } from "../../app/i18n";

type Announcement = NonNullable<ApiMenuSettings["announcement"]>;

/** The text in the guest's language, else the first one the owner filled in. */
function pick(text: Partial<Record<MenuLanguage, string>>, language: Language): string {
  return text[language] ?? Object.values(text).find((value) => value) ?? "";
}

/**
 * A stable id for this announcement's content: shown once per guest until the
 * owner edits the text, at which point the id changes and it shows again — so
 * editing is republishing, with no version number for the owner to remember.
 */
function contentKey(announcement: Announcement): string {
  return JSON.stringify([announcement.title, announcement.body]);
}

const SEEN = "zy_announce_seen";
function seen(key: string): boolean {
  try { return window.localStorage.getItem(SEEN) === key; } catch { return false; }
}
function markSeen(key: string): void {
  try { window.localStorage.setItem(SEEN, key); } catch { /* private mode: it shows again next time */ }
}

const EASE = [0.2, 0.7, 0.2, 1] as const;

/**
 * 公告弹窗 — the notice the restaurant greets guests with when the menu opens.
 * Its text is the owner's, edited and published from the console; this only
 * shows it, once, over a frosted scrim, with a tap, the ×, Escape or the
 * button to dismiss it. An empty notice shows nothing.
 */
export function AnnouncementPopup({ announcement, language }: { announcement: Announcement; language: Language }) {
  const reduceMotion = useReducedMotion();
  const key = contentKey(announcement);
  const [open, setOpen] = useState(() => !seen(key));
  const card = useRef<HTMLElement>(null);

  // A fresh notice (its text changed) shows again even on a phone that saw the
  // last one; closing it remembers this one.
  useEffect(() => { setOpen(!seen(key)); }, [key]);
  useEffect(() => { if (open) card.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = pick(announcement.title, language);
  const body = pick(announcement.body, language);
  if (!open || !body) return null;

  function close() {
    markSeen(key);
    setOpen(false);
  }

  return <m.div className="announce-scrim" role="presentation"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1, transition: { duration: reduceMotion ? 0 : 0.4, ease: EASE } }}
    exit={{ opacity: 0 }}
    onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <m.section ref={card} className="announce-card" role="dialog" aria-modal="true"
      aria-label={title || t(language, "announceTitle")} tabIndex={-1}
      initial={reduceMotion ? false : { opacity: 0, scale: 0.92, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: reduceMotion ? 0 : 0.5, ease: EASE } }}>
      <span className="announce-flourish" aria-hidden="true" />
      <button type="button" className="announce-close" aria-label={t(language, "announceClose")} onClick={close}>×</button>
      {title && <h2 className="announce-title">{title}</h2>}
      <p className="announce-body">{body}</p>
      <button type="button" className="announce-ok" onClick={close}>{t(language, "announceOk")}</button>
    </m.section>
  </m.div>;
}

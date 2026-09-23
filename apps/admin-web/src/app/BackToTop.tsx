import { useEffect, useState } from "react";

/**
 * One button, at the end of the pinned tab bar where it covers nothing, that
 * takes whatever long thing is scrolled back to its top: the
 * page on a phone or the settings, and on a computer the dish list or the
 * editor, which scroll inside their own boxes. It listens for scrolling
 * anywhere (scroll events do not bubble, but they can be caught on the way
 * down) and follows the box last scrolled, so no screen has to wire it up.
 * Small scrollers — a textarea, the set picker's options — are ignored.
 * Remount it (a `key`) when the screen changes, so it forgets the old box.
 */
export function BackToTop({ label }: { label: string }) {
  const [target, setTarget] = useState<Element | null>(null);

  useEffect(() => {
    let frame = 0;
    let last: Element | null = null;
    const check = () => {
      frame = 0;
      if (!last || !last.isConnected) return setTarget(null);
      setTarget(last.scrollTop > Math.max(480, last.clientHeight) ? last : null);
    };
    const onScroll = (event: Event) => {
      const scrolled = event.target === document ? document.scrollingElement : event.target;
      if (!(scrolled instanceof Element)) return;
      if (scrolled !== document.scrollingElement && scrolled.clientHeight < window.innerHeight * 0.4) return;
      last = scrolled;
      if (!frame) frame = requestAnimationFrame(check);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      cancelAnimationFrame(frame);
    };
  }, []);

  const smooth = typeof window.matchMedia !== "function" || !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return <button
    type="button"
    className={`back-to-top ${target ? "on" : ""}`}
    aria-label={label}
    title={label}
    aria-hidden={!target}
    tabIndex={target ? 0 : -1}
    onClick={() => target?.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" })}
  ><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" /></svg></button>;
}

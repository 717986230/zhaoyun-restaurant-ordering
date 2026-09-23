import { useEffect, useState } from "react";

/**
 * The time, updated as each minute turns — and at once when the phone wakes
 * or the tab comes back, since a sleeping phone runs no timers. Enough for a
 * menu whose lunch set has to be gone at 14:30, not at 14:30 plus however
 * long the guest left the page open.
 */
export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      window.clearTimeout(timer);
      const current = new Date();
      setNow(current);
      // Just past the next minute, so the check lands after the boundary.
      timer = window.setTimeout(tick, 60_000 - (current.getTime() % 60_000) + 50);
    };
    const wake = () => { if (document.visibilityState === "visible") tick(); };
    tick();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("pageshow", wake);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("pageshow", wake);
    };
  }, []);
  return now;
}

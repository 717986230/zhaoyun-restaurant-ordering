import { useEffect, useRef, useState } from "react";

const CHECK_INTERVAL_MS = 180_000;

/**
 * Watches `/api/health` (`version`) and flags when a newer build is live,
 * so Desktop / Capacitor / PWA shells can prompt a 1-tap reload.
 */
export function useAppUpdate(checkHealth: () => Promise<{ version?: string | null }>): boolean {
  const [available, setAvailable] = useState(false);
  const initial = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const { version } = await checkHealth();
        if (!active || !version || version === "dev") return;
        if (initial.current === null) initial.current = version;
        else if (version !== initial.current) setAvailable(true);
      } catch {
        /* Offline or server restarting: keep current state. */
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
    const onFocus = () => { if (document.visibilityState === "visible") void check(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [checkHealth]);

  return available;
}

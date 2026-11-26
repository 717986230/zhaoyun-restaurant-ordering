import { useCallback, useEffect, useState } from "react";

const ELDER_STORAGE_KEY = "zy_elder_mode";
const ELDER_EVENT = "zy-elder-change";

export function readElderMode(): boolean {
  try {
    return localStorage.getItem(ELDER_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function applyElderMode(enabled: boolean): void {
  if (typeof document === "undefined") return;
  if (enabled) document.documentElement.dataset.elder = "true";
  else delete document.documentElement.dataset.elder;
}

/**
 * Shared Senior / Elder ultra-minimal mode across Menu, Member, and Booking.
 * Syncs across sheets and standalone /book.html via localStorage + custom event.
 */
export function useElderMode(): [boolean, () => void] {
  const [elder, setElder] = useState<boolean>(readElderMode);

  useEffect(() => {
    applyElderMode(elder);
  }, [elder]);

  useEffect(() => {
    const sync = () => setElder(readElderMode());
    window.addEventListener(ELDER_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(ELDER_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggle = useCallback(() => {
    const next = !readElderMode();
    try {
      localStorage.setItem(ELDER_STORAGE_KEY, next ? "1" : "0");
    } catch { /* Private browsing keeps it for this visit only. */ }
    applyElderMode(next);
    setElder(next);
    window.dispatchEvent(new Event(ELDER_EVENT));
  }, []);

  return [elder, toggle];
}

import { useEffect, useState } from "react";

/**
 * "安装桌面版": the console installed as an app of its own — its own window,
 * its own icon on the desktop, the Start menu or the Dock — from the
 * manifest admin.html links (public/admin.webmanifest). Nothing to download
 * and keep up to date: it is this same site, so every deploy reaches it.
 *
 * Chrome and Edge offer the install through `beforeinstallprompt`, which can
 * fire before React has mounted, so it is caught here, when this module
 * loads. Where there is no such offer (Safari, an iPhone, a prompt the owner
 * dismissed earlier), the console says how, for the browser in use.
 */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallPlatform = "chromium" | "safari" | "ios" | "android" | "unsupported";

let offer: InstallPromptEvent | null = null;
let justInstalled = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    offer = event as InstallPromptEvent;
    changed();
  });
  window.addEventListener("appinstalled", () => {
    offer = null;
    justInstalled = true;
    changed();
  });
}

/** Already running as the installed app. */
export function isInstalledApp(): boolean {
  if (typeof window === "undefined") return false;
  const standalone = typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
  return standalone || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function installPlatform(agent = navigator.userAgent, touchPoints = navigator.maxTouchPoints ?? 0): InstallPlatform {
  if (/iPad|iPhone|iPod/.test(agent) || (/Macintosh/.test(agent) && touchPoints > 1)) return "ios";
  if (/Android/.test(agent)) return "android";
  if (/Edg\/|Chrome\/|Chromium\//.test(agent)) return "chromium";
  if (/Safari\//.test(agent) && !/Firefox\//.test(agent)) return "safari";
  return "unsupported";
}

export function useInstall() {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const listener = () => setVersion((version) => version + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  return {
    /** The browser offers to install it, and a tap will ask. */
    canPrompt: Boolean(offer),
    installed: justInstalled || isInstalledApp(),
    platform: installPlatform(),
    /** Asks the browser; false when it was declined or there is nothing to ask. */
    async install(): Promise<boolean> {
      const event = offer;
      if (!event) return false;
      await event.prompt();
      const { outcome } = await event.userChoice;
      // The offer is spent either way; the browser makes a new one later.
      offer = null;
      changed();
      return outcome === "accepted";
    }
  };
}

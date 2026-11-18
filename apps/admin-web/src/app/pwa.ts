/**
 * Opening the other apps (the POS, the booking page, the guest menu) from the
 * console.
 *
 * On a phone the console is usually added to the home screen and runs as a
 * standalone web app (public/admin.webmanifest, display:standalone). iOS gives
 * a standalone app no second tab, so a same-origin link with target="_blank"
 * there opens a blank — a black screen — instead of the page. (A cross-origin
 * link, e.g. the stock app, escapes to Safari and is fine; the trap is the
 * system's own same-origin pages: book.html, pos.html, index.html.)
 *
 * So when we are the installed app we drop target and let the tap navigate:
 * every one of these destinations sits outside the console's scope
 * (scope: ./admin.html), so iOS hands it to Safari and the page opens. In an
 * ordinary browser tab we keep target="_blank", so the console stays put in
 * its own tab while the other app opens beside it.
 */

/** The console is running as the installed standalone app, not a browser tab. */
export function runningStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const displayMode = typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
  // iOS Safari's own flag, set only for a home-screen web app.
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return displayMode || iosStandalone;
}

export interface JumpLinkProps {
  href: string;
  rel: string;
  target?: "_blank";
}

/**
 * The anchor props for a "open another app" link: a new tab in a browser, a
 * plain navigation (which iOS routes to Safari) in the installed app.
 */
export function jumpLinkProps(href: string, standalone: boolean = runningStandalone()): JumpLinkProps {
  const rel = "noopener noreferrer";
  return standalone ? { href, rel } : { href, rel, target: "_blank" };
}

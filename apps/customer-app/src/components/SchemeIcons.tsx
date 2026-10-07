/** Line icons for the light/dark switch, on the menu and the booking page alike; the ☀ ☾ glyphs look different on every phone. */
export function SunIcon() {
  return <svg className="scheme-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></svg>;
}

export function MoonIcon() {
  return <svg className="scheme-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.2A8 8 0 0 1 9.8 4a8 8 0 1 0 10.2 10.2z" /></svg>;
}

import { useCallback, useState } from "react";

export type ColorScheme = "dark" | "light";

const storageKey = "zy_color_scheme";

/**
 * Dark unless this guest has asked for light. Dark is the menu as designed —
 * a dim dining room, the artwork glowing — and light is the one a guest by a
 * window at lunch switches to; it is their phone, so the choice stays on it.
 */
export function storedColorScheme(): ColorScheme {
  try {
    return localStorage.getItem(storageKey) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** Sets the attribute styles.css switches its token set on. Called once before
 *  the first render too, so a light-mode guest never sees a dark flash. */
export function applyColorScheme(scheme: ColorScheme): void {
  document.documentElement.dataset.theme = scheme;
}

export function useColorScheme(): [ColorScheme, () => void] {
  const [scheme, setScheme] = useState<ColorScheme>(storedColorScheme);
  const toggle = useCallback(() => {
    setScheme((current) => {
      const next: ColorScheme = current === "dark" ? "light" : "dark";
      applyColorScheme(next);
      try { localStorage.setItem(storageKey, next); } catch { /* A private tab keeps it for this visit only. */ }
      return next;
    });
  }, []);
  return [scheme, toggle];
}

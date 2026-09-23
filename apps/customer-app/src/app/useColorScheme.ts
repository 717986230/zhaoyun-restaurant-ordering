import { useCallback, useEffect, useState } from "react";

export type ColorScheme = "dark" | "light";

const storageKey = "zy_color_scheme";

/**
 * The guest's own pick, if they have made one on this phone; null if not.
 * Until they do, the menu shows the restaurant's default (设置 → 默认明暗).
 */
export function storedColorScheme(): ColorScheme | null {
  try {
    const stored = localStorage.getItem(storageKey);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

/** Sets the attribute styles.css switches its token set on. Called once before
 *  the first render too, so a light-mode guest never sees a dark flash. */
export function applyColorScheme(scheme: ColorScheme): void {
  document.documentElement.dataset.theme = scheme;
}

/**
 * `restaurantDefault` is what the restaurant chose; the guest's own tap
 * overrides it on their phone and is remembered there. Dark when neither has
 * said anything — the menu as designed, for a dim dining room.
 */
export function useColorScheme(restaurantDefault: ColorScheme | undefined): [ColorScheme, () => void] {
  const [chosen, setChosen] = useState<ColorScheme | null>(storedColorScheme);
  const scheme: ColorScheme = chosen ?? restaurantDefault ?? "dark";

  useEffect(() => { applyColorScheme(scheme); }, [scheme]);

  const toggle = useCallback(() => {
    const next: ColorScheme = scheme === "dark" ? "light" : "dark";
    setChosen(next);
    try { localStorage.setItem(storageKey, next); } catch { /* A private tab keeps it for this visit only. */ }
  }, [scheme]);

  return [scheme, toggle];
}

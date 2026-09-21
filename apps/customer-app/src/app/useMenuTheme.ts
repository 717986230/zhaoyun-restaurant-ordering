import { useEffect } from "react";
import type { MenuThemeId } from "@zhaoyun/contracts";
import { DEFAULT_MENU_THEME, MENU_THEMES } from "@zhaoyun/domain";

/**
 * The only thing 菜单样式 changes: the accent group `src/styles.css` declares
 * on `:root`. An inline custom property on the root element wins the cascade
 * over the stylesheet's own default without touching a single class name, so
 * every component that already reads `var(--accent)` picks the new one up
 * for free the moment the catalogue answers with a style.
 */
export function useMenuTheme(themeId: MenuThemeId | undefined): void {
  useEffect(() => {
    const theme = MENU_THEMES[themeId ?? DEFAULT_MENU_THEME] ?? MENU_THEMES[DEFAULT_MENU_THEME];
    const root = document.documentElement.style;
    root.setProperty("--accent", theme.accent);
    root.setProperty("--accent-strong", theme.accentStrong);
    root.setProperty("--accent-ink", theme.accentInk);
    root.setProperty("--accent-line", theme.accentLine);
    root.setProperty("--accent-wash", theme.accentWash);
  }, [themeId]);
}

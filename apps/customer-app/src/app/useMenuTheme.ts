import { useEffect } from "react";
import type { MenuThemeId } from "@zhaoyun/contracts";
import { DEFAULT_MENU_THEME, MENU_THEMES } from "@zhaoyun/domain";
import type { ColorScheme } from "./useColorScheme";

/**
 * The only thing 菜单样式 changes: the accent group `src/styles.css` declares
 * on `:root`. An inline custom property on the root element wins the cascade
 * over the stylesheet's own default without touching a single class name, so
 * every component that already reads `var(--accent)` picks the new one up
 * for free the moment the catalogue answers with a style.
 *
 * Each style has a darker shade for the light menu — the dark one's pale
 * celadon is unreadable on white — so the scheme picks which shade is set.
 */
export function useMenuTheme(themeId: MenuThemeId | undefined, scheme: ColorScheme = "dark"): void {
  useEffect(() => {
    const theme = MENU_THEMES[themeId ?? DEFAULT_MENU_THEME] ?? MENU_THEMES[DEFAULT_MENU_THEME];
    const accent = scheme === "light" ? theme.light : theme;
    const root = document.documentElement.style;
    root.setProperty("--accent", accent.accent);
    root.setProperty("--accent-strong", accent.accentStrong);
    root.setProperty("--accent-ink", accent.accentInk);
    root.setProperty("--accent-line", accent.accentLine);
    root.setProperty("--accent-wash", accent.accentWash);
  }, [themeId, scheme]);
}

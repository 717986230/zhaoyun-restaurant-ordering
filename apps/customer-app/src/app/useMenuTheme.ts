import { useEffect } from "react";
import type { MenuThemeId } from "@zhaoyun/contracts";
import { DEFAULT_MENU_THEME, MENU_THEMES, themeGarland, themePattern } from "@zhaoyun/domain";
import type { ColorScheme } from "./useColorScheme";

/**
 * What 菜单样式 changes: the accent group `src/styles.css` declares on
 * `:root`, and for a festive set its pattern, the header's band of it, the garland under
 * the categories and the room's glow. An inline
 * custom property on the root element wins the cascade over the
 * stylesheet's own default without touching a single class name, so every
 * component that already reads `var(--accent)` picks the new one up for free
 * the moment the catalogue answers with a style. An everyday style takes the
 * pattern and the glow away again, back to the stylesheet's.
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
    if (theme.festive) {
      root.setProperty("--theme-pattern", themePattern(theme, accent.accent));
      root.setProperty("--theme-band", themePattern(theme, accent.accent, "band"));
      root.setProperty("--theme-garland", themeGarland(theme, accent.accent));
      root.setProperty("--room-glow", accent.accentWash);
    } else {
      root.removeProperty("--theme-pattern");
      root.removeProperty("--theme-band");
      root.removeProperty("--theme-garland");
      root.removeProperty("--room-glow");
    }
    document.documentElement.dataset.menuTheme = theme.id;
    document.documentElement.toggleAttribute("data-festive", Boolean(theme.festive));
  }, [themeId, scheme]);
}

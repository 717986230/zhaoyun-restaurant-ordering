# Fonts

The one web font the guest menu ships with, bundled rather than fetched so the
menu keeps its display type with no signal (the font files are imported by
`src/styles.css`, so Vite hashes them into `/assets` and the service worker
keeps them like the rest of the built assets).

## Cormorant Garamond

`cormorant-garamond-latin.woff2` and `cormorant-garamond-latin-ext.woff2` are
the `latin` and `latin-ext` subsets of Cormorant Garamond, a variable font with
a weight axis of 300–700 (one file per subset covers every weight the menu
asks of it). They set the marquee moments only — the restaurant's name, the
promotions page, dish titles and the booking ticket — through the
`--font-display` token; everything else keeps the system serif. 中文 is not in
these subsets and falls through to the system serif per glyph, as declared in
the `--font-display` fallback stack.

Licensed under the SIL Open Font License 1.1 — see `OFL.txt`.

To refresh them, take the `latin` and `latin-ext` `woff2` from Google Fonts
(`https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300..700`)
and keep the `unicode-range` of each subset in step with the `@font-face`
blocks in `src/styles.css`.

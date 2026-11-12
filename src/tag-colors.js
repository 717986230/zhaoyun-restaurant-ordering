// Distinct, legible tag colours for dish categories, so a waiter tells
// categories apart at a glance on the POS and the guest menu. The colour is
// assigned from the category name, so it is stable across reloads and the same
// category always wears the same colour — no configuration needed.
//
// The palette is a spread of hues that each hold enough contrast on both the
// POS's light cards and the menu's dark cards; none of them is the celadon the
// accent already uses.
export const TAG_COLORS = [
  "#e5484d", // red
  "#e5793a", // orange
  "#c99700", // amber
  "#2f9e44", // green
  "#1098ad", // teal
  "#3b82c4", // blue
  "#7048e8", // indigo
  "#c2255c", // magenta
  "#846358", // taupe
  "#5c7080"  // slate
];

/** A stable colour for a category name, picked from TAG_COLORS. Empty → first. */
export function tagColorFor(category) {
  const key = String(category || "");
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  return TAG_COLORS[hash % TAG_COLORS.length];
}

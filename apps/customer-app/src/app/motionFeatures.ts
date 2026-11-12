// Motion's full animation engine (drag, layout, the spring/keyframes runtime)
// is the heaviest single piece of the menu's first load. `LazyMotion` lets us
// ship only the tiny `m` component up front and pull this feature set in as a
// separate chunk after first paint, so the menu's text and dishes render
// sooner on a phone. `domMax` — not `domAnimation` — because the sheets
// drag to dismiss, and drag lives only in the max feature set.
import { domMax } from "motion/react";

export default domMax;

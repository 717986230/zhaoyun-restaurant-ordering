/**
 * Small motions the menu shares, written to the prompts in docs/motion-prompts.md.
 * Each does nothing when the guest's phone asks for reduced motion.
 */

/** The landing curve every entrance uses: fast off the mark, long soft finish. */
export const EASE_OUT = "cubic-bezier(.2,.7,.2,1)";

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * ④ Fly to cart: a round copy of the dish's picture leaves the "+" just
 * tapped and arcs down into the cart bar — the arc's peak 35% of the distance
 * above the straight line — shrinking to 0.3 and fading to 0.6 in 520 ms; on
 * arrival the cart bar swells to 1.12 and settles back.
 */
export function flyToCart(from: HTMLElement) {
  if (prefersReducedMotion() || typeof document === "undefined") return;
  const start = from.getBoundingClientRect();
  const picture = from.closest(".dish-card")?.querySelector<HTMLImageElement>(".dish-media img");
  const size = 44;
  const ghost = document.createElement("div");
  ghost.className = "fly-ghost";
  ghost.setAttribute("aria-hidden", "true");
  if (picture?.currentSrc || picture?.src) ghost.style.backgroundImage = `url("${picture.currentSrc || picture.src}")`;
  ghost.style.width = ghost.style.height = `${size}px`;
  document.body.appendChild(ghost);

  // The cart bar may only appear with this first dish: aim for where it sits.
  const bar = document.getElementById("cartBar")?.getBoundingClientRect();
  const end = bar ? { x: bar.left + 34, y: bar.top + bar.height / 2 } : { x: window.innerWidth / 2, y: window.innerHeight - 46 };
  const x0 = start.left + start.width / 2 - size / 2;
  const y0 = start.top + start.height / 2 - size / 2;
  const x1 = end.x - size / 2;
  const y1 = end.y - size / 2;
  const lift = Math.hypot(x1 - x0, y1 - y0) * 0.35;
  const cx = (x0 + x1) / 2;
  const cy = Math.min(y0, y1) - lift;
  const steps = 12;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t ** 2 * x1;
    const y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t ** 2 * y1;
    frames.push({ transform: `translate(${x}px, ${y}px) scale(${1 - 0.7 * t})`, opacity: 1 - 0.4 * t, offset: t });
  }
  const flight = ghost.animate(frames, { duration: 520, easing: "cubic-bezier(.3,.6,.2,1)", fill: "forwards" });
  flight.onfinish = () => {
    ghost.remove();
    document.getElementById("cartBar")?.animate(
      [{ transform: "translateX(-50%) scale(1)" }, { transform: "translateX(-50%) scale(1.12)" }, { transform: "translateX(-50%) scale(1)" }],
      { duration: 200, easing: EASE_OUT }
    );
  };
  flight.oncancel = () => ghost.remove();
}

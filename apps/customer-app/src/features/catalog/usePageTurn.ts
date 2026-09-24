import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * Turning the menu's pages by pulling past either end of the list.
 *
 * Each category is a page. Pull up past the last dish and the next category
 * comes; pull down past the first and the previous one does — the same gesture
 * a book or a feed teaches, with a hint under the finger saying which page is
 * coming and when letting go will turn to it.
 *
 * The drag writes straight to the element's style: a React render per touch
 * frame is what makes this kind of gesture stutter on a restaurant tablet.
 * React hears about it once, when the page actually turns.
 *
 * Only a gesture that *starts* at an end turns a page. A fling that runs into
 * the end of the list stops there as it always has; turning the page then
 * takes a second, deliberate pull.
 *
 * Every listener is passive, so the browser scrolls the list on its own,
 * without waiting on this script for each move of the finger — a blocking
 * touchmove made a fast fling stutter and flash. Nothing needs cancelling:
 * past an end there is nothing left to scroll, and the list's
 * `overscroll-behavior: none` keeps the browser's own bounce, glow and
 * pull-to-reload out of the way.
 */
export type TurnDirection = "next" | "prev";

/** How far the list has to be pulled before letting go turns the page. */
export const TURN_THRESHOLD_PX = 64;
const SETTLE = "transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1)";
const WHEEL_TURN = 260;

/** Follows the finger, then resists: the page is not going to be dragged away. */
function resist(distance: number): number {
  const eased = distance * 0.5;
  return eased > 110 ? 110 + (eased - 110) * 0.18 : eased;
}

interface Options {
  scroller: RefObject<HTMLElement | null>;
  sheet: RefObject<HTMLElement | null>;
  canTurn: (direction: TurnDirection) => boolean;
  onTurn: (direction: TurnDirection) => void;
}

export function usePageTurn({ scroller, sheet, canTurn, onTurn }: Options) {
  // The listeners are attached once; these keep them reading the current page.
  const latest = useRef({ canTurn, onTurn });
  latest.current = { canTurn, onTurn };

  useEffect(() => {
    const list = scroller.current;
    const pull = sheet.current;
    if (!list || !pull) return;

    const atTop = () => list.scrollTop <= 1;
    const atBottom = () => list.scrollTop + list.clientHeight >= list.scrollHeight - 2;

    let startX = 0;
    let startY = 0;
    let tracking = false;
    let direction: TurnDirection | null = null;
    let distance = 0;
    let startedAtTop = false;
    let startedAtBottom = false;

    function show(offset: number, armed: boolean) {
      pull!.style.transform = offset ? `translate3d(0, ${offset}px, 0)` : "";
      pull!.style.setProperty("--pull", String(Math.min(Math.abs(offset) / TURN_THRESHOLD_PX, 1)));
      pull!.dataset.pull = direction ?? "";
      pull!.dataset.armed = armed ? "true" : "false";
    }

    function settle() {
      pull!.style.transition = SETTLE;
      show(0, false);
      pull!.dataset.pull = "";
      const done = () => { pull!.style.transition = ""; };
      pull!.addEventListener("transitionend", done, { once: true });
      window.setTimeout(done, 320);
    }

    function start(event: TouchEvent) {
      if (event.touches.length !== 1) { tracking = false; return; }
      const touch = event.touches[0]!;
      startX = touch.clientX;
      startY = touch.clientY;
      startedAtTop = atTop();
      startedAtBottom = atBottom();
      tracking = startedAtTop || startedAtBottom;
      direction = null;
      distance = 0;
    }

    function move(event: TouchEvent) {
      if (!tracking) return;
      const touch = event.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (!direction) {
        if (Math.abs(dy) < 8) return;
        // Sideways is the chip row's, or nobody's.
        if (Math.abs(dx) > Math.abs(dy)) { tracking = false; return; }
        if (dy < 0 && startedAtBottom && latest.current.canTurn("next")) direction = "next";
        else if (dy > 0 && startedAtTop && latest.current.canTurn("prev")) direction = "prev";
        else { tracking = false; return; }
        pull!.style.transition = "";
      }
      const along = direction === "next" ? -dy : dy;
      if (along <= 0) { distance = 0; show(0, false); return; }
      distance = resist(along);
      show(direction === "next" ? -distance : distance, distance >= TURN_THRESHOLD_PX);
    }

    function end() {
      if (!tracking || !direction) { tracking = false; return; }
      const turn = distance >= TURN_THRESHOLD_PX ? direction : null;
      tracking = false;
      direction = null;
      settle();
      if (turn) latest.current.onTurn(turn);
    }

    // A mouse wheel or trackpad has no "letting go", so enough scrolling past
    // an end in one go stands in for the pull.
    let wheelSum = 0;
    let wheelTimer = 0;
    let wheelLockedUntil = 0;
    function wheel(event: WheelEvent) {
      const now = performance.now();
      if (now < wheelLockedUntil) return;
      const turn: TurnDirection | null = event.deltaY > 0 && atBottom() ? "next" : event.deltaY < 0 && atTop() ? "prev" : null;
      if (!turn || !latest.current.canTurn(turn)) { wheelSum = 0; return; }
      wheelSum += Math.abs(event.deltaY);
      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => { wheelSum = 0; }, 350);
      if (wheelSum >= WHEEL_TURN) {
        wheelSum = 0;
        // Trackpad momentum keeps sending wheel events for a while; one turn per swipe.
        wheelLockedUntil = now + 900;
        latest.current.onTurn(turn);
      }
    }

    list.addEventListener("touchstart", start, { passive: true });
    list.addEventListener("touchmove", move, { passive: true });
    list.addEventListener("touchend", end);
    list.addEventListener("touchcancel", end);
    list.addEventListener("wheel", wheel, { passive: true });
    return () => {
      list.removeEventListener("touchstart", start);
      list.removeEventListener("touchmove", move);
      list.removeEventListener("touchend", end);
      list.removeEventListener("touchcancel", end);
      list.removeEventListener("wheel", wheel);
      window.clearTimeout(wheelTimer);
    };
  }, [scroller, sheet]);
}

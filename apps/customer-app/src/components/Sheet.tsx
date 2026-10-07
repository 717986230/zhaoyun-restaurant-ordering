import { useEffect, useRef } from "react";
import { motion, useDragControls, useReducedMotion } from "motion/react";

/** The curve the whole sheet moves on: fast off the mark, long soft landing. */
const EASE = [0.2, 0.7, 0.2, 1] as const;

/**
 * A sheet over the menu: the cart, the guest's account, their orders. A pane
 * of frosted glass — as it opens, the menu behind blurs from sharp to 26px,
 * and the pane floats up from 94% to its full size; its rows then land one
 * after another, 4 frames apart (styles.css), all within a second. The menu
 * stays where it was underneath; a tap on the blurred room, the ×, Escape or
 * pulling the sheet down by its handle closes it.
 */
export function Sheet({ id, title, closeLabel, onClose, children, className = "" }: { id: string; title: string; closeLabel: string; onClose: () => void; children: React.ReactNode; className?: string }) {
  const reduceMotion = useReducedMotion();
  const drag = useDragControls();
  const pane = useRef<HTMLElement>(null);
  useEffect(() => {
    // Escape closes the sheet on top only: a panel opened from inside another (the booking's account) first.
    const onKey = (event: KeyboardEvent) => {
      const sheets = document.querySelectorAll(".sheet");
      if (event.key === "Escape" && sheets[sheets.length - 1] === pane.current) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const blur = (px: number) => ({ backdropFilter: `blur(${px}px)`, WebkitBackdropFilter: `blur(${px}px)` });
  return <motion.div className="sheet-scrim"
    initial={reduceMotion ? { opacity: 0, ...blur(26) } : { opacity: 0, ...blur(0) }}
    animate={{ opacity: 1, ...blur(26), transition: { duration: reduceMotion ? 0 : 0.6, ease: EASE } }}
    exit={{ opacity: 0, ...blur(reduceMotion ? 26 : 0), transition: { duration: reduceMotion ? 0 : 0.24, ease: "easeIn" } }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <motion.section ref={pane} id={id} className={`sheet ${className}`} role="dialog" aria-modal="true" aria-label={title}
      initial={reduceMotion ? false : { opacity: 0, scale: 0.94, y: 28 }}
      animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: reduceMotion ? 0 : 0.6, ease: EASE } }}
      exit={reduceMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.97, y: 18, transition: { duration: 0.22, ease: "easeIn" } }}
      // Pulled down by the handle only: the list inside still scrolls as a list.
      drag={reduceMotion ? false : "y"} dragListener={false} dragControls={drag}
      dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0.04, bottom: 0.6 }}
      onDragEnd={(_, info) => { if (info.offset.y > 110 || info.velocity.y > 600) onClose(); }}>
      <div className="sheet-grip" aria-hidden="true" onPointerDown={(event) => drag.start(event)}><span /></div>
      <header className="sheet-head" onPointerDown={(event) => { if (!(event.target as HTMLElement).closest("button")) drag.start(event); }}>
        <h2>{title}</h2>
        <button type="button" className="sheet-close" aria-label={closeLabel} onClick={onClose}>×</button>
      </header>
      <div className="sheet-body">{children}</div>
    </motion.section>
  </motion.div>;
}

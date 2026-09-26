import { useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";

/**
 * A sheet that rises over the menu from the bottom: the cart, the guest's
 * account, their orders. The menu stays where it was underneath; a tap on
 * the dimmed room, the × or Escape closes it.
 */
export function Sheet({ id, title, closeLabel, onClose, children }: { id: string; title: string; closeLabel: string; onClose: () => void; children: React.ReactNode }) {
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <motion.div className="sheet-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    transition={{ duration: reduceMotion ? 0 : 0.2 }}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <motion.section id={id} className="sheet" role="dialog" aria-modal="true" aria-label={title}
      initial={reduceMotion ? false : { y: "100%" }} animate={{ y: 0 }} exit={reduceMotion ? { opacity: 0 } : { y: "100%" }}
      transition={{ duration: reduceMotion ? 0 : 0.32, ease: [0.2, 0.8, 0.2, 1] }}>
      <header className="sheet-head">
        <h2>{title}</h2>
        <button type="button" className="sheet-close" aria-label={closeLabel} onClick={onClose}>×</button>
      </header>
      <div className="sheet-body">{children}</div>
    </motion.section>
  </motion.div>;
}

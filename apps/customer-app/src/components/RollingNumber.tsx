import { useRef } from "react";

/**
 * ⑦ Number roll: when an amount or a count changes, each digit that changed
 * rolls to its new value like a counter wheel — up when the number grew,
 * down when it fell — 360 ms each, the ones first and every place further
 * left 40 ms later. Signs, separators and the currency stay still, and the
 * digits are tabular so the width never jumps (styles.css, .roll).
 */
export function RollingNumber({ text, value, className }: { text: string; value: number; className?: string }) {
  const previous = useRef({ text, value });
  const turn = useRef(0);
  const before = previous.current;
  const direction = value > before.value ? "up" : value < before.value ? "down" : null;
  if (before.text !== text) turn.current += 1;
  previous.current = { text, value };

  const chars = [...text];
  const old = [...before.text];
  return <span className={`rolling ${className ?? ""}`}>
    {chars.map((char, index) => {
      const fromRight = chars.length - 1 - index;
      const was = old[old.length - 1 - fromRight];
      const changed = direction && /\d/.test(char) && char !== was;
      return changed
        ? <span key={`${fromRight}-${turn.current}`} className={`roll roll-${direction}`} style={{ "--roll-delay": `${fromRight * 40}ms` } as React.CSSProperties}>{char}</span>
        : <span key={`${fromRight}`}>{char}</span>;
    })}
  </span>;
}

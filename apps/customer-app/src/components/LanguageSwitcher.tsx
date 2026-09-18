import type { CustomerDispatch, CustomerState } from "../app/model";

const names = { zh: "中文", de: "Deutsch", en: "English" } as const;

/** A panel header has room for three pills only if they are short. The
 *  accessible name stays the full language either way, so the switcher reads
 *  the same to a screen reader and to anything selecting it by name. */
const abbreviations = { zh: "中", de: "DE", en: "EN" } as const;

export function LanguageSwitcher({ language, dispatch, compact = false }: { language: CustomerState["language"]; dispatch: CustomerDispatch; compact?: boolean }) {
  return <div className={compact ? "langs langs-compact" : "langs"} aria-label="Language selector">{(["zh", "de", "en"] as const).map((value) => <button key={value} className={language === value ? "active" : ""} aria-label={names[value]} aria-pressed={language === value} onClick={() => dispatch({ type: "language", language: value })}>{compact ? abbreviations[value] : names[value]}</button>)}</div>;
}

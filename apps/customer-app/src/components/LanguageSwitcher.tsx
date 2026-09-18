import type { CustomerDispatch, CustomerState } from "../app/model";

const names = { zh: "中文", de: "Deutsch", en: "English" } as const;

export function LanguageSwitcher({ language, dispatch }: { language: CustomerState["language"]; dispatch: CustomerDispatch }) {
  return <div className="langs" aria-label="Language selector">{(["zh", "de", "en"] as const).map((value) => <button key={value} className={language === value ? "active" : ""} aria-label={names[value]} aria-pressed={language === value} onClick={() => dispatch({ type: "language", language: value })}>{names[value]}</button>)}</div>;
}

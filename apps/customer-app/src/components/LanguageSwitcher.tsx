import type { CustomerDispatch, CustomerState } from "../app/model";

export function LanguageSwitcher({ language, dispatch }: { language: CustomerState["language"]; dispatch: CustomerDispatch }) {
  return <div className="langs" aria-label="Language selector">{(["zh", "de", "en"] as const).map((value) => <button key={value} className={language === value ? "active" : ""} aria-pressed={language === value} onClick={() => dispatch({ type: "language", language: value })}>{value === "zh" ? "中文" : value === "de" ? "Deutsch" : "English"}</button>)}</div>;
}

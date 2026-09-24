import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import type { AdminStorage, AuditEntry, RestaurantTable, StaffRole } from "@zhaoyun/api-client";
import type { ApiSettings, ColorScheme, MenuLanguage } from "@zhaoyun/contracts";
import type { Product } from "@zhaoyun/domain";
import { DEFAULT_MENU_LANGUAGES, FEATURED_TEMPLATES, LANGUAGE_INFO, MENU_LANGUAGES, MENU_THEMES, NAV_ALL, NAV_FEATURED, NAV_SETS, orderNavTabs, themeGarland, themePattern } from "@zhaoyun/domain";
import { useI18n } from "../../app/i18n";
import type { AdminLanguage, CopyKey } from "../../app/i18n";
import { TableCards } from "./TableCards";
import { downloadQrCard } from "../qr/qrCard";
import { describeSchedule, ScheduleEditor } from "./ScheduleEditor";

// The time zones on offer: where a restaurant like this one is. A short list
// on purpose — the server takes any real zone, so one saved from elsewhere is
// still shown and kept.
const TIME_ZONES: Array<[string, Record<AdminLanguage, string>]> = [
  ["Europe/Vienna", { zh: "维也纳", en: "Vienna", de: "Wien" }],
  ["Europe/Berlin", { zh: "柏林", en: "Berlin", de: "Berlin" }],
  ["Europe/Zurich", { zh: "苏黎世", en: "Zurich", de: "Zürich" }],
  ["Europe/Rome", { zh: "罗马", en: "Rome", de: "Rom" }],
  ["Europe/Paris", { zh: "巴黎", en: "Paris", de: "Paris" }],
  ["Europe/London", { zh: "伦敦", en: "London", de: "London" }],
  ["Asia/Shanghai", { zh: "北京", en: "Beijing", de: "Peking" }]
];

function timeZoneOptions(saved: string, language: AdminLanguage): Array<[string, string]> {
  const known = TIME_ZONES.map(([zone, names]) => [zone, names[language]] as [string, string]);
  return known.some(([zone]) => zone === saved) || !saved ? known : [[saved, saved.replace(/_/g, " ")], ...known];
}

interface Props {
  storage: AdminStorage;
  settings: ApiSettings | null;
  /** For the promotions card, which lists the chosen dishes by name. */
  products: Product[];
  tables: RestaurantTable[];
  auditEntries: AuditEntry[];
  onSaveSettings: (change: Partial<ApiSettings>, done: CopyKey) => Promise<void>;
  onSaveConnection: (storage: AdminStorage) => Promise<void>;
  onSaveTable: (input: { table: string; label?: string; rotateToken?: boolean }) => Promise<boolean>;
  onDeleteTable: (table: string) => Promise<void>;
  onChangePassword: (password: string, currentPassword: string) => Promise<boolean>;
}

const ROLE_KEYS: Record<StaffRole, CopyKey> = { manager: "roleManager", staff: "roleStaff", kitchen: "roleKitchen" };

function detailSummary(entry: AuditEntry): string {
  const parts = Object.entries(entry.detail)
    .filter(([key, value]) => key !== "params" && value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${String(value)}`);
  return parts.length ? ` · ${parts.join(" ")}` : "";
}

/** The guest menu's address: where this console's API lives, else this site. */
function menuUrl(baseUrl: string): string {
  return `${(baseUrl || window.location.origin).replace(/\/+$/, "")}/`;
}

function entryUrl(baseUrl: string, table: RestaurantTable): string {
  return `${menuUrl(baseUrl)}?table=${encodeURIComponent(table.table)}&k=${encodeURIComponent(table.token)}`;
}

/** One group of settings, as a card with its heading and one line of why. */
const FOLDS_KEY = "zy_admin_folded";

function readFolded(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(FOLDS_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/**
 * A settings card that folds away to its title and a one-line summary of
 * what is set in it. Open until the owner folds it; which cards are folded
 * is remembered on this device, so the page opens the way they left it.
 */
function Section({ title, hint, children, id, wide = false, summary }: { title: string; hint?: string; children: ReactNode; id: string; wide?: boolean; summary?: string }) {
  const [open, setOpen] = useState(() => !readFolded().includes(id));
  function toggle(next: boolean) {
    setOpen(next);
    try {
      const folded = readFolded().filter((item) => item !== id);
      localStorage.setItem(FOLDS_KEY, JSON.stringify(next ? folded : [...folded, id]));
    } catch { /* storage refused: it folds for this visit only */ }
  }
  return <details className={`settings-card settings-section ${wide ? "wide" : ""}`} open={open} onToggle={(event) => { if (event.currentTarget.open !== open) toggle(event.currentTarget.open); }}>
    <summary>
      <h2 id={`${id}-title`}>{title}</h2>
      {summary && <span className="settings-summary">{summary}</span>}
    </summary>
    <div className="settings-body" role="group" aria-labelledby={`${id}-title`}>
      {hint && <p className="settings-hint">{hint}</p>}
      {children}
    </div>
  </details>;
}

/** A switch that saves on change: the setting is on screen the moment it is
 *  flipped, and the console puts it back if the save fails. */
function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (value: boolean) => void }) {
  return <label className="settings-switch">
    <input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span>{label}</span>
  </label>;
}

/**
 * The guest menu's tab order: the first three chosen here, the rest in their
 * usual order behind. A tab chosen for one place is greyed out in the others,
 * and each place opens once the one before it is set, so there is no order
 * that contradicts itself. The preview is the same function the menu uses
 * (orderNavTabs).
 */
/** The places the owner fills, one per chosen tab (NAV_PINNED_MAX of them). */
const NAV_PLACES = ["navFirst", "navSecond", "navThird"] as const;

function NavOrder({ settings, products, onSave }: { settings: ApiSettings; products: Product[]; onSave: (navPinned: string[]) => void }) {
  const { t } = useI18n();
  const label = navLabel(settings, t);
  const hasSets = products.some((product) => product.bundleItems?.length);
  const categories = [...new Set(products.filter((product) => !product.bundleItems?.length).map((product) => product.category))];
  // In the menu's usual order, which is also the order the rest keep.
  const options = [...(settings.featuredEnabled ? [NAV_FEATURED] : []), ...(hasSets ? [NAV_SETS] : []), NAV_ALL, ...categories];
  // A choice whose tab has since gone (an emptied category, a page switched off) is shown as unset.
  const chosen = settings.navPinned.filter((tab) => options.includes(tab)).slice(0, NAV_PLACES.length);
  const places = NAV_PLACES.map((_, index) => chosen[index] ?? "");
  const choose = (position: number, value: string) => {
    const next = [...places];
    next[position] = value;
    onSave(next.filter(Boolean));
  };
  return <div className="nav-order">
    <div className="nav-order-slots">{NAV_PLACES.map((name, position) => <label key={name}>
      <span>{t(name)}</span>
      <select aria-label={t(name)} value={places[position]} disabled={position > 0 && !places[position - 1]} onChange={(event) => choose(position, event.target.value)}>
        <option value="">{t("navDefault")}</option>
        {options.map((tab) => <option key={tab} value={tab} disabled={tab !== places[position] && places.includes(tab)}>{label(tab)}</option>)}
      </select>
    </label>)}</div>
    <p className="settings-label">{t("navPreview")}</p>
    <ol className="nav-order-preview">{orderNavTabs(options, chosen).map((tab) => <li key={tab} className={chosen.includes(tab) ? "set" : ""}>{label(tab)}</li>)}</ol>
  </div>;
}

/** A tab's name as the owner knows it: the promotions page by its title. */
function navLabel(settings: ApiSettings, t: ReturnType<typeof useI18n>["t"]) {
  return (tab: string) => tab === NAV_SETS ? t("navSets")
    : tab === NAV_FEATURED ? `✦ ${settings.featuredTitle || t("navFeatured")}`
    : tab === NAV_ALL ? t("navAll") : tab;
}

/** The promotions page's dishes, in the order a guest sees them. */
function FeaturedList({ ids, products, onChange }: { ids: string[]; products: Product[]; onChange: (ids: string[]) => void }) {
  const { t, language } = useI18n();
  const byId = new Map(products.map((product) => [product.id, product]));
  // A dish deleted since it was chosen is simply not listed, and drops out on the next save.
  const shown = ids.filter((id) => byId.has(id));
  if (!shown.length) return <p className="settings-hint">{t("featuredEmpty")}</p>;
  const move = (index: number, by: number) => {
    const next = [...shown];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    onChange(next);
  };
  return <ol className="featured-list">{shown.map((id, index) => {
    const product = byId.get(id)!;
    return <li key={id}>
      <span className="featured-index">{String(index + 1).padStart(2, "0")}</span>
      <span className="featured-name">{product.names[language] || product.names.zh || product.names.de}{!product.published && <em className="draft-mark">{t("draft")}</em>}</span>
      <span className="featured-actions">
        <button type="button" aria-label={t("moveUp")} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
        <button type="button" aria-label={t("moveDown")} disabled={index === shown.length - 1} onClick={() => move(index, 1)}>↓</button>
        <button type="button" aria-label={t("remove")} onClick={() => onChange(shown.filter((item) => item !== id))}>✕</button>
      </span>
    </li>;
  })}</ol>;
}

export function SettingsPanel(props: Props) {
  const { t, language } = useI18n();
  const [showCards, setShowCards] = useState(false);
  const [passwordNote, setPasswordNote] = useState("");
  const settings = props.settings;

  function saveRestaurant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void props.onSaveSettings({
      restaurantName: String(data.get("restaurantName") || "").trim(),
      menuTitle: String(data.get("menuTitle") || "").trim(),
      timeZone: String(data.get("timeZone") || "")
    }, "restaurantSaved");
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const next = String(data.get("nextPassword") || "");
    // The server never sees the second field, so the typo has to be caught
    // here: a password nobody wrote down is how a restaurant locks itself out.
    if (next !== String(data.get("repeatPassword") || "")) {
      setPasswordNote(t("gateMismatch"));
      return;
    }
    setPasswordNote("");
    if (await props.onChangePassword(next, String(data.get("currentPassword") || ""))) form.reset();
  }

  function saveConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void props.onSaveConnection({ baseUrl: String(data.get("baseUrl")), token: String(data.get("token")) });
  }

  async function addTable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (await props.onSaveTable({ table: String(data.get("table") || ""), label: String(data.get("label") || "") })) form.reset();
  }

  const themeName = (theme: (typeof MENU_THEMES)[keyof typeof MENU_THEMES]) =>
    language === "zh" ? theme.nameZh : language === "de" ? theme.nameDe : theme.nameEn;
  const themeButton = (theme: (typeof MENU_THEMES)[keyof typeof MENU_THEMES]) => <button
    key={theme.id}
    type="button"
    className={`theme-swatch ${settings?.menuTheme === theme.id ? "selected" : ""}`}
    aria-pressed={settings?.menuTheme === theme.id}
    style={{ "--swatch": theme.accent, backgroundImage: themePattern(theme, theme.accent) } as React.CSSProperties}
    onClick={() => void props.onSaveSettings({ menuTheme: theme.id }, "menuStyleSaved")}
  >
    {/* A festive set shows the garland it hangs on the menu, so each is known at a glance. */}
    {theme.festive && <b className="swatch-garland" aria-hidden="true" style={{ backgroundImage: themeGarland(theme, theme.accent) }} />}
    <i /><span>{themeName(theme)}</span>
  </button>;
  const offered = settings?.menuLanguages ?? DEFAULT_MENU_LANGUAGES;

  return <section id="systemPanel" className="admin-panel active"><div className="settings-page">
    <h1 className="settings-title">{t("settingsTitle")}</h1>

    {settings && <div className="settings-grid">
      <Section id="restaurant" title={t("sectionRestaurant")} summary={`${settings.restaurantName} · ${settings.menuTitle}`}>
        {/* Keyed on the saved values so the fields show what the server kept
            (trimmed, spaces collapsed) once a save comes back. */}
        <form key={`${settings.restaurantName}|${settings.menuTitle}|${settings.timeZone}`} className="editor-form" onSubmit={saveRestaurant}>
          <label><span>{t("restaurantName")}</span><input name="restaurantName" required maxLength={40} defaultValue={settings.restaurantName} /><small>{t("restaurantNameHint")}</small></label>
          <label><span>{t("menuTitle")}</span><input name="menuTitle" required maxLength={24} defaultValue={settings.menuTitle} /><small>{t("menuTitleHint")}</small></label>
          <label><span>{t("timeZone")}</span><select name="timeZone" defaultValue={settings.timeZone}>{timeZoneOptions(settings.timeZone, language).map(([zone, name]) => <option key={zone} value={zone}>{name}</option>)}</select><small>{t("timeZoneHint")}</small></label>
          <button className="primary-action" type="submit">{t("save")}</button>
        </form>
      </Section>

      <Section id="appearance" title={t("sectionAppearance")} summary={`${themeName(MENU_THEMES[settings.menuTheme] ?? MENU_THEMES.jade)} · ${t(settings.menuDefaultScheme === "dark" ? "schemeDark" : "schemeLight")}`}>
        <p className="settings-label">{t("menuStyle")}</p>
        <div className="theme-picker">{Object.values(MENU_THEMES).filter((theme) => !theme.festive).map(themeButton)}</div>
        {/* The festive sets: colour and pattern for the season, one tap to put
            on and one to take off again. Each button wears its own pattern. */}
        <p className="settings-label">{t("festiveThemes")}</p>
        <div className="theme-picker festive">{Object.values(MENU_THEMES).filter((theme) => theme.festive).map(themeButton)}</div>
        <small className="settings-hint">{t("festiveThemesHint")}</small>
        <p className="settings-label">{t("defaultScheme")}</p>
        <div className="scheme-picker" role="group" aria-label={t("defaultScheme")}>{(["dark", "light"] as ColorScheme[]).map((scheme) => <button
          key={scheme}
          type="button"
          className={settings.menuDefaultScheme === scheme ? "on" : ""}
          aria-pressed={settings.menuDefaultScheme === scheme}
          onClick={() => void props.onSaveSettings({ menuDefaultScheme: scheme }, "appearanceSaved")}
        >{scheme === "dark" ? "☾" : "☀"} {t(scheme === "dark" ? "schemeDark" : "schemeLight")}</button>)}</div>
        <small className="settings-hint">{t("defaultSchemeHint")}</small>
        <Toggle checked={settings.showTableNumber} label={t("showTableNumber")} onChange={(showTableNumber) => void props.onSaveSettings({ showTableNumber }, "appearanceSaved")} />
      </Section>

      <Section id="languages" title={t("sectionLanguages")} hint={t("languagesHint")} summary={offered.map((option) => LANGUAGE_INFO[option].name).join(" · ")}>
        <div className="language-picker" role="group" aria-label={t("sectionLanguages")}>{MENU_LANGUAGES.map((option) => {
          const on = offered.includes(option);
          // The last one cannot be switched off: a menu has to be in something.
          const last = on && offered.length === 1;
          const next: MenuLanguage[] = on ? offered.filter((item) => item !== option) : [...offered, option];
          return <button
            key={option}
            type="button"
            className={`language-toggle ${on ? "selected" : ""}`}
            aria-pressed={on}
            disabled={last}
            title={last ? t("keepOneLanguage") : undefined}
            onClick={() => void props.onSaveSettings({ menuLanguages: next }, "languagesSaved")}
          ><img src={LANGUAGE_INFO[option].flag} alt="" /><span>{LANGUAGE_INFO[option].name}</span></button>;
        })}</div>
      </Section>

      {/* The biggest card: across the page, what the page is on the left and
          how it looks and what is on it on the right. */}
      <Section id="nav" title={t("sectionNav")} hint={t("navHint")} summary={settings.navPinned.length ? settings.navPinned.map(navLabel(settings, t)).join(" · ") : t("navDefault")}>
        <NavOrder settings={settings} products={props.products} onSave={(navPinned) => void props.onSaveSettings({ navPinned }, "navSaved")} />
      </Section>

      <Section id="featured" title={t("sectionFeatured")} hint={t("featuredHint")} wide summary={settings.featuredEnabled
        ? [t("foldOn"), FEATURED_TEMPLATES.find((template) => template.id === settings.featuredTemplate)?.names[language], t("dishCount", { count: settings.featuredProductIds.length }), settings.featuredSchedule ? describeSchedule(settings.featuredSchedule, t, language) : ""].filter(Boolean).join(" · ")
        : t("foldOff")}>
        <div className="featured-settings">
          <div>
            <Toggle checked={settings.featuredEnabled} label={t("featuredEnable")} onChange={(featuredEnabled) => void props.onSaveSettings({ featuredEnabled }, "featuredSaved")} />
            <form key={settings.featuredTitle} className="editor-form" onSubmit={(event) => {
              event.preventDefault();
              void props.onSaveSettings({ featuredTitle: String(new FormData(event.currentTarget).get("featuredTitle") || "") }, "featuredSaved");
            }}>
              <label><span>{t("featuredTitleLabel")}</span><input name="featuredTitle" maxLength={32} defaultValue={settings.featuredTitle} placeholder={t("featuredTitlePlaceholder")} /></label>
              <button className="ghost-action" type="submit">{t("save")}</button>
            </form>
            <p className="settings-label">{t("pageHours")}</p>
            <ScheduleEditor key={JSON.stringify(settings.featuredSchedule)} value={settings.featuredSchedule} timeZone={settings.timeZone} onSave={(featuredSchedule) => props.onSaveSettings({ featuredSchedule }, "featuredSaved")} />
          </div>
          <div>
            <p className="settings-label">{t("featuredTemplateLabel")}</p>
            {/* Each sketch is drawn by CSS from the same id the menu uses, so the
                picker and the page cannot describe different designs. */}
            <div className="template-picker" role="radiogroup" aria-label={t("featuredTemplateLabel")}>{FEATURED_TEMPLATES.map((template) => <button
              key={template.id}
              type="button"
              role="radio"
              aria-checked={settings.featuredTemplate === template.id}
              className={settings.featuredTemplate === template.id ? "on" : ""}
              onClick={() => void props.onSaveSettings({ featuredTemplate: template.id }, "featuredSaved")}
            >
              <span className="template-thumb" data-template={template.id} aria-hidden="true"><i /><i /><i /><i /></span>
              <b>{template.names[language]}</b>
              <small>{template.hints[language]}</small>
            </button>)}</div>
            <p className="settings-label">{t("featuredDishes")}</p>
            <FeaturedList ids={settings.featuredProductIds} products={props.products} onChange={(featuredProductIds) => void props.onSaveSettings({ featuredProductIds }, "featuredSaved")} />
          </div>
        </div>
      </Section>

      <Section id="sets" title={t("sectionSets")} hint={t("setsHint")} summary={settings.setsSchedule ? describeSchedule(settings.setsSchedule, t, language) : t("alwaysShown")}>
        <p className="settings-label">{t("pageHours")}</p>
        <ScheduleEditor key={JSON.stringify(settings.setsSchedule)} value={settings.setsSchedule} timeZone={settings.timeZone} onSave={(setsSchedule) => props.onSaveSettings({ setsSchedule }, "setsSaved")} />
      </Section>

      <Section id="modules" title={t("sectionModules")} hint={t("modulesHint")} summary={t(settings.showOrdering ? "foldOn" : "foldOff")}>
        <Toggle checked={settings.showOrdering} label={t("showOrdering")} onChange={(showOrdering) => void props.onSaveSettings({ showOrdering }, "appearanceSaved")} />
      </Section>
    </div>}

    <div className="settings-grid">
      <Section id="tables" title={t("sectionTables")} hint={t("tablesHint")} summary={t("tableCount", { count: props.tables.length })}>
        <form className="editor-form" onSubmit={(event) => void addTable(event)}>
          <div className="field-grid">
            <label><span>{t("tableNumber")}</span><input name="table" required maxLength={8} placeholder="12 / T-3" /></label>
            <label><span>{t("tableNote")}</span><input name="label" maxLength={64} placeholder={t("tableNotePlaceholder")} /></label>
          </div>
          <button className="primary-action" type="submit">{t("registerTable")}</button>
        </form>
        {/* The menu's own code, with no table in it: for the door, a flyer, social media. */}
        <div className="qr-actions">
          <button className="primary-action" type="button" onClick={() => void downloadQrCard({ url: menuUrl(props.storage.baseUrl), restaurantName: settings?.restaurantName ?? "", menuLanguages: offered })}>⬇ {t("downloadMenuQr")}</button>
          {props.tables.length > 0 && <button className="ghost-action settings-cards-button" onClick={() => setShowCards(true)}>{t("printCards")}</button>}
        </div>
        {showCards && <TableCards
          tables={props.tables}
          restaurantName={settings?.restaurantName ?? ""}
          menuLanguages={offered}
          entryUrl={(table) => entryUrl(props.storage.baseUrl, table)}
          onClose={() => setShowCards(false)}
        />}
        <div className="table-list">{props.tables.length ? props.tables.map((table) => <div className="table-row" key={table.table}>
          <div><b>{t("table", { table: table.table })}</b>{table.label && <small> · {table.label}</small>}<code>{entryUrl(props.storage.baseUrl, table)}</code></div>
          <div className="table-row-actions">
            <button className="ghost-action" onClick={() => void downloadQrCard({ url: entryUrl(props.storage.baseUrl, table), restaurantName: settings?.restaurantName ?? "", menuLanguages: offered, table: table.table, label: table.label })}>⬇ {t("qrShort")}</button>
            <button className="ghost-action" onClick={() => void props.onSaveTable({ table: table.table, label: table.label, rotateToken: true })}>{t("rotateToken")}</button>
            <button className="ghost-action" onClick={() => void props.onDeleteTable(table.table)}>{t("delete")}</button>
          </div>
        </div>) : <div className="admin-empty">{t("noTables")}</div>}</div>
      </Section>

      <Section id="password" title={t("sectionPassword")} hint={t("passwordHint")}>
        <form className="editor-form" onSubmit={(event) => void changePassword(event)}>
          <label><span>{t("currentPassword")}</span><input name="currentPassword" required type="password" autoComplete="current-password" /></label>
          <label><span>{t("newPassword")}</span><input name="nextPassword" required minLength={6} type="password" autoComplete="new-password" /></label>
          <label><span>{t("gateRepeat")}</span><input name="repeatPassword" required minLength={6} type="password" autoComplete="new-password" /></label>
          {passwordNote && <p className="gate-note error" role="alert">{passwordNote}</p>}
          <button className="primary-action" type="submit">{t("changePassword")}</button>
        </form>
      </Section>
    </div>

    <details className="settings-card settings-fold">
      <summary>{t("sectionAudit")}</summary>
      <p className="settings-hint">{t("auditHint")}</p>
      <div className="audit-list">{props.auditEntries.length ? props.auditEntries.map((entry) => <div className={`audit-row ${entry.status >= 400 ? "denied" : ""}`} key={entry.id}>
        <span className="audit-role">{ROLE_KEYS[entry.role] ? t(ROLE_KEYS[entry.role]) : entry.role}</span>
        <span className="audit-what"><b>{entry.method} {entry.route}</b><small>{new Date(entry.at).toLocaleString(language === "zh" ? "zh-CN" : language === "de" ? "de-AT" : "en-GB")} · {entry.ip} · {entry.status}{detailSummary(entry)}</small></span>
      </div>) : <div className="admin-empty">{t("auditEmpty")}</div>}</div>
    </details>

    {/* Open by itself only when the console could not reach its backend —
        then the address is the thing to fix. */}
    <details className="settings-card settings-fold" open={!settings}>
      <summary>{t("sectionConnection")}</summary>
      <p className="settings-hint">{t("connectionHint")}</p>
      <form id="connectionForm" className="editor-form" onSubmit={saveConnection}>
        <label><span>{t("apiAddress")}</span><input name="baseUrl" required defaultValue={props.storage.baseUrl} placeholder="https://…" /></label>
        <label><span>{t("adminToken")}</span><input name="token" type="password" defaultValue={props.storage.token} autoComplete="off" /></label>
        <button className="primary-action" type="submit">{t("saveConnection")}</button>
      </form>
    </details>
  </div></section>;
}

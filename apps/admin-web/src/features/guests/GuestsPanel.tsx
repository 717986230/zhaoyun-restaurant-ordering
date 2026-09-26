import { useCallback, useEffect, useState } from "react";
import type { AdminApi, CustomerDetail } from "@zhaoyun/api-client";
import type { ApiCustomer, ApiGuestOrdering, ApiLoyalty, ApiSchedule, ApiSettings, PointsReason } from "@zhaoyun/contracts";
import type { Product } from "@zhaoyun/domain";
import { formatTime, useI18n } from "../../app/i18n";
import type { CopyKey } from "../../app/i18n";
import { Section, Toggle } from "../settings/SettingsPanel";
import { describeSchedule } from "../settings/ScheduleEditor";

interface Props {
  api: AdminApi;
  settings: ApiSettings | null;
  products: Product[];
  notify: (message: string) => void;
  failed: (error: unknown) => void;
  onSaveSettings: (change: Partial<ApiSettings>, done: CopyKey) => Promise<void> | void;
}

const DAYS = [1, 2, 3, 4, 5, 6, 7];

/**
 * The guests' side, kept by the manager: whether and when they may order from
 * the menu and within which limits (shared/ordering.mjs), their accounts,
 * the points programme and its rewards (shared/customer.mjs), and the guests
 * themselves — found by email, their points changed with a reason, a
 * forgotten password set anew, an account removed on request.
 */
export function GuestsPanel({ api, settings, products, notify, failed, onSaveSettings }: Props) {
  const { t } = useI18n();
  if (!settings) return null;
  return <section id="guestsPanel" className="admin-panel active"><div className="settings-page">
    <h1 className="settings-title">{t("guestsTitle")}</h1>
    <div className="settings-grid">
      <Section id="guest-ordering" title={t("sectionOrdering")} hint={t("orderingHint")} summary={t(settings.guestOrdering.enabled ? "orderingOn" : "orderingOff")} wide>
        <OrderingForm key={JSON.stringify(settings.guestOrdering)} ordering={settings.guestOrdering} timeZone={settings.timeZone} onSave={(guestOrdering) => onSaveSettings({ guestOrdering }, "orderingSaved")} />
      </Section>
      <Section id="guest-accounts" title={t("sectionGuestAccounts")} hint={t("guestAccountsHint")} summary={t(settings.customerAccounts ? "orderingOn" : "orderingOff")}>
        <Toggle checked={settings.customerAccounts} label={t("guestAccountsOn")} onChange={(customerAccounts) => void onSaveSettings({ customerAccounts }, "orderingSaved")} />
      </Section>
      <Section id="guest-loyalty" title={t("sectionLoyalty")} hint={t("loyaltyHint")} summary={t(settings.loyalty.enabled ? "orderingOn" : "orderingOff")}>
        <LoyaltyForm key={JSON.stringify(settings.loyalty)} loyalty={settings.loyalty} products={products} onSave={(loyalty) => onSaveSettings({ loyalty }, "loyaltySaved")} />
      </Section>
      <Section id="guest-list" title={t("sectionCustomers")} wide>
        <CustomerList api={api} notify={notify} failed={failed} />
      </Section>
    </div>
  </div></section>;
}

/** Numbers and switches edited together and saved whole: the server keeps the object as sent. */
function OrderingForm({ ordering, timeZone, onSave }: { ordering: ApiGuestOrdering; timeZone: string; onSave: (value: ApiGuestOrdering) => Promise<void> | void }) {
  const { t, language } = useI18n();
  const [draft, setDraft] = useState(ordering);
  const set = <K extends keyof ApiGuestOrdering>(key: K, value: ApiGuestOrdering[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const number = (key: "maxItems" | "minIntervalSeconds" | "tableSessionHours" | "maxOpenPickups", label: CopyKey, min: number, max: number) =>
    <label><span>{t(label)}</span><input type="number" name={key} min={min} max={max} step={1} inputMode="numeric" value={draft[key]} onChange={(event) => set(key, Number(event.target.value))} /></label>;
  const changed = JSON.stringify(draft) !== JSON.stringify(ordering);
  // The switch saves at once, with the rest as it is on screen.
  const flip = (enabled: boolean) => { setDraft({ ...draft, enabled }); void onSave({ ...draft, enabled }); };

  return <form className="editor-form guest-ordering" onSubmit={(event) => { event.preventDefault(); void onSave(draft); }}>
    <Toggle checked={draft.enabled} label={t("orderingEnabled")} onChange={flip} />
    <Toggle checked={draft.dineIn} label={t("orderingDineIn")} onChange={(value) => set("dineIn", value)} />
    <Toggle checked={draft.requireOpenTable} label={t("orderingRequireOpen")} onChange={(value) => set("requireOpenTable", value)} />
    <Toggle checked={draft.pickup} label={t("orderingPickup")} onChange={(value) => set("pickup", value)} />
    <div className="field-grid">
      {number("maxItems", "orderingMaxItems", 1, 200)}
      <label><span>{t("orderingMaxAmount")}</span><input type="number" name="maxOrderEuro" min={1} max={10000} step={1} inputMode="numeric" value={draft.maxOrderCents / 100} onChange={(event) => set("maxOrderCents", Math.round(Number(event.target.value) * 100))} /></label>
      {number("minIntervalSeconds", "orderingInterval", 0, 3600)}
      {number("tableSessionHours", "orderingSessionHours", 1, 24)}
      {number("maxOpenPickups", "orderingMaxPickups", 1, 20)}
    </div>
    <p className="settings-label">{t("orderingHours")}</p>
    <ul className="hours-list">{draft.hours.map((schedule, index) => <li key={index}>
      <HoursRow value={schedule} onChange={(next) => set("hours", draft.hours.map((item, at) => (at === index ? next : item)))} />
      <span className="settings-hint">{describeSchedule(schedule, t, language)}</span>
      <button type="button" className="ghost-action" aria-label={t("remove")} onClick={() => set("hours", draft.hours.filter((_, at) => at !== index))}>✕</button>
    </li>)}</ul>
    {draft.hours.length < 7 && <button type="button" className="ghost-action" onClick={() => set("hours", [...draft.hours, { days: [1, 2, 3, 4, 5, 6, 7], from: "11:00", to: "22:00" }])}>{t("orderingAddHours")}</button>}
    <small className="settings-hint">{t("timeZone")}: {timeZone}</small>
    <button className="primary-action" type="submit" disabled={!changed}>{t("save")}</button>
  </form>;
}

function HoursRow({ value, onChange }: { value: ApiSchedule; onChange: (value: ApiSchedule) => void }) {
  const { language } = useI18n();
  const labels = language === "zh" ? ["一", "二", "三", "四", "五", "六", "日"] : language === "de" ? ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] : ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  const toggle = (day: number) => {
    const days = value.days.includes(day) ? value.days.filter((item) => item !== day) : [...value.days, day].sort((a, b) => a - b);
    if (days.length) onChange({ ...value, days });
  };
  return <div className="hours-row">
    <div className="schedule-days" role="group">{DAYS.map((day) => <button key={day} type="button" className={value.days.includes(day) ? "on" : ""} aria-pressed={value.days.includes(day)} onClick={() => toggle(day)}>{labels[day - 1]}</button>)}</div>
    <input type="time" step={60} required value={value.from} onChange={(event) => onChange({ ...value, from: event.target.value })} />
    <span>–</span>
    <input type="time" step={60} required value={value.to} onChange={(event) => onChange({ ...value, to: event.target.value })} />
  </div>;
}

function LoyaltyForm({ loyalty, products, onSave }: { loyalty: ApiLoyalty; products: Product[]; onSave: (value: ApiLoyalty) => Promise<void> | void }) {
  const { t, language } = useI18n();
  const [draft, setDraft] = useState(loyalty);
  const [pick, setPick] = useState("");
  const byId = new Map(products.map((product) => [product.id, product]));
  const name = (id: string) => { const product = byId.get(id); return product ? `${product.sku} · ${product.names[language] || product.names.zh || product.names.de}` : id; };
  const changed = JSON.stringify(draft) !== JSON.stringify(loyalty);
  const available = products.filter((product) => product.published && !draft.rewards.some((reward) => reward.productId === product.id));

  return <form className="editor-form" onSubmit={(event) => { event.preventDefault(); void onSave(draft); }}>
    <Toggle checked={draft.enabled} label={t("loyaltyEnabled")} onChange={(enabled) => { setDraft({ ...draft, enabled }); void onSave({ ...draft, enabled }); }} />
    <div className="field-grid">
      <label><span>{t("loyaltyPerEuro")}</span><input type="number" name="pointsPerEuro" min={0} max={100} step={1} value={draft.pointsPerEuro} onChange={(event) => setDraft({ ...draft, pointsPerEuro: Number(event.target.value) })} /></label>
      <label><span>{t("loyaltyMaxRewards")}</span><input type="number" name="maxRewardsPerOrder" min={1} max={10} step={1} value={draft.maxRewardsPerOrder} onChange={(event) => setDraft({ ...draft, maxRewardsPerOrder: Number(event.target.value) })} /></label>
    </div>
    <p className="settings-label">{t("loyaltyRewards")}</p>
    <ul className="reward-rows">{draft.rewards.map((reward) => <li key={reward.productId}>
      <span>{name(reward.productId)}</span>
      <input type="number" min={1} max={100000} step={1} aria-label={t("loyaltyPoints")} value={reward.points}
        onChange={(event) => setDraft({ ...draft, rewards: draft.rewards.map((item) => (item.productId === reward.productId ? { ...item, points: Number(event.target.value) } : item)) })} />
      <small>{t("loyaltyPoints")}</small>
      <button type="button" className="ghost-action" aria-label={t("remove")} onClick={() => setDraft({ ...draft, rewards: draft.rewards.filter((item) => item.productId !== reward.productId) })}>✕</button>
    </li>)}</ul>
    {draft.rewards.length < 30 && <div className="reward-add">
      <select value={pick} aria-label={t("loyaltyPick")} onChange={(event) => setPick(event.target.value)}>
        <option value="">{t("loyaltyPick")}</option>
        {available.map((product) => <option key={product.id} value={product.id}>{name(product.id)}</option>)}
      </select>
      <button type="button" className="ghost-action" disabled={!pick} onClick={() => {
        const product = byId.get(pick);
        setDraft({ ...draft, rewards: [...draft.rewards, { productId: pick, points: Math.max(1, Math.round((product?.priceCents ?? 1000) / 100) * 10) }] });
        setPick("");
      }}>{t("loyaltyAdd")}</button>
    </div>}
    <button className="primary-action" type="submit" disabled={!changed}>{t("save")}</button>
  </form>;
}

const REASONS: Record<PointsReason, CopyKey> = { earn: "pointsEarn", reverse: "pointsReverse", redeem: "pointsRedeem", refund: "pointsRefund", adjust: "pointsAdjust" };

function CustomerList({ api, notify, failed }: { api: AdminApi; notify: (message: string) => void; failed: (error: unknown) => void }) {
  const { t, language } = useI18n();
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [open, setOpen] = useState<CustomerDetail | null>(null);

  const load = useCallback(async (text: string) => {
    try { setCustomers((await api.customers(text)).customers); } catch (error) { failed(error); }
  }, [api, failed]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(query), 250);
    return () => window.clearTimeout(timer);
  }, [load, query]);

  async function show(customer: ApiCustomer) {
    if (open?.customer.id === customer.id) { setOpen(null); return; }
    try { setOpen(await api.customer(customer.id)); } catch (error) { failed(error); }
  }
  async function act(customer: ApiCustomer, action: () => Promise<unknown>, done: CopyKey) {
    try {
      await action();
      notify(t(done));
      await load(query);
      setOpen(open?.customer.id === customer.id ? await api.customer(customer.id).catch(() => null) : open);
    } catch (error) { failed(error); }
  }
  function adjust(customer: ApiCustomer) {
    const delta = Number(window.prompt(t("adjustPrompt", { email: customer.email }))?.trim());
    if (!Number.isInteger(delta) || !delta) return;
    const note = window.prompt(t("adjustNotePrompt"))?.trim();
    if (note) void act(customer, () => api.adjustPoints(customer.id, delta, note), "pointsAdjusted");
  }
  function reset(customer: ApiCustomer) {
    const password = window.prompt(t("resetCustomerPrompt", { email: customer.email }));
    if (password && password.length >= 6) void act(customer, () => api.resetCustomerPassword(customer.id, password), "customerPasswordReset");
  }
  function remove(customer: ApiCustomer) {
    if (window.confirm(t("deleteCustomerConfirm", { email: customer.email }))) void act(customer, () => api.deleteCustomer(customer.id), "customerDeleted");
  }

  return <div className="customer-list">
    <input type="search" className="customer-search" placeholder={t("customersSearch")} value={query} onChange={(event) => setQuery(event.target.value)} />
    {!customers.length ? <p className="settings-hint">{t("customersEmpty")}</p> : <ul className="staff-list">{customers.map((customer) => <li key={customer.id} data-customer={customer.email}>
      <button type="button" className="customer-name" onClick={() => void show(customer)}><b>{customer.email}</b>{customer.name && <small>{customer.name}</small>}</button>
      <span className="customer-points">{customer.points} ★</span>
      <span className="staff-actions">
        <button type="button" className="ghost-action" onClick={() => adjust(customer)}>{t("adjustPoints")}</button>
        <button type="button" className="ghost-action" onClick={() => reset(customer)}>{t("resetCustomerPassword")}</button>
        <button type="button" className="ghost-action danger" onClick={() => remove(customer)}>{t("deleteCustomer")}</button>
      </span>
      {open?.customer.id === customer.id && <div className="customer-history">
        <small>{t("customerSince", { date: new Date(customer.createdAt).toLocaleDateString(language) })} · {t("customerHistory")}</small>
        <ul>{open.points.map((entry) => <li key={entry.id}>
          <span>{formatTime(entry.createdAt, language)}</span><span>{t(REASONS[entry.reason])}{entry.note ? ` · ${entry.note}` : ""}</span><b>{entry.delta > 0 ? `+${entry.delta}` : entry.delta}</b>
        </li>)}</ul>
      </div>}
    </li>)}</ul>}
  </div>;
}

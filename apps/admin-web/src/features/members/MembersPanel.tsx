import { useCallback, useEffect, useState } from "react";
import type { AdminApi, CustomerDetail } from "@zhaoyun/api-client";
import type { ApiBirthdayPerk, ApiCustomer, ApiMemberReport, ApiMembership, ApiMemberTiers, ApiSettings, BalanceReason } from "@zhaoyun/contracts";
import { formatMoney, formatTime, useI18n } from "../../app/i18n";
import type { CopyKey } from "../../app/i18n";
import { Section, Toggle } from "../settings/SettingsPanel";

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
type StatPreset = "today" | "week" | "month";
const STAT_PRESETS: Array<[StatPreset, CopyKey]> = [["today", "reportToday"], ["week", "reportWeek"], ["month", "reportMonth"]];

/** The restaurant's today, and a preset's day range, in its own time zone. */
function statRange(preset: StatPreset, timeZone: string): [string, string] {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const at = Date.parse(`${today}T00:00:00Z`);
  if (preset === "today") return [today, today];
  if (preset === "week") return [isoDay(at - 6 * DAY_MS), today];
  return [`${today.slice(0, 8)}01`, today];
}

interface Props {
  api: AdminApi;
  settings: ApiSettings | null;
  notify: (message: string) => void;
  failed: (error: unknown) => void;
  onSaveSettings: (change: Partial<ApiSettings>, done: CopyKey) => Promise<void> | void;
}

const BALANCE_REASONS: Record<BalanceReason, CopyKey> = { topup: "balanceTopup", bonus: "balanceBonus", spend: "balanceSpend", refund: "balanceRefund", adjust: "balanceAdjust", reverse: "balanceReverse" };

/**
 * 会员储值的管理页，自成一个菜单，方便店员快速打开：上面是储值开关与
 * 赠送档位，下面按手机号 / 邮箱找会员，看余额与储值流水，经理按手改余额
 * （退款 / 更正）。充值本身是收银台的现金 / 刷卡操作，不在这里。
 */
export function MembersPanel({ api, settings, notify, failed, onSaveSettings }: Props) {
  const { t } = useI18n();
  if (!settings) return null;
  return <section id="membersPanel" className="admin-panel active"><div className="settings-page">
    <h1 className="settings-title">{t("tabMembers")}</h1>
    <div className="settings-grid">
      <Section id="member-stats" title={t("memberStatsTitle")} summary={t("memberStatsHint")} wide>
        <MemberStats api={api} timeZone={settings.timeZone} failed={failed} />
      </Section>
      <Section id="member-settings" title={t("sectionMembership")} summary={t(settings.membership.enabled ? "orderingOn" : "orderingOff")}>
        <MembershipForm key={JSON.stringify(settings.membership)} membership={settings.membership} onSave={(membership) => onSaveSettings({ membership }, "membershipSaved")} />
      </Section>
      <Section id="member-tiers" title={t("sectionMemberTiers")} summary={t(settings.memberTiers.enabled ? "orderingOn" : "orderingOff")}>
        <MemberTiersForm key={JSON.stringify(settings.memberTiers)} memberTiers={settings.memberTiers} onSave={(memberTiers) => onSaveSettings({ memberTiers }, "memberTiersSaved")} />
      </Section>
      <Section id="member-birthday" title={t("sectionBirthdayPerk")} summary={t(settings.birthdayPerk.enabled ? "orderingOn" : "orderingOff")}>
        <BirthdayPerkForm key={JSON.stringify(settings.birthdayPerk)} perk={settings.birthdayPerk} onSave={(birthdayPerk) => onSaveSettings({ birthdayPerk }, "birthdayPerkSaved")} />
      </Section>
      <Section id="member-list" title={t("membersListTitle")} wide>
        <MemberList api={api} notify={notify} failed={failed} />
      </Section>
    </div>
  </div></section>;
}

/**
 * 会员概况: a read-only dashboard over a day range — how many members, how much
 * balance and points are outstanding, what moved over the days, the repeat
 * rate, and the top members. Never writes; it only reads /api/admin/reports/members.
 */
function MemberStats({ api, timeZone, failed }: { api: AdminApi; timeZone: string; failed: (error: unknown) => void }) {
  const { t, language } = useI18n();
  const [preset, setPreset] = useState<StatPreset>("month");
  const [report, setReport] = useState<ApiMemberReport | null>(null);
  const [busy, setBusy] = useState(false);
  const money = (cents: number) => formatMoney(cents, language);

  useEffect(() => {
    let live = true;
    const [from, to] = statRange(preset, timeZone);
    setBusy(true);
    api.memberReport(from, to).then((result) => { if (live) setReport(result.report); }).catch((error) => { if (live) failed(error); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [api, preset, timeZone, failed]);

  const named = (row: { name: string; email: string }) => row.name || row.email || t("statMember");
  return <div className="member-stats">
    <div className="report-presets" role="group" aria-label={t("memberStatsTitle")}>
      {STAT_PRESETS.map(([key, label]) => <button key={key} type="button" className={preset === key ? "primary-action" : "ghost-action"} aria-pressed={preset === key} onClick={() => setPreset(key)}>{t(label)}</button>)}
    </div>
    {report && <>
      <div className="report-tiles">
        <div className="report-tile"><small>{t("statMembersTotal")}</small><b>{report.members.total}</b></div>
        <div className="report-tile"><small>{t("statMembersNew")}</small><b>{report.members.new}</b></div>
        <div className="report-tile"><small>{t("statMembersActive")}</small><b>{report.members.active}</b></div>
        <div className="report-tile"><small>{t("statRepeatRate")}</small><b title={t("statRepeatHint")}>{report.repeat.ratePct}%</b></div>
        <div className="report-tile"><small>{t("statBalanceOutstanding")}</small><b>{money(report.balance.outstandingCents)}</b></div>
        {report.balance.topUpCents !== 0 && <div className="report-tile"><small>{t("statBalanceTopUp")}</small><b>{money(report.balance.topUpCents)}</b></div>}
        {report.balance.bonusCents !== 0 && <div className="report-tile"><small>{t("statBalanceBonus")}</small><b>{money(report.balance.bonusCents)}</b></div>}
        {report.balance.spentCents !== 0 && <div className="report-tile"><small>{t("statBalanceSpent")}</small><b>{money(report.balance.spentCents)}</b></div>}
        <div className="report-tile"><small>{t("statPointsOutstanding")}</small><b>{report.points.outstanding}</b></div>
        {report.points.earned !== 0 && <div className="report-tile"><small>{t("statPointsEarned")}</small><b>{report.points.earned}</b></div>}
        {report.points.redeemed !== 0 && <div className="report-tile"><small>{t("statPointsRedeemed")}</small><b>{report.points.redeemed}</b></div>}
      </div>
      {report.members.total === 0 ? <div className="admin-empty">{t("statNoMembers")}</div> : <div className="report-grid">
        {report.topBalance.length > 0 && <section className="report-card">
          <h2>{t("statTopBalance")}</h2>
          <table className="report-table">
            <thead><tr><th>#</th><th>{t("statMember")}</th><th>{t("statBalanceOutstanding")}</th></tr></thead>
            <tbody>{report.topBalance.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td>{named(row)}</td><td>{money(row.balanceCents)}</td></tr>)}</tbody>
          </table>
        </section>}
        {report.topPoints.length > 0 && <section className="report-card">
          <h2>{t("statTopPoints")}</h2>
          <table className="report-table">
            <thead><tr><th>#</th><th>{t("statMember")}</th><th>{t("statPointsOutstanding")}</th></tr></thead>
            <tbody>{report.topPoints.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td>{named(row)}</td><td>{row.points}</td></tr>)}</tbody>
          </table>
        </section>}
      </div>}
    </>}
    {!report && busy && <div className="admin-empty">…</div>}
  </div>;
}

/**
 * 生日营销：会员生日月享一个结账折扣，与会员等级折扣取较大者，走收银台整单折扣。
 * 会员只填月/日（不含年份），由顾客在账户里自行填写。
 */
function BirthdayPerkForm({ perk, onSave }: { perk: ApiBirthdayPerk; onSave: (value: ApiBirthdayPerk) => Promise<void> | void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(perk);
  const changed = JSON.stringify(draft) !== JSON.stringify(perk);
  return <form className="editor-form" onSubmit={(event) => { event.preventDefault(); void onSave(draft); }}>
    <Toggle checked={draft.enabled} label={t("birthdayPerkEnabled")} onChange={(enabled) => { setDraft({ ...draft, enabled }); void onSave({ ...draft, enabled }); }} />
    <p className="settings-hint">{t("birthdayPerkHint")}</p>
    <label><span>{t("birthdayPerkDiscount")}</span><input type="number" min={0} max={100} step={1} value={draft.discountPercent} onChange={(event) => setDraft({ ...draft, discountPercent: Math.max(0, Math.min(100, Math.round(Number(event.target.value) || 0))) })} /></label>
    <button className="primary-action" type="submit" disabled={!changed}>{t("save")}</button>
  </form>;
}

/**
 * 会员等级 + 会员价：按累计充值升级，每级给一个结账折扣（会员价）。折扣走收银
 * 台原有的整单折扣，税务记录不变；等级由累计充值派生，不另记。
 */
function MemberTiersForm({ memberTiers, onSave }: { memberTiers: ApiMemberTiers; onSave: (value: ApiMemberTiers) => Promise<void> | void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(memberTiers);
  const changed = JSON.stringify(draft) !== JSON.stringify(memberTiers);
  const setTier = (index: number, key: "name" | "thresholdCents" | "discountPercent", value: string | number) =>
    setDraft((current) => ({ ...current, tiers: current.tiers.map((tier, at) => (at === index ? { ...tier, [key]: value } : tier)) }));

  return <form className="editor-form" onSubmit={(event) => { event.preventDefault(); void onSave(draft); }}>
    <Toggle checked={draft.enabled} label={t("memberTiersEnabled")} onChange={(enabled) => { setDraft({ ...draft, enabled }); void onSave({ ...draft, enabled }); }} />
    <p className="settings-label">{t("memberTiersListLabel")}</p>
    <p className="settings-hint">{t("memberTiersHint")}</p>
    <ul className="reward-rows">{draft.tiers.map((tier, index) => <li key={index}>
      <label><span>{t("memberTierName")}</span><input type="text" maxLength={40} value={tier.name} onChange={(event) => setTier(index, "name", event.target.value)} /></label>
      <label><span>{t("memberTierThreshold")}</span><input type="number" min={0} max={1000} step={1} value={tier.thresholdCents / 100} onChange={(event) => setTier(index, "thresholdCents", Math.round(Number(event.target.value) * 100))} /></label>
      <label><span>{t("memberTierDiscount")}</span><input type="number" min={0} max={100} step={1} value={tier.discountPercent} onChange={(event) => setTier(index, "discountPercent", Math.max(0, Math.min(100, Math.round(Number(event.target.value) || 0))))} /></label>
      <button type="button" className="ghost-action" aria-label={t("remove")} onClick={() => setDraft({ ...draft, tiers: draft.tiers.filter((_, at) => at !== index) })}>✕</button>
    </li>)}</ul>
    {draft.tiers.length < 8 && <button type="button" className="ghost-action" onClick={() => setDraft({ ...draft, tiers: [...draft.tiers, { name: "", thresholdCents: 10000, discountPercent: 5 }] })}>{t("memberTierAdd")}</button>}
    <button className="primary-action" type="submit" disabled={!changed}>{t("save")}</button>
  </form>;
}

/** 会员储值赠送档位：充 X 送 Y，由服务端排序并取不超过充值额的最高一档。 */
function MembershipForm({ membership, onSave }: { membership: ApiMembership; onSave: (value: ApiMembership) => Promise<void> | void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(membership);
  const changed = JSON.stringify(draft) !== JSON.stringify(membership);
  const setTier = (index: number, key: "thresholdCents" | "bonusCents", cents: number) =>
    setDraft((current) => ({ ...current, tiers: current.tiers.map((tier, at) => (at === index ? { ...tier, [key]: cents } : tier)) }));

  return <form className="editor-form" onSubmit={(event) => { event.preventDefault(); void onSave(draft); }}>
    <Toggle checked={draft.enabled} label={t("membershipEnabled")} onChange={(enabled) => { setDraft({ ...draft, enabled }); void onSave({ ...draft, enabled }); }} />
    <p className="settings-label">{t("membershipTiers")}</p>
    <p className="settings-hint">{t("membershipTiersHint")}</p>
    <ul className="reward-rows">{draft.tiers.map((tier, index) => <li key={index}>
      <label><span>{t("membershipThreshold")}</span><input type="number" min={1} max={1000} step={1} value={tier.thresholdCents / 100} onChange={(event) => setTier(index, "thresholdCents", Math.round(Number(event.target.value) * 100))} /></label>
      <label><span>{t("membershipBonus")}</span><input type="number" min={0} max={1000} step={1} value={tier.bonusCents / 100} onChange={(event) => setTier(index, "bonusCents", Math.round(Number(event.target.value) * 100))} /></label>
      <button type="button" className="ghost-action" aria-label={t("remove")} onClick={() => setDraft({ ...draft, tiers: draft.tiers.filter((_, at) => at !== index) })}>✕</button>
    </li>)}</ul>
    {draft.tiers.length < 20 && <button type="button" className="ghost-action" onClick={() => setDraft({ ...draft, tiers: [...draft.tiers, { thresholdCents: 10000, bonusCents: 1000 }] })}>{t("membershipAddTier")}</button>}
    <button className="primary-action" type="submit" disabled={!changed}>{t("save")}</button>
  </form>;
}

function MemberList({ api, notify, failed }: { api: AdminApi; notify: (message: string) => void; failed: (error: unknown) => void }) {
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
  /** 会员储值: the manager adds to or takes from a member's balance by hand (euros, + or −), with a note. */
  async function adjustBalance(customer: ApiCustomer) {
    const amount = Number(window.prompt(t("adjustBalancePrompt", { email: customer.email }))?.trim().replace(",", "."));
    if (!Number.isFinite(amount) || !amount) return;
    const note = window.prompt(t("adjustNotePrompt"))?.trim();
    if (!note) return;
    try {
      await api.adjustBalance(customer.id, amount, note);
      notify(t("balanceAdjusted"));
      await load(query);
      if (open?.customer.id === customer.id) setOpen(await api.customer(customer.id).catch(() => null));
    } catch (error) { failed(error); }
  }

  return <div className="customer-list">
    <input type="search" className="customer-search" placeholder={t("membersSearch")} value={query} onChange={(event) => setQuery(event.target.value)} />
    {!customers.length ? <p className="settings-hint">{t("customersEmpty")}</p> : <ul className="staff-list">{customers.map((customer) => <li key={customer.id} data-customer={customer.email}>
      <button type="button" className="customer-name" onClick={() => void show(customer)}><b>{customer.email}</b>{customer.name && <small>{customer.name}</small>}</button>
      <span className="customer-points">{formatMoney(customer.balanceCents ?? 0, language)}</span>
      <span className="staff-actions">
        <button type="button" className="ghost-action" onClick={() => void adjustBalance(customer)}>{t("adjustBalance")}</button>
      </span>
      {open?.customer.id === customer.id && <div className="customer-history">
        {open.customer.membership?.tier && <small className="member-tier-line">{t("memberTierLabel", { tier: open.customer.membership.tier })}{open.customer.membership.discountPercent > 0 ? ` · ${t("memberPriceOff", { percent: String(open.customer.membership.discountPercent) })}` : ""} · {t("memberGrowthLabel", { amount: formatMoney(open.customer.membership.growthCents, language) })}</small>}
        {open.customer.membership?.birthday && <small className="member-tier-line">{t("memberBirthdayLabel", { date: `${open.customer.membership.birthday.month}/${open.customer.membership.birthday.day}` })}{open.customer.membership.birthdayMonth ? " 🎂" : ""}</small>}
        <small>{t("balanceHistory", { amount: formatMoney(open.customer.balanceCents ?? 0, language) })}</small>
        {open.balance.length === 0 ? <p className="settings-hint">{t("membersNoLedger")}</p> : <ul>{open.balance.map((entry) => <li key={entry.id}>
          <span>{formatTime(entry.createdAt, language)}</span><span>{t(BALANCE_REASONS[entry.reason])}{entry.note ? ` · ${entry.note}` : ""}</span><b>{entry.deltaCents > 0 ? `+${formatMoney(entry.deltaCents, language)}` : formatMoney(entry.deltaCents, language)}</b>
        </li>)}</ul>}
      </div>}
    </li>)}</ul>}
  </div>;
}

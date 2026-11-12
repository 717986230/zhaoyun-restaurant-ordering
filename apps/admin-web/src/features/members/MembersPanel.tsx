import { useCallback, useEffect, useState } from "react";
import type { AdminApi, CustomerDetail } from "@zhaoyun/api-client";
import type { ApiCustomer, ApiMembership, ApiSettings, BalanceReason } from "@zhaoyun/contracts";
import { formatMoney, formatTime, useI18n } from "../../app/i18n";
import type { CopyKey } from "../../app/i18n";
import { Section, Toggle } from "../settings/SettingsPanel";

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
      <Section id="member-settings" title={t("sectionMembership")} summary={t(settings.membership.enabled ? "orderingOn" : "orderingOff")}>
        <MembershipForm key={JSON.stringify(settings.membership)} membership={settings.membership} onSave={(membership) => onSaveSettings({ membership }, "membershipSaved")} />
      </Section>
      <Section id="member-list" title={t("membersListTitle")} wide>
        <MemberList api={api} notify={notify} failed={failed} />
      </Section>
    </div>
  </div></section>;
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
        <small>{t("balanceHistory", { amount: formatMoney(open.customer.balanceCents ?? 0, language) })}</small>
        {open.balance.length === 0 ? <p className="settings-hint">{t("membersNoLedger")}</p> : <ul>{open.balance.map((entry) => <li key={entry.id}>
          <span>{formatTime(entry.createdAt, language)}</span><span>{t(BALANCE_REASONS[entry.reason])}{entry.note ? ` · ${entry.note}` : ""}</span><b>{entry.deltaCents > 0 ? `+${formatMoney(entry.deltaCents, language)}` : formatMoney(entry.deltaCents, language)}</b>
        </li>)}</ul>}
      </div>}
    </li>)}</ul>}
  </div>;
}

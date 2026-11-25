import { useCallback, useEffect, useState } from "react";
import type { AdminApi } from "@zhaoyun/api-client";
import type { ApiBroadcast, ApiBroadcastPreview, ApiSegment } from "@zhaoyun/contracts";
import { useI18n } from "../../app/i18n";

interface Props {
  api: AdminApi;
  /** 会员等级 names the owner has set, for the tier filter. */
  tierNames: string[];
  notify: (message: string) => void;
  failed: (error: unknown) => void;
}

interface Draft {
  subject: string;
  body: string;
  tiers: string[];
  minPoints: number;
  minBalanceEur: number;
  minLifetimeEur: number;
  birthdayThisMonth: boolean;
  joinedWithinDays: number;
  inactiveDays: number;
}

const blankDraft: Draft = {
  subject: "", body: "", tiers: [], minPoints: 0, minBalanceEur: 0,
  minLifetimeEur: 0, birthdayThisMonth: false, joinedWithinDays: 0, inactiveDays: 0,
};

function num(value: string): number {
  return Math.max(0, Number(value) || 0);
}

/** The segment the draft describes: only the conditions that were set. */
function buildSegment(draft: Draft): ApiSegment {
  const segment: ApiSegment = {};
  if (draft.tiers.length) segment.tiers = draft.tiers;
  if (draft.minPoints > 0) segment.minPoints = Math.round(draft.minPoints);
  if (draft.minBalanceEur > 0) segment.minBalanceCents = Math.round(draft.minBalanceEur * 100);
  if (draft.minLifetimeEur > 0) segment.minLifetimeCents = Math.round(draft.minLifetimeEur * 100);
  if (draft.birthdayThisMonth) segment.birthdayThisMonth = true;
  if (draft.joinedWithinDays > 0) segment.joinedWithinDays = Math.round(draft.joinedWithinDays);
  if (draft.inactiveDays > 0) segment.inactiveDays = Math.round(draft.inactiveDays);
  return segment;
}

export function BroadcastsPanel({ api, tierNames, notify, failed }: Props) {
  const { t, language } = useI18n();
  const [broadcasts, setBroadcasts] = useState<ApiBroadcast[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<Draft>({ ...blankDraft });
  const [preview, setPreview] = useState<ApiBroadcastPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const { broadcasts: list } = await api.broadcasts(); setBroadcasts(list); }
    catch (error) { failed(error); }
    finally { setLoaded(true); }
  }, [api, failed]);
  useEffect(() => { void load(); }, [load]);

  const patch = (change: Partial<Draft>) => { setDraft((current) => ({ ...current, ...change })); setPreview(null); };

  async function runPreview() {
    setBusy(true);
    try { setPreview(await api.previewSegment(buildSegment(draft))); }
    catch (error) { failed(error); } finally { setBusy(false); }
  }

  async function send() {
    const subject = draft.subject.trim();
    const body = draft.body.trim();
    if (!subject || !body) { notify(t("castNeedText")); return; }
    const reachable = preview?.reachable ?? 0;
    if (typeof window !== "undefined" && !window.confirm(t("castSendConfirm", { n: reachable }))) return;
    setBusy(true);
    try {
      const { broadcast } = await api.createBroadcast({ subject, body, segment: buildSegment(draft) });
      const sent = await api.sendBroadcast(broadcast.id);
      setDraft({ ...blankDraft });
      setPreview(null);
      await load();
      notify(t("castSent", { n: sent.broadcast.sent }));
    } catch (error) { failed(error); } finally { setBusy(false); }
  }

  async function remove(broadcast: ApiBroadcast) {
    if (typeof window !== "undefined" && !window.confirm(t("castDeleteConfirm", { subject: broadcast.subject }))) return;
    setBusy(true);
    try { await api.deleteBroadcast(broadcast.id); await load(); notify(t("castDeleted")); }
    catch (error) { failed(error); } finally { setBusy(false); }
  }

  const dateFormat = new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : language === "de" ? "de-AT" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
  const whenSent = (iso: string | null) => (iso ? dateFormat.format(new Date(iso)) : "");

  return <section id="castPanel" className="admin-panel active"><div className="settings-page">
    <div className="list-head">
      <h1 className="settings-title">{t("castTitle")}</h1>
      <p className="settings-hint">{t("castHint")}</p>
    </div>

    <div className="cast-compose">
      <label className="cast-field"><span>{t("castSubject")}</span>
        <input value={draft.subject} maxLength={150} onChange={(event) => patch({ subject: event.target.value })} placeholder={t("castSubjectHint")} />
      </label>
      <label className="cast-field"><span>{t("castBody")}</span>
        <textarea value={draft.body} maxLength={5000} rows={6} onChange={(event) => patch({ body: event.target.value })} placeholder={t("castBodyHint")} />
      </label>

      <fieldset className="cast-segment">
        <legend>{t("castSegment")}</legend>
        <p className="settings-hint">{t("castSegmentHint")}</p>
        {tierNames.length > 0 && <div className="cast-tiers"><span>{t("castTiers")}</span>
          <div className="cast-tier-chips">{tierNames.map((name) => <button type="button" key={name}
            className={`cast-chip${draft.tiers.includes(name) ? " on" : ""}`}
            onClick={() => patch({ tiers: draft.tiers.includes(name) ? draft.tiers.filter((n) => n !== name) : [...draft.tiers, name] })}>{name}</button>)}</div>
        </div>}
        <div className="cast-conditions">
          <label><span>{t("castMinPoints")}</span><input type="number" min={0} inputMode="numeric" value={draft.minPoints || ""} onChange={(event) => patch({ minPoints: num(event.target.value) })} /></label>
          <label><span>{t("castMinBalance")}</span><input type="number" min={0} inputMode="decimal" value={draft.minBalanceEur || ""} onChange={(event) => patch({ minBalanceEur: num(event.target.value) })} /></label>
          <label><span>{t("castMinLifetime")}</span><input type="number" min={0} inputMode="decimal" value={draft.minLifetimeEur || ""} onChange={(event) => patch({ minLifetimeEur: num(event.target.value) })} /></label>
          <label><span>{t("castJoinedWithin")}</span><input type="number" min={0} inputMode="numeric" value={draft.joinedWithinDays || ""} onChange={(event) => patch({ joinedWithinDays: num(event.target.value) })} /></label>
          <label><span>{t("castInactive")}</span><input type="number" min={0} inputMode="numeric" value={draft.inactiveDays || ""} onChange={(event) => patch({ inactiveDays: num(event.target.value) })} /></label>
          <label className="cast-check"><input type="checkbox" checked={draft.birthdayThisMonth} onChange={(event) => patch({ birthdayThisMonth: event.target.checked })} /><span>{t("castBirthday")}</span></label>
        </div>
      </fieldset>

      <div className="cast-actions">
        <button type="button" className="ghost-action" disabled={busy} onClick={() => void runPreview()}>{t("castPreview")}</button>
        <button type="button" className="primary-action" disabled={busy || !draft.subject.trim() || !draft.body.trim()} onClick={() => void send()}>{t("castSend")}</button>
      </div>
      {preview && <p className="cast-preview-note" role="status">{t("castPreviewNote", { total: preview.total, reachable: preview.reachable })}{preview.sample.length ? ` · ${preview.sample.join("、")}${preview.reachable > preview.sample.length ? "…" : ""}` : ""}</p>}
      <p className="settings-hint cast-consent-note">{t("castConsentNote")}</p>
    </div>

    <h2 className="cast-history-title">{t("castHistory")}</h2>
    {!loaded ? null : !broadcasts.length ? <div className="admin-empty">{t("castNone")}</div> : <div className="res-table-wrap"><table className="report-table cast-table">
      <thead><tr><th>{t("castColSubject")}</th><th>{t("castColStatus")}</th><th>{t("castColReach")}</th><th>{t("castColSent")}</th><th aria-label={t("castColActions")}></th></tr></thead>
      <tbody>{broadcasts.map((broadcast) => <tr key={broadcast.id} data-status={broadcast.status}>
        <td><b>{broadcast.subject}</b></td>
        <td><span className={`cast-pill cast-${broadcast.status}`}>{t(broadcast.status === "sent" ? "castStatusSent" : broadcast.status === "sending" ? "castStatusSending" : "castStatusDraft")}</span></td>
        <td>{broadcast.status === "sent" ? `${broadcast.sent} / ${broadcast.audience}` : "—"}</td>
        <td className="cast-when">{whenSent(broadcast.sentAt)}</td>
        <td className="cast-row-actions">{broadcast.status !== "sent" && <button type="button" className="ghost-action cast-del" disabled={busy} onClick={() => void remove(broadcast)}>{t("castDelete")}</button>}</td>
      </tr>)}</tbody>
    </table></div>}
  </div></section>;
}

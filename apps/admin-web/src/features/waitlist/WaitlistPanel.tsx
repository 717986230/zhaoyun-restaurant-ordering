import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { AdminApi } from "@zhaoyun/api-client";
import type { ApiWaitlist, ApiWaitlistEntry, WaitlistStatus } from "@zhaoyun/contracts";
import { useI18n } from "../../app/i18n";
import type { CopyKey } from "../../app/i18n";

interface Props {
  api: AdminApi;
  notify: (message: string, kind?: "success" | "warning" | "error") => void;
  failed: (error: unknown) => void;
  /** Changes on the floor, live: the queue reloads when it moves. */
  liveTick: number;
}

/** What can happen next to a party, as the floor sees it. */
function nextSteps(status: WaitlistStatus): Array<[WaitlistStatus, CopyKey, string]> {
  if (status === "waiting") return [["notified", "wlNotify", "primary-action"], ["seated", "wlSeat", "ghost-action"], ["left", "wlLeave", "ghost-action"]];
  if (status === "notified") return [["seated", "wlSeat", "primary-action"], ["left", "wlLeave", "ghost-action"]];
  return [];
}

/**
 * The walk-in waitlist: parties taken at the door when the room is full, in
 * the order they arrived. Notify one when a table frees up (and, if they left
 * an email, they are told their table is ready), then seat them or mark them
 * gone. The floor's, so a staff PIN is enough.
 */
export function WaitlistPanel({ api, notify, failed, liveTick }: Props) {
  const { t } = useI18n();
  const [list, setList] = useState<ApiWaitlist | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await api.waitlist());
    } catch (error) { failed(error); }
  }, [api, failed]);

  useEffect(() => { void load(); }, [load, liveTick]);
  // The net under the live channel.
  useEffect(() => {
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function change(entry: ApiWaitlistEntry, status: WaitlistStatus) {
    setBusy(true);
    try {
      await api.updateWaitlistEntry(entry.id, { status });
      if (status === "notified") notify(t("wlNotifiedToast", { name: entry.name }));
      await load();
    } catch (error) { failed(error); } finally { setBusy(false); }
  }

  async function remove(entry: ApiWaitlistEntry) {
    setBusy(true);
    try {
      await api.deleteWaitlistEntry(entry.id);
      notify(t("wlRemoved"));
      await load();
    } catch (error) { failed(error); } finally { setBusy(false); }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? "").trim();
    setBusy(true);
    try {
      const { entry } = await api.addToWaitlist({
        name: text("name"), party: Number(text("party")),
        ...(text("phone") ? { phone: text("phone") } : {}),
        ...(text("email") ? { email: text("email") } : {}),
        ...(text("notes") ? { notes: text("notes") } : {})
      });
      notify(t("wlAdded", { name: entry.name }));
      form.reset();
      await load();
    } catch (error) { failed(error); } finally { setBusy(false); }
  }

  const entries = list?.entries ?? [];

  return <section id="waitlistPanel" className="admin-panel active"><div className="settings-page">
    <div className="list-head">
      <div>
        <h1>{t("tabWaitlist")}</h1>
        <p className="res-summary">{t("wlHint")}</p>
      </div>
    </div>

    {list && <p className="res-summary"><span>{t("wlCounts", { waiting: list.waiting, notified: list.notified })}</span></p>}

    {!entries.length ? <div className="admin-empty">{t("wlEmpty")}</div> : <div className="res-list">
      {entries.map((entry) => <article key={entry.id} className="res-row" data-status={entry.status}>
        <div className="res-when"><b>{t("wlPosition", { position: entry.position ?? "" })}</b>{entry.waitedMinutes !== null && <small>{t("wlWaited", { minutes: entry.waitedMinutes })}</small>}</div>
        <div className="res-who">
          <strong>{entry.name || "—"} <span className="res-party">· {entry.party} 👤</span></strong>
          <span className="res-contact">
            {entry.phone && <a href={`tel:${entry.phone.replace(/[^+\d]/g, "")}`}>{entry.phone}</a>}
            {entry.email && <a href={`mailto:${entry.email}`}>{entry.email}</a>}
          </span>
          {entry.notes && <em className="res-notes">{entry.notes}</em>}
        </div>
        <div className="res-state">
          <span className={`res-pill res-pill-${entry.status}`}>{t(entry.status === "notified" ? "wlStatusNotified" : "wlStatusWaiting")}</span>
        </div>
        <div className="res-actions">
          {nextSteps(entry.status).map(([status, label, className]) => <button key={status} type="button" className={className} data-action={status} disabled={busy} onClick={() => void change(entry, status)}>{t(label)}</button>)}
          <button type="button" className="ghost-action danger" disabled={busy} onClick={() => void remove(entry)}>{t("wlRemove")}</button>
        </div>
      </article>)}
    </div>}

    <details className="settings-card settings-section res-new" open={!entries.length}>
      <summary><h2>{t("wlAdd")}</h2></summary>
      <form className="editor-form settings-body" id="wlNewForm" onSubmit={(event) => void add(event)}>
        <div className="field-grid">
          <label><span>{t("wlName")}</span><input name="name" required maxLength={80} /></label>
          <label><span>{t("wlParty")}</span><input name="party" type="number" min={1} max={500} required defaultValue={2} /></label>
        </div>
        <div className="field-grid">
          <label><span>{t("wlPhone")}</span><input name="phone" type="tel" maxLength={30} /></label>
          <label><span>{t("wlEmail")}</span><input name="email" type="email" maxLength={254} /></label>
        </div>
        <label><span>{t("wlNotes")}</span><input name="notes" maxLength={500} /></label>
        <button type="submit" className="primary-action" disabled={busy}>{t("wlAdd")}</button>
      </form>
    </details>
  </div></section>;
}

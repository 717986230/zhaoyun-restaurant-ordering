import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { AdminApi } from "@zhaoyun/api-client";
import type { PosDevice, PosStaff } from "@zhaoyun/contracts";
import { formatTime, useI18n } from "../../app/i18n";

/**
 * The POS's people and devices, kept by the manager: each waiter with a PIN
 * of their own (switched off rather than deleted, so their receipts keep a
 * name), and the tablets and phones paired to the POS, which can be unpaired
 * when one is lost.
 */
export function StaffCard({ api, notify, failed }: { api: AdminApi; notify: (message: string) => void; failed: (error: unknown) => void }) {
  const { t, language } = useI18n();
  const [staff, setStaff] = useState<PosStaff[]>([]);
  const [devices, setDevices] = useState<PosDevice[]>([]);

  const load = useCallback(async () => {
    try {
      setStaff((await api.staffList()).staff);
      setDevices((await api.posDevices()).devices);
    } catch (error) { failed(error); }
  }, [api, failed]);
  useEffect(() => { void load(); }, [load]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const { staff: added } = await api.saveStaff({ name: String(data.get("name") || "").trim(), pin: String(data.get("pin") || ""), role: data.get("role") === "manager" ? "manager" : "staff" });
      notify(t("staffAdded", { name: added.name }));
      form.reset();
      await load();
    } catch (error) { failed(error); }
  }
  async function save(person: PosStaff, change: { pin?: string; active?: boolean; role?: PosStaff["role"] }) {
    try {
      await api.saveStaff(change, person.id);
      notify(t("staffSaved"));
      await load();
    } catch (error) { failed(error); }
  }
  async function unpair(device: PosDevice) {
    if (!window.confirm(t("unpairConfirm", { name: device.name }))) return;
    try {
      await api.unpairDevice(device.id);
      await load();
    } catch (error) { failed(error); }
  }

  return <div className="staff-card">
    <a className="ghost-action staff-open-pos" href="pos.html" target="_blank" rel="noopener">{t("openPos")} ↗</a>
    {staff.length ? <ul className="staff-list">{staff.map((person) => <li key={person.id} data-staff={person.name} className={person.active ? "" : "inactive"}>
      <b>{person.name}</b>
      <select aria-label={t("staffRole")} value={person.role} onChange={(event) => void save(person, { role: event.target.value === "manager" ? "manager" : "staff" })}>
        <option value="staff">{t("roleWaiter")}</option>
        <option value="manager">{t("roleManagerShort")}</option>
      </select>
      <span className="staff-actions">
        <button type="button" className="ghost-action" onClick={() => { const pin = window.prompt(t("newPin", { name: person.name }))?.trim(); if (pin) void save(person, { pin }); }}>{t("changePin")}</button>
        <button type="button" className="ghost-action" onClick={() => void save(person, { active: !person.active })}>{t(person.active ? "deactivate" : "activate")}</button>
      </span>
      {!person.active && <em>{t("staffInactive")}</em>}
    </li>)}</ul> : <p className="settings-hint">{t("noStaffYet")}</p>}

    <form className="staff-add" onSubmit={add}>
      <label><span>{t("staffName")}</span><input name="name" required maxLength={32} /></label>
      <label><span>{t("staffPin")}</span><input name="pin" required inputMode="numeric" pattern="[0-9]{4,6}" maxLength={6} autoComplete="off" /></label>
      <label><span>{t("staffRole")}</span><select name="role" defaultValue="staff"><option value="staff">{t("roleWaiter")}</option><option value="manager">{t("roleManagerShort")}</option></select></label>
      <button type="submit" className="primary-action">{t("addStaff")}</button>
    </form>

    <p className="settings-label">{t("posDevices")}</p>
    {devices.length ? <ul className="staff-list">{devices.map((device) => <li key={device.id}>
      <b>{device.name}</b>
      <small>{device.lastSeenAt ? t("lastSeen", { time: formatTime(device.lastSeenAt, language) }) : ""}</small>
      <button type="button" className="ghost-action" onClick={() => void unpair(device)}>{t("unpairDevice")}</button>
    </li>)}</ul> : <p className="settings-hint">{t("noDevices")}</p>}
  </div>;
}

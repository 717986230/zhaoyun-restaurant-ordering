import type { FormEvent } from "react";
import type { DiscoveredPrinter, PrinterProfile, PrinterLanguage, PrinterEncoding } from "@zhaoyun/domain";
import { useI18n } from "../../app/i18n";
import { STATION_KEYS } from "../board/BoardPanel";

interface Props {
  printers: PrinterProfile[];
  discovered: DiscoveredPrinter[];
  editing: PrinterProfile | null;
  /** Searching for printers and test prints go through the Android shell;
   *  in a browser there is nothing to press them into. */
  native: boolean;
  onEdit: (printer: PrinterProfile | null) => void;
  onDiscover: () => Promise<void>;
  onSave: (printer: Omit<PrinterProfile, "id">, id: string | null) => Promise<void>;
  onTest: (printer: PrinterProfile) => Promise<void>;
}

export function PrintersPanel(props: Props) {
  const { t } = useI18n();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await props.onSave({
      name: String(data.get("name") || ""),
      transport: String(data.get("transport")) as PrinterProfile["transport"],
      role: String(data.get("role")) as PrinterProfile["role"],
      address: String(data.get("address") || ""),
      port: Number(data.get("port")) || null,
      enabled: data.get("enabled") === "on",
      capabilities: {
        printLanguage: String(data.get("printLanguage")) as PrinterLanguage,
        encoding: String(data.get("encoding")) as PrinterEncoding
      }
    }, props.editing?.id || null);
  }

  const printer = props.editing;
  const stations = (["kitchen", "bar", "sushi", "front"] as const);
  return <section id="printersPanel" className="admin-panel active">
    <div className="printer-toolbar">
      <div><h1>{t("printersTitle")}</h1><p>{t("printersLead")}</p></div>
      {props.native && <button className="discover-action" onClick={() => void props.onDiscover()}>⌕ {t("printersDiscover")}</button>}
    </div>
    {props.discovered.length > 0 && <section className="discovered"><h2>{t("printersFound")}</h2><div className="discovered-grid">{props.discovered.map((device) => <div className="discovered-row" key={`${device.transport}-${device.address}`}><span className="printer-icon">▣</span><span><b>{device.name}</b><small>{device.transport.toUpperCase()} · {device.address}{device.port ? `:${device.port}` : ""}</small></span><button onClick={() => props.onEdit({ id: "", name: device.name, transport: device.transport, address: device.address, port: device.port ?? (device.transport === "lan" ? 9100 : null), role: device.transport === "lan" ? "kitchen" : "front", enabled: true })}>{t("printersPick")}</button></div>)}</div></section>}
    <div className="printer-layout">
      <div className="printer-list">{props.printers.length ? props.printers.map((row) => <div key={row.id}>
        <button className="printer-row" onClick={() => props.onEdit(row)}><span className="printer-icon">▣</span><span><b>{row.name}</b><small>{row.transport.toUpperCase()} · {row.address}:{row.port ?? ""}</small></span><em>{t(STATION_KEYS[row.role])}</em><i className={row.enabled ? "live" : ""} /></button>
        {props.native && <button className="test-printer" onClick={() => void props.onTest(row)}>{t("printerTest")}</button>}
      </div>) : <div className="admin-empty">{t("printersEmpty")}</div>}</div>
      <aside><form key={printer?.id || `${printer?.transport}-${printer?.address}` || "new"} id="printerForm" className="editor-form compact-form" onSubmit={(event) => void submit(event)}>
        <div className="form-title"><div><h2>{printer?.id ? t("printerEdit") : t("printerAdd")}</h2></div></div>
        <label><span>{t("printerName")}</span><input name="name" required defaultValue={printer?.name ?? ""} placeholder={t("printerNamePlaceholder")} /></label>
        <div className="field-grid">
          <label><span>{t("printerTransport")}</span><select name="transport" defaultValue={printer?.transport ?? "lan"}><option value="lan">{t("transportLan")}</option><option value="bluetooth">{t("transportBluetooth")}</option><option value="usb">{t("transportUsb")}</option></select></label>
          <label><span>{t("printerStation")}</span><select name="role" defaultValue={printer?.role ?? "kitchen"}>{stations.map((station) => <option key={station} value={station}>{t(STATION_KEYS[station])}</option>)}</select></label>
        </div>
        <div className="field-grid">
          <label><span>{t("printerAddress")}</span><input name="address" required defaultValue={printer?.address ?? ""} placeholder="192.168.1.88" /></label>
          <label><span>{t("printerPort")}</span><input name="port" type="number" defaultValue={printer?.port ?? 9100} /></label>
        </div>
        <div className="field-grid">
          <label><span>{t("printerLanguage")}</span><select name="printLanguage" defaultValue={printer?.capabilities?.printLanguage ?? "zh"}><option value="zh">中文</option><option value="de">Deutsch</option><option value="en">English</option></select></label>
          <label><span>{t("printerEncoding")}</span><select name="encoding" defaultValue={printer?.capabilities?.encoding ?? "utf8"}><option value="utf8">{t("encodingUtf8")}</option><option value="gb18030">{t("encodingGb18030")}</option><option value="shift_jis">{t("encodingShiftJis")}</option><option value="cp437">{t("encodingCp437")}</option></select></label>
        </div>
        <label className="checkline"><input type="checkbox" name="enabled" defaultChecked={printer?.enabled ?? true} /><span>{t("printerEnabled")}</span></label>
        <button className="primary-action" type="submit">{printer?.id ? t("printerSave") : t("printerAdd")}</button>
      </form></aside>
    </div>
  </section>;
}

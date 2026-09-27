import { useState, type FormEvent } from "react";
import type { ApiPrintBridge, ApiPrintQueue } from "@zhaoyun/contracts";
import type { DiscoveredPrinter, PrinterProfile, PrinterLanguage, PrinterEncoding } from "@zhaoyun/domain";
import { useI18n } from "../../app/i18n";
import { STATION_KEYS } from "../board/BoardPanel";

interface Props {
  printers: PrinterProfile[];
  bridges: ApiPrintBridge[];
  queue: ApiPrintQueue | null;
  /** Where the bridge reaches the API: the address this console talks to. */
  apiBase: string;
  discovered: DiscoveredPrinter[];
  editing: PrinterProfile | null;
  /** Searching for printers and printing straight from this device go
   *  through the Android shell; in a browser there is nothing to press them into. */
  native: boolean;
  onEdit: (printer: PrinterProfile | null) => void;
  onDiscover: () => Promise<void>;
  onSave: (printer: Omit<PrinterProfile, "id">, id: string | null) => Promise<void>;
  /** A test page from this device (Android). */
  onTest: (printer: PrinterProfile) => Promise<void>;
  /** A test page through the print bridge. */
  onTestRemote: (printer: PrinterProfile) => Promise<void>;
  onPairBridge: () => Promise<string | null>;
}

/** A bridge not heard from for this long is gone, and so is what it said about the printers. */
const STALE_MS = 3 * 60_000;
const LANGUAGES: Array<[PrinterLanguage, string]> = [["zh", "中文"], ["de", "Deutsch"], ["en", "English"]];

export function PrintersPanel(props: Props) {
  const { t } = useI18n();
  const [pairing, setPairing] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const ago = (iso: string) => {
    const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
    if (minutes < 1) return t("agoNow");
    if (minutes < 120) return t("agoMinutes", { n: minutes });
    return t("agoHours", { n: Math.floor(minutes / 60) });
  };
  const fresh = (iso: string | undefined) => Boolean(iso) && Date.now() - Date.parse(iso!) < STALE_MS;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const second = String(data.get("secondLanguage") || "");
    const backup = String(data.get("backupPrinterId") || "");
    await props.onSave({
      name: String(data.get("name") || ""),
      transport: String(data.get("transport")) as PrinterProfile["transport"],
      role: String(data.get("role")) as PrinterProfile["role"],
      address: String(data.get("address") || ""),
      port: Number(data.get("port")) || null,
      enabled: data.get("enabled") === "on",
      capabilities: {
        // Whatever the device reported about itself stays.
        ...(props.editing?.capabilities ?? {}),
        printLanguage: String(data.get("printLanguage")) as PrinterLanguage,
        secondLanguage: second ? second as PrinterLanguage : null,
        encoding: String(data.get("encoding")) as PrinterEncoding,
        paperWidth: Number(data.get("paperWidth")) === 80 ? 80 : 58,
        copies: Number(data.get("copies")) || 1,
        largeText: data.get("largeText") === "on",
        beep: data.get("beep") === "on",
        splitItems: data.get("splitItems") === "on",
        backupPrinterId: backup || null
      }
    }, props.editing?.id || null);
  }

  async function pair() {
    const token = await props.onPairBridge();
    setCopied(false);
    setPairing(token);
  }

  const command = pairing ? `npm run print-bridge -- --url=${props.apiBase} --token=${pairing}` : "";
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch { /* The command stays selectable. */ }
  }

  const bridge = props.bridges[0] ?? null;
  const bridgeLive = fresh(bridge?.lastSeenAt);
  const printer = props.editing;
  const options = printer?.capabilities ?? {};
  const stations = (["kitchen", "bar", "sushi", "front"] as const);
  const others = props.printers.filter((entry) => entry.id !== printer?.id);

  function statusOf(row: PrinterProfile): { label: string; kind: "online" | "offline" | "unknown"; detail?: string } {
    if (row.transport !== "lan" || !row.enabled || !bridgeLive || !row.status || !fresh(row.status.checkedAt)) return { label: t("printerUnknown"), kind: "unknown" };
    return row.status.online
      ? { label: t("printerOnline"), kind: "online" }
      : { label: t("printerOffline"), kind: "offline", ...(row.status.error ? { detail: row.status.error } : {}) };
  }

  return <section id="printersPanel" className="admin-panel active">
    <div className="printer-toolbar">
      <div><h1>{t("printersTitle")}</h1><p>{t("printersLead")}</p></div>
      {props.native && <button className="discover-action" onClick={() => void props.onDiscover()}>⌕ {t("printersDiscover")}</button>}
    </div>

    <section className={`print-bridge ${bridgeLive ? "live" : bridge ? "stale" : "none"}`} aria-labelledby="printBridgeTitle">
      <div className="print-bridge-head">
        <div>
          <h2 id="printBridgeTitle">{t("printerBridgeTitle")}</h2>
          <p className="print-bridge-state">
            <i aria-hidden="true" />
            {bridge ? (bridgeLive ? t("printerBridgeOnline", { name: bridge.name, ago: ago(bridge.lastSeenAt) }) : t("printerBridgeOffline", { ago: ago(bridge.lastSeenAt) })) : t("printerBridgeNever")}
          </p>
          {props.queue && <p className="print-queue">{t("printerQueue", { waiting: props.queue.waiting, failed: props.queue.failed })}</p>}
        </div>
        <button type="button" className="ghost-action" onClick={() => void pair()}>{t("printerBridgePair")}</button>
      </div>
      <p className="print-bridge-lead">{t("printerBridgeLead")}</p>
      {pairing && <div className="print-bridge-command">
        <p>{t("printerBridgeCommand")}</p>
        <code>{command}</code>
        <button type="button" className="ghost-action" onClick={() => void copy()}>{copied ? t("printerBridgeCopied") : t("printerBridgeCopy")}</button>
      </div>}
    </section>

    {props.discovered.length > 0 && <section className="discovered"><h2>{t("printersFound")}</h2><div className="discovered-grid">{props.discovered.map((device) => <div className="discovered-row" key={`${device.transport}-${device.address}`}><span className="printer-icon">▣</span><span><b>{device.name}</b><small>{device.transport.toUpperCase()} · {device.address}{device.port ? `:${device.port}` : ""}</small></span><button onClick={() => props.onEdit({ id: "", name: device.name, transport: device.transport, address: device.address, port: device.port ?? (device.transport === "lan" ? 9100 : null), role: device.transport === "lan" ? "kitchen" : "front", enabled: true })}>{t("printersPick")}</button></div>)}</div></section>}
    <div className="printer-layout">
      <div className="printer-list">{props.printers.length ? props.printers.map((row) => {
        const status = statusOf(row);
        const rowOptions = row.capabilities ?? {};
        return <div key={row.id} className="printer-entry">
          <button className={`printer-row${printer?.id === row.id ? " selected" : ""}`} onClick={() => props.onEdit(row)}>
            <span className="printer-icon">▣</span>
            <span><b>{row.name}</b><small>{row.transport.toUpperCase()} · {row.address}:{row.port ?? ""} · {LANGUAGES.find(([code]) => code === (rowOptions.printLanguage ?? "zh"))?.[1]}{rowOptions.secondLanguage ? ` + ${LANGUAGES.find(([code]) => code === rowOptions.secondLanguage)?.[1]}` : ""} · {rowOptions.paperWidth ?? 58} mm</small></span>
            <em>{t(STATION_KEYS[row.role])}</em>
            <i className={row.enabled ? "live" : ""} />
          </button>
          <div className="printer-actions">
            <span className={`printer-status ${status.kind}`} title={status.detail}>{status.label}{status.detail ? ` · ${status.detail}` : ""}</span>
            {row.transport === "lan" && row.enabled && <button className="test-printer" onClick={() => void props.onTestRemote(row)}>{t("printerTest")}</button>}
            {props.native && <button className="test-printer" onClick={() => void props.onTest(row)}>{t("printerTestHere")}</button>}
          </div>
        </div>;
      }) : <div className="admin-empty">{t("printersEmpty")}</div>}</div>
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

        <h3 className="form-subtitle">{t("printerOptionsTitle")}</h3>
        <div className="field-grid">
          <label><span>{t("printerLanguage")}</span><select name="printLanguage" defaultValue={options.printLanguage ?? "zh"}>{LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
          <label><span>{t("printerSecondLanguage")}</span><select name="secondLanguage" defaultValue={options.secondLanguage ?? ""}><option value="">{t("printerSecondNone")}</option>{LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
        </div>
        <div className="field-grid">
          <label><span>{t("printerEncoding")}</span><select name="encoding" defaultValue={options.encoding ?? "utf8"}><option value="utf8">{t("encodingUtf8")}</option><option value="gb18030">{t("encodingGb18030")}</option><option value="shift_jis">{t("encodingShiftJis")}</option><option value="cp437">{t("encodingCp437")}</option></select></label>
          <label><span>{t("printerPaper")}</span><select name="paperWidth" defaultValue={String(options.paperWidth ?? (printer?.id ? 58 : 80))}><option value="80">{t("printerPaper80")}</option><option value="58">{t("printerPaper58")}</option></select></label>
        </div>
        <p className="field-hint">{t("printerEncodingHint")}</p>
        <div className="field-grid">
          <label><span>{t("printerCopies")}</span><select name="copies" defaultValue={String(options.copies ?? 1)}>{[1, 2, 3].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
          <label><span>{t("printerBackup")}</span><select name="backupPrinterId" defaultValue={options.backupPrinterId ?? ""}><option value="">{t("printerBackupNone")}</option>{others.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {t(STATION_KEYS[entry.role])}</option>)}</select></label>
        </div>
        <label className="checkline"><input type="checkbox" name="largeText" defaultChecked={options.largeText ?? false} /><span>{t("printerLargeText")}</span></label>
        <label className="checkline"><input type="checkbox" name="splitItems" defaultChecked={options.splitItems ?? false} /><span>{t("printerSplitItems")}</span></label>
        <label className="checkline"><input type="checkbox" name="beep" defaultChecked={options.beep ?? false} /><span>{t("printerBeep")}</span></label>
        <label className="checkline"><input type="checkbox" name="enabled" defaultChecked={printer?.enabled ?? true} /><span>{t("printerEnabled")}</span></label>
        <button className="primary-action" type="submit">{printer?.id ? t("printerSave") : t("printerAdd")}</button>
      </form></aside>
    </div>
  </section>;
}

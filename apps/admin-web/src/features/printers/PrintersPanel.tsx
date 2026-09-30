import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ApiDiscoveredPrinter, ApiPrintBridge, ApiPrintQueue } from "@zhaoyun/contracts";
import type { DiscoveredPrinter, PrinterProfile, PrinterLanguage, PrinterEncoding, PrintStation } from "@zhaoyun/domain";
import { useI18n, type CopyKey } from "../../app/i18n";
import { STATION_KEYS } from "../board/BoardPanel";

interface Props {
  printers: PrinterProfile[];
  bridges: ApiPrintBridge[];
  queue: ApiPrintQueue | null;
  /** What the print bridge found on the shop's network and is not set up yet. */
  found: ApiDiscoveredPrinter[];
  /** Published dishes per station, to say which station has none of its tickets printed. */
  dishesPerStation: Partial<Record<PrintStation, number>>;
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
  onDelete: (printer: PrinterProfile) => Promise<void>;
  /** A test page from this device (Android). */
  onTest: (printer: PrinterProfile) => Promise<void>;
  /** A test page through the print bridge. */
  onTestRemote: (printer: PrinterProfile) => Promise<void>;
  onPairBridge: () => Promise<string | null>;
}

/** A bridge not heard from for this long is gone, and so is what it said about the printers. */
const STALE_MS = 3 * 60_000;
const STATIONS: PrintStation[] = ["kitchen", "bar", "sushi", "front"];
const LANGUAGES: Array<[PrinterLanguage, string]> = [["zh", "中文"], ["de", "Deutsch"], ["en", "English"]];
const ENCODINGS: Array<[PrinterEncoding, CopyKey]> = [["auto", "encodingAuto"], ["gb18030", "encodingGb18030"], ["cp437", "encodingCp437"], ["utf8", "encodingUtf8"], ["shift_jis", "encodingShiftJis"]];
/** What the bridge reports, in words: a printer's own answer, or the network's. */
const PROBLEMS: Record<string, CopyKey> = {
  "paper-out": "printerPaperOut", "cover-open": "printerCoverOpen", "offline": "printerNotReady", "error": "printerFault", "paper-low": "printerPaperLow"
};

export function PrintersPanel(props: Props) {
  const { t } = useI18n();
  const [pairing, setPairing] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  // On a phone the form is below the list: a printer picked there is brought into view.
  const picked = props.editing ? `${props.editing.id}|${props.editing.address}` : null;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (window.matchMedia("(max-width: 800px)").matches) form.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [picked]);

  const ago = (iso: string) => {
    const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
    if (minutes < 1) return t("agoNow");
    if (minutes < 120) return t("agoMinutes", { n: minutes });
    return t("agoHours", { n: Math.floor(minutes / 60) });
  };
  const fresh = (iso: string | undefined) => Boolean(iso) && Date.now() - Date.parse(iso!) < STALE_MS;
  const problem = (detail: string | null | undefined) => (detail ? (PROBLEMS[detail] ? t(PROBLEMS[detail]!) : /timed out|ETIMEDOUT|EHOSTUNREACH|ECONNREFUSED/.test(detail) ? t("printerUnreachable") : detail) : "");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const second = String(data.get("secondLanguage") || "");
    const backup = String(data.get("backupPrinterId") || "");
    await props.onSave({
      name: String(data.get("name") || ""),
      transport: String(data.get("transport") || "lan") as PrinterProfile["transport"],
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
        paperWidth: Number(data.get("paperWidth")) === 58 ? 58 : 80,
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

  const bridgeFile = new URL("print-bridge.mjs", window.location.href).href;
  const command = pairing ? `node print-bridge.mjs --url=${props.apiBase} --token=${pairing}` : "";
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch { /* The command stays selectable. */ }
  }
  /** Windows: a file to double-click next to the bridge, and to put in the startup folder. */
  function downloadStarter() {
    const script = `@echo off\r\ntitle Zhaoyun print bridge\r\ncd /d "%~dp0"\r\n${command}\r\npause\r\n`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([script], { type: "application/octet-stream" }));
    link.download = "zhaoyun-print-bridge.cmd";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  const bridge = props.bridges[0] ?? null;
  const bridgeLive = fresh(bridge?.lastSeenAt);
  const printer = props.editing;
  const options = printer?.capabilities ?? {};
  const others = props.printers.filter((entry) => entry.id !== printer?.id);
  const working = (station: PrintStation) => props.printers.some((entry) => entry.role === station && entry.enabled && entry.transport === "lan");
  const uncovered = STATIONS.filter((station) => (props.dishesPerStation[station] ?? 0) > 0 && !working(station));

  function statusOf(row: PrinterProfile): { label: string; kind: "online" | "offline" | "unknown" } {
    if (!row.enabled) return { label: t("printerOff"), kind: "unknown" };
    if (row.transport !== "lan") return { label: t("printerDeviceOnly"), kind: "unknown" };
    if (!bridgeLive || !row.status || !fresh(row.status.checkedAt)) return { label: t("printerUnknown"), kind: "unknown" };
    const detail = problem(row.status.error);
    return row.status.online
      ? { label: detail ? `${t("printerOnline")} · ${detail}` : t("printerOnline"), kind: "online" }
      : { label: `${t("printerOffline")} · ${detail || t("printerUnreachable")}`, kind: "offline" };
  }

  const fresh_printer = (address: string, port: number | null, transport: PrinterProfile["transport"], name: string): PrinterProfile =>
    ({ id: "", name, transport, address, port, role: "kitchen", enabled: true });

  const steps = <ol className="bridge-steps">
    <li><b>{t("bridgeStep1Title")}</b><span>{t("bridgeStep1")}</span></li>
    <li><b>{t("bridgeStep2Title")}</b><span>{t("bridgeStep2")}</span><a className="ghost-action" href={bridgeFile} download="print-bridge.mjs">⬇ {t("bridgeDownload")}</a></li>
    <li>
      <b>{t("bridgeStep3Title")}</b><span>{t("bridgeStep3")}</span>
      {!pairing && <button type="button" className="ghost-action" onClick={() => void pair()}>{t("printerBridgePair")}</button>}
      {pairing && <div className="print-bridge-command">
        <code>{command}</code>
        <div className="print-bridge-command-actions">
          <button type="button" className="ghost-action" onClick={() => void copy()}>{copied ? t("printerBridgeCopied") : t("printerBridgeCopy")}</button>
          <button type="button" className="ghost-action" onClick={downloadStarter}>⬇ {t("bridgeWindowsStarter")}</button>
        </div>
        <p className="field-hint">{t("bridgeTokenOnce")}</p>
      </div>}
    </li>
    <li><b>{t("bridgeStep4Title")}</b><span>{t("bridgeStep4")}</span></li>
  </ol>;

  return <section id="printersPanel" className="admin-panel active">
    <div className="printer-toolbar">
      <div><h1>{t("printersTitle")}</h1></div>
      <div className="printer-toolbar-actions">
        {props.native && <button className="ghost-action" onClick={() => void props.onDiscover()}>⌕ {t("printersDiscover")}</button>}
        <button className="primary-action" onClick={() => props.onEdit(null)}>＋ {t("printerAdd")}</button>
      </div>
    </div>

    <section className={`print-bridge ${bridgeLive ? "live" : bridge ? "stale" : "none"}`} aria-labelledby="printBridgeTitle">
      <div className="print-bridge-head">
        <div>
          <h2 id="printBridgeTitle">{t("printerBridgeTitle")}</h2>
          <p className="print-bridge-state">
            <i aria-hidden="true" />
            {bridge ? (bridgeLive ? t("printerBridgeOnline", { name: bridge.name, ago: ago(bridge.lastSeenAt) }) : t("printerBridgeOffline", { ago: ago(bridge.lastSeenAt) })) : t("printerBridgeNever")}
          </p>
          {props.queue && (props.queue.waiting > 0 || props.queue.failed > 0) && <p className={`print-queue${props.queue.failed ? " failed" : ""}`}>{t("printerQueue", { waiting: props.queue.waiting, failed: props.queue.failed })}</p>}
        </div>
      </div>
      {bridgeLive
        ? <details className="bridge-setup"><summary>{t("bridgeSetupAgain")}</summary>{steps}</details>
        : steps}
    </section>

    {uncovered.length > 0 && <div className="print-warning" role="status">
      <p>⚠ {t("stationWithoutPrinter", { stations: uncovered.map((station) => t("stationDishes", { station: t(STATION_KEYS[station]), count: props.dishesPerStation[station] ?? 0 })).join(t("listJoin")) })}</p>
    </div>}

    {(props.found.length > 0 || props.discovered.length > 0) && <section className="discovered">
      <h2>{t("printersFoundOnNetwork")}</h2>
      <div className="discovered-grid">
        {props.found.map((device) => <div className="discovered-row" key={`net-${device.address}-${device.port}`}>
          <span className="printer-icon">▣</span>
          <span><b>{device.address}:{device.port}</b><small>{device.escpos ? t("foundReceiptPrinter") : t("foundOtherDevice")}</small></span>
          <button onClick={() => props.onEdit(fresh_printer(device.address, device.port, "lan", `${t("printerNewName")} ${device.address.split(".").pop()}`))}>{t("printerAddFound")}</button>
        </div>)}
        {props.discovered.map((device) => <div className="discovered-row" key={`${device.transport}-${device.address}`}>
          <span className="printer-icon">▣</span>
          <span><b>{device.name}</b><small>{device.transport.toUpperCase()} · {device.address}{device.port ? `:${device.port}` : ""}</small></span>
          <button onClick={() => props.onEdit({ ...fresh_printer(device.address, device.port ?? (device.transport === "lan" ? 9100 : null), device.transport, device.name), role: device.transport === "lan" ? "kitchen" : "front" })}>{t("printersPick")}</button>
        </div>)}
      </div>
    </section>}

    <div className="printer-layout">
      <div className="printer-list">{props.printers.length ? STATIONS.filter((station) => props.printers.some((row) => row.role === station)).map((station) => <section key={station} className="printer-station">
        <h3>{t(STATION_KEYS[station])}</h3>
        {props.printers.filter((row) => row.role === station).map((row) => {
          const status = statusOf(row);
          const rowOptions = row.capabilities ?? {};
          const language = (code: string | null | undefined) => LANGUAGES.find(([key]) => key === code)?.[1];
          return <div key={row.id} className={`printer-entry${printer?.id === row.id ? " selected" : ""}`}>
            <button className="printer-row" onClick={() => props.onEdit(row)} aria-label={`${t("printerEdit")}: ${row.name}`}>
              <span className="printer-icon">▣</span>
              <span><b>{row.name}</b><small>{row.address}{row.port ? `:${row.port}` : ""} · {language(rowOptions.printLanguage ?? "zh")}{rowOptions.secondLanguage ? ` + ${language(rowOptions.secondLanguage)}` : ""} · {rowOptions.paperWidth ?? 58} mm</small></span>
              <span className={`printer-status ${status.kind}`}>{status.label}</span>
            </button>
            <div className="printer-actions">
              {row.transport === "lan" && row.enabled && <button className="test-printer" onClick={() => void props.onTestRemote(row)}>{t("printerTest")}</button>}
              {props.native && <button className="test-printer" onClick={() => void props.onTest(row)}>{t("printerTestHere")}</button>}
            </div>
          </div>;
        })}
      </section>) : <div className="admin-empty">{t("printersEmpty")}</div>}</div>

      <aside><form ref={form} key={printer?.id || `${printer?.transport}-${printer?.address}` || "new"} id="printerForm" className="editor-form compact-form" onSubmit={(event) => void submit(event)}>
        <div className="form-title"><div><h2>{printer?.id ? t("printerEdit") : t("printerAdd")}</h2></div></div>
        <label><span>{t("printerName")}</span><input name="name" required defaultValue={printer?.name ?? ""} placeholder={t("printerNamePlaceholder")} /></label>
        <div className="field-grid">
          <label><span>{t("printerStation")}</span><select name="role" defaultValue={printer?.role ?? "kitchen"}>{STATIONS.map((station) => <option key={station} value={station}>{t(STATION_KEYS[station])}</option>)}</select></label>
          <label><span>{t("printerAddress")}</span><input name="address" required defaultValue={printer?.address ?? ""} placeholder="192.168.1.88" inputMode="decimal" /></label>
        </div>

        <h3 className="form-subtitle">{t("printerOptionsTitle")}</h3>
        <div className="field-grid">
          <label><span>{t("printerLanguage")}</span><select name="printLanguage" defaultValue={options.printLanguage ?? "zh"}>{LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
          <label><span>{t("printerSecondLanguage")}</span><select name="secondLanguage" defaultValue={options.secondLanguage ?? ""}><option value="">{t("printerSecondNone")}</option>{LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
        </div>
        <label><span>{t("printerPaper")}</span><select name="paperWidth" defaultValue={String(options.paperWidth ?? (printer?.id ? 58 : 80))}><option value="80">{t("printerPaper80")}</option><option value="58">{t("printerPaper58")}</option></select></label>
        <label className="checkline"><input type="checkbox" name="largeText" defaultChecked={options.largeText ?? false} /><span>{t("printerLargeText")}</span></label>
        <label className="checkline"><input type="checkbox" name="splitItems" defaultChecked={options.splitItems ?? false} /><span>{t("printerSplitItems")}</span></label>
        <label className="checkline"><input type="checkbox" name="enabled" defaultChecked={printer?.enabled ?? true} /><span>{t("printerEnabled")}</span></label>

        <details className="printer-more">
          <summary>{t("printerMore")}</summary>
          <label><span>{t("printerEncoding")}</span><select name="encoding" defaultValue={options.encoding ?? "auto"}>{ENCODINGS.map(([code, key]) => <option key={code} value={code}>{t(key)}</option>)}</select></label>
          <p className="field-hint">{t("printerEncodingHint")}</p>
          <div className="field-grid">
            <label><span>{t("printerCopies")}</span><select name="copies" defaultValue={String(options.copies ?? 1)}>{[1, 2, 3].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
            <label><span>{t("printerBackup")}</span><select name="backupPrinterId" defaultValue={options.backupPrinterId ?? ""}><option value="">{t("printerBackupNone")}</option>{others.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {t(STATION_KEYS[entry.role])}</option>)}</select></label>
          </div>
          <label className="checkline"><input type="checkbox" name="beep" defaultChecked={options.beep ?? false} /><span>{t("printerBeep")}</span></label>
          <div className="field-grid">
            <label><span>{t("printerTransport")}</span><select name="transport" defaultValue={printer?.transport ?? "lan"}><option value="lan">{t("transportLan")}</option><option value="bluetooth">{t("transportBluetooth")}</option><option value="usb">{t("transportUsb")}</option></select></label>
            <label><span>{t("printerPort")}</span><input name="port" type="number" defaultValue={printer?.port ?? 9100} /></label>
          </div>
        </details>

        <button className="primary-action" type="submit">{printer?.id ? t("printerSave") : t("printerAdd")}</button>
        {printer?.id && <button type="button" className="danger-action" onClick={() => { if (window.confirm(t("printerDeleteConfirm", { name: printer.name }))) void props.onDelete(printer); }}>{t("printerDelete")}</button>}
      </form></aside>
    </div>
  </section>;
}

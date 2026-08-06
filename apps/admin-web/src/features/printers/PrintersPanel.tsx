import type { FormEvent } from "react";
import type { DiscoveredPrinter, PrinterProfile, PrinterLanguage, PrinterEncoding } from "@zhaoyun/domain";

interface Props {
  printers: PrinterProfile[];
  discovered: DiscoveredPrinter[];
  editing: PrinterProfile | null;
  onEdit: (printer: PrinterProfile | null) => void;
  onDiscover: () => Promise<void>;
  onSave: (printer: Omit<PrinterProfile, "id">, id: string | null) => Promise<void>;
  onTest: (printer: PrinterProfile) => Promise<void>;
}

export function PrintersPanel(props: Props) {
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
  return <section id="printersPanel" className="admin-panel active">
    <div className="printer-toolbar"><div><h1>打印机连接</h1><p>搜索周围设备，测试后分配到对应档口</p></div><button className="discover-action" onClick={() => void props.onDiscover()}>⌕ 搜索周围打印机</button></div>
    {props.discovered.length > 0 && <section className="discovered"><h2>发现的设备</h2><div className="discovered-grid">{props.discovered.map((device) => <div className="discovered-row" key={`${device.transport}-${device.address}`}><span className="printer-icon">▣</span><span><b>{device.name}</b><small>{device.transport.toUpperCase()} · {device.address}{device.port ? `:${device.port}` : ""}</small></span><button onClick={() => props.onEdit({ id: "", name: device.name, transport: device.transport, address: device.address, port: device.port ?? (device.transport === "lan" ? 9100 : null), role: device.transport === "lan" ? "kitchen" : "front", enabled: true })}>选择</button></div>)}</div></section>}
    <div className="printer-layout"><div className="printer-list">{props.printers.length ? props.printers.map((row) => <div key={row.id}><button className="printer-row" onClick={() => props.onEdit(row)}><span className="printer-icon">▣</span><span><b>{row.name}</b><small>{row.transport.toUpperCase()} · {row.address}:{row.port ?? ""}</small></span><em>{{ kitchen: "厨房", bar: "吧台", sushi: "寿司台", front: "前台" }[row.role]}</em><i className={row.enabled ? "live" : ""} /></button><button className="test-printer" onClick={() => void props.onTest(row)}>测试打印</button></div>) : <div className="admin-empty">还没有配置打印机</div>}</div>
      <aside><form key={printer?.id || `${printer?.transport}-${printer?.address}` || "new"} id="printerForm" className="editor-form compact-form" onSubmit={(event) => void submit(event)}><div className="form-title"><div><h2>{printer?.id ? "编辑打印机" : "添加打印机"}</h2><p>按档口自动分配打印任务</p></div></div><label><span>名称</span><input name="name" required defaultValue={printer?.name ?? ""} placeholder="厨房热菜打印机" /></label><div className="field-grid"><label><span>连接方式</span><select name="transport" defaultValue={printer?.transport ?? "lan"}><option value="lan">局域网</option><option value="bluetooth">蓝牙</option><option value="usb">USB</option></select></label><label><span>负责档口</span><select name="role" defaultValue={printer?.role ?? "kitchen"}><option value="kitchen">厨房</option><option value="bar">吧台</option><option value="sushi">寿司台</option><option value="front">前台</option></select></label></div><div className="field-grid"><label><span>IP / 设备地址</span><input name="address" required defaultValue={printer?.address ?? ""} placeholder="192.168.1.88" /></label><label><span>端口</span><input name="port" type="number" defaultValue={printer?.port ?? 9100} /></label></div><div className="field-grid"><label><span>打印语言</span><select name="printLanguage" defaultValue={printer?.capabilities?.printLanguage ?? "zh"}><option value="zh">中文</option><option value="de">Deutsch</option><option value="en">English</option></select></label><label><span>字符编码</span><select name="encoding" defaultValue={printer?.capabilities?.encoding ?? "utf8"}><option value="utf8">UTF-8（现代打印机）</option><option value="gb18030">GB18030（中文打印机）</option><option value="shift_jis">Shift-JIS（日文打印机）</option><option value="cp437">CP437（英文老式打印机）</option></select></label></div><label className="checkline"><input type="checkbox" name="enabled" defaultChecked={printer?.enabled ?? true} /><span>启用自动打印</span></label><button className="primary-action" type="submit">{printer?.id ? "保存打印机" : "添加打印机"}</button></form></aside>
    </div>
  </section>;
}

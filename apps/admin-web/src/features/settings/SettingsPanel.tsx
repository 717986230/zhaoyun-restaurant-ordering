import type { FormEvent } from "react";
import { useState } from "react";
import type { AdminStorage, AuditEntry, RestaurantTable } from "@zhaoyun/api-client";
import type { MenuThemeId } from "@zhaoyun/contracts";
import { MENU_THEMES } from "@zhaoyun/domain";
import { TableCards } from "./TableCards";

interface Props {
  storage: AdminStorage;
  tables: RestaurantTable[];
  auditEntries: AuditEntry[];
  menuTheme: MenuThemeId | null;
  onSave: (storage: AdminStorage) => Promise<void>;
  onSaveTable: (input: { table: string; label?: string; rotateToken?: boolean }) => Promise<void>;
  onDeleteTable: (table: string) => Promise<void>;
  onSaveMenuTheme: (menuTheme: MenuThemeId) => Promise<void>;
}

const ROLE_LABELS: Record<string, string> = { manager: "经理", staff: "服务员", kitchen: "厨房" };

function detailSummary(entry: AuditEntry): string {
  const parts = Object.entries(entry.detail)
    .filter(([key, value]) => key !== "params" && value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${String(value)}`);
  return parts.length ? ` · ${parts.join(" ")}` : "";
}

function entryUrl(baseUrl: string, table: RestaurantTable): string {
  return `${baseUrl.replace(/\/+$/, "")}/?table=${encodeURIComponent(table.table)}&k=${encodeURIComponent(table.token)}`;
}

export function SettingsPanel(props: Props) {
  const [showCards, setShowCards] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void props.onSave({ baseUrl: String(data.get("baseUrl")), token: String(data.get("token")) });
  }

  function addTable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void props.onSaveTable({ table: String(data.get("table") || ""), label: String(data.get("label") || "") }).then(() => form.reset());
  }

  return <section id="systemPanel" className="admin-panel active"><div className="system-pane">
    <h1>服务器连接</h1>
    <p>Android 设备请填写餐厅局域网内后端电脑的地址。</p>
    <form id="connectionForm" className="editor-form compact-form" onSubmit={submit}>
      <label><span>API 地址</span><input name="baseUrl" required defaultValue={props.storage.baseUrl} placeholder="http://192.168.1.20:8787" /></label>
      <label><span>管理员令牌</span><input name="token" required type="password" defaultValue={props.storage.token} autoComplete="current-password" /></label>
      <button className="primary-action" type="submit">测试并保存连接</button>
    </form>

    <h1>菜单样式</h1>
    <p>只改变一处强调色，菜单其余部分（背景、文字、对比度）保持不变，选完立即在顾客菜单上生效。</p>
    <div className="theme-picker">{Object.values(MENU_THEMES).map((theme) => <button
      key={theme.id}
      type="button"
      className={`theme-swatch ${props.menuTheme === theme.id ? "selected" : ""}`}
      style={{ "--swatch": theme.accent } as React.CSSProperties}
      onClick={() => void props.onSaveMenuTheme(theme.id)}
    ><i /><span>{theme.nameZh}</span></button>)}</div>

    <h1>桌台</h1>
    <p>登记桌台后，服务端只接受已登记的桌号，并要求设备带上该桌的令牌。没有登记任何桌台时保持开放模式。</p>
    <form className="editor-form compact-form" onSubmit={addTable}>
      <div className="field-grid">
        <label><span>桌号</span><input name="table" required maxLength={8} placeholder="12 / T-3" /></label>
        <label><span>备注</span><input name="label" maxLength={64} placeholder="露台 / 包间" /></label>
      </div>
      <button className="primary-action" type="submit">登记桌台</button>
    </form>
    {props.tables.length > 0 && <div className="table-cards-launch">
      <button className="ghost-action" onClick={() => setShowCards(true)}>生成桌卡（二维码，可打印）</button>
      <small>客人用自己的手机扫码进入，桌号和令牌随链接带上。同一个链接写进 NFC 标签也可以，安卓碰一下就会打开。</small>
    </div>}
    {showCards && <TableCards tables={props.tables} entryUrl={(table) => entryUrl(props.storage.baseUrl, table)} onClose={() => setShowCards(false)} />}

    <div className="table-list">{props.tables.length ? props.tables.map((table) => <div className="table-row" key={table.table}>
      <div><b>桌 {table.table}</b>{table.label && <small> · {table.label}</small>}<code>{entryUrl(props.storage.baseUrl, table)}</code></div>
      <div className="table-row-actions">
        <button className="ghost-action" onClick={() => void props.onSaveTable({ table: table.table, label: table.label, rotateToken: true })}>更换令牌</button>
        <button className="ghost-action" onClick={() => void props.onDeleteTable(table.table)}>删除</button>
      </div>
    </div>) : <div className="admin-empty">还没有登记桌台，任何设备都可以自报桌号</div>}</div>

    <h1>操作记录</h1>
    <p>所有带令牌的写操作和被拒绝的越权尝试。共享令牌记不到人，但记得到「什么被改了、什么时候、哪台设备、什么角色」。</p>
    <div className="audit-list">{props.auditEntries.length ? props.auditEntries.map((entry) => <div className={`audit-row ${entry.status >= 400 ? "denied" : ""}`} key={entry.id}>
      <span className="audit-role">{ROLE_LABELS[entry.role] ?? entry.role}</span>
      <span className="audit-what"><b>{entry.method} {entry.route}</b><small>{new Date(entry.at).toLocaleString("de-AT")} · {entry.ip} · {entry.status}{detailSummary(entry)}</small></span>
    </div>) : <div className="admin-empty">还没有记录</div>}</div>
  </div></section>;
}

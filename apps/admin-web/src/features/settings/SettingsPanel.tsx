import type { FormEvent } from "react";
import type { AdminStorage, RestaurantTable } from "@zhaoyun/api-client";

interface Props {
  storage: AdminStorage;
  tables: RestaurantTable[];
  onSave: (storage: AdminStorage) => Promise<void>;
  onSaveTable: (input: { table: string; label?: string; rotateToken?: boolean }) => Promise<void>;
  onDeleteTable: (table: string) => Promise<void>;
}

function entryUrl(baseUrl: string, table: RestaurantTable): string {
  return `${baseUrl.replace(/\/+$/, "")}/?table=${encodeURIComponent(table.table)}&k=${encodeURIComponent(table.token)}`;
}

export function SettingsPanel(props: Props) {
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

    <h1>桌台</h1>
    <p>登记桌台后，服务端只接受已登记的桌号，并要求设备带上该桌的令牌。没有登记任何桌台时保持开放模式。</p>
    <form className="editor-form compact-form" onSubmit={addTable}>
      <div className="field-grid">
        <label><span>桌号</span><input name="table" required maxLength={8} placeholder="12 / T-3" /></label>
        <label><span>备注</span><input name="label" maxLength={64} placeholder="露台 / 包间" /></label>
      </div>
      <button className="primary-action" type="submit">登记桌台</button>
    </form>
    <div className="table-list">{props.tables.length ? props.tables.map((table) => <div className="table-row" key={table.table}>
      <div><b>桌 {table.table}</b>{table.label && <small> · {table.label}</small>}<code>{entryUrl(props.storage.baseUrl, table)}</code></div>
      <div className="table-row-actions">
        <button className="ghost-action" onClick={() => void props.onSaveTable({ table: table.table, label: table.label, rotateToken: true })}>更换令牌</button>
        <button className="ghost-action" onClick={() => void props.onDeleteTable(table.table)}>删除</button>
      </div>
    </div>) : <div className="admin-empty">还没有登记桌台，任何设备都可以自报桌号</div>}</div>
  </div></section>;
}

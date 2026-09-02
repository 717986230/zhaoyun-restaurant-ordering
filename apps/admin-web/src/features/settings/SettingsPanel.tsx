import type { FormEvent } from "react";
import type { AdminStorage } from "@zhaoyun/api-client";

export function SettingsPanel({ storage, onSave }: { storage: AdminStorage; onSave: (storage: AdminStorage) => Promise<void> }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void onSave({ baseUrl: String(data.get("baseUrl")), token: String(data.get("token")), tableNumber: String(data.get("tableNumber")) });
  }
  return <section id="systemPanel" className="admin-panel active"><div className="system-pane"><h1>服务器连接</h1><p>Android 设备请填写餐厅局域网内后端电脑的地址。</p><form id="connectionForm" className="editor-form compact-form" onSubmit={submit}><label><span>API 地址</span><input name="baseUrl" required defaultValue={storage.baseUrl} placeholder="http://192.168.1.20:8787" /></label><label><span>管理员令牌</span><input name="token" required type="password" defaultValue={storage.token} autoComplete="current-password" /></label><label><span>本机桌号</span><input name="tableNumber" required maxLength={32} defaultValue={storage.tableNumber || "08"} placeholder="08" /><small>这台设备下单和呼叫服务时使用的桌号，每台平板单独设置。</small></label><button className="primary-action" type="submit">测试并保存连接</button></form></div></section>;
}

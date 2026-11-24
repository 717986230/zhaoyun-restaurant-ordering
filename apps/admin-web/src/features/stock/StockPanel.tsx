import { useMemo, useState } from "react";
import type { AdminApi } from "@zhaoyun/api-client";
import type { Product } from "@zhaoyun/domain";
import { useI18n } from "../../app/i18n";
import { productToInput } from "../catalog/CatalogPanel";

interface Props {
  api: AdminApi;
  products: Product[];
  onRefresh: () => Promise<void>;
  notify: (message: string) => void;
  failed: (error: unknown) => void;
}

const THRESHOLDS = [3, 5, 10, 20];
const STORE_KEY = "zy_admin_lowstock";

function readThreshold(): number {
  try { const v = Number(localStorage.getItem(STORE_KEY)); return THRESHOLDS.includes(v) ? v : 5; } catch { return 5; }
}

type Status = "soldOut" | "outToday" | "low" | "ok";

/** The name a guest with this console's language sees. */
function nameOf(product: Product, language: "zh" | "de" | "en") {
  return product.names[language] || product.names.zh || product.names.en || product.names.de || product.sku;
}

export function StockPanel({ api, products, onRefresh, notify, failed }: Props) {
  const { t, language } = useI18n();
  const [threshold, setThreshold] = useState(readThreshold);
  const [busy, setBusy] = useState<string | null>(null);
  // Per-row edits to 限量 / 今日剩余, keyed by dish id; the input is a string so it can be emptied (= no limit).
  const [edits, setEdits] = useState<Record<string, { limit: string; left: string }>>({});

  const statusOf = (product: Product): Status => {
    if (product.available === false) return "soldOut";
    if (product.leftToday === 0) return "outToday";
    if (product.leftToday != null && product.leftToday <= threshold) return "low";
    return "ok";
  };

  // Every dish that has a daily limit, or is 沽清 right now — the ones worth a stock view.
  const rows = useMemo(() => {
    const tracked = products.filter((product) => product.dailyLimit != null || product.available === false);
    const rank: Record<Status, number> = { soldOut: 0, outToday: 1, low: 2, ok: 3 };
    return tracked.map((product) => ({ product, status: statusOf(product) }))
      .sort((a, b) => rank[a.status] - rank[b.status] || (a.product.leftToday ?? Infinity) - (b.product.leftToday ?? Infinity) || nameOf(a.product, language).localeCompare(nameOf(b.product, language)));
  }, [products, threshold, language]);

  const counts = useMemo(() => {
    let soldOut = 0, outToday = 0, low = 0, limited = 0;
    for (const product of products) {
      if (product.dailyLimit != null) limited += 1;
      const status = statusOf(product);
      if (status === "soldOut") soldOut += 1;
      else if (status === "outToday") outToday += 1;
      else if (status === "low") low += 1;
    }
    return { soldOut, outToday, low, limited };
  }, [products, threshold]);

  const editOf = (product: Product) => edits[product.id] ?? { limit: product.dailyLimit != null ? String(product.dailyLimit) : "", left: product.leftToday != null ? String(product.leftToday) : "" };
  const setEdit = (id: string, patch: Partial<{ limit: string; left: string }>) => setEdits((current) => ({ ...current, [id]: { ...editOf(products.find((p) => p.id === id)!), ...current[id], ...patch } }));

  async function run(id: string, action: () => Promise<unknown>, message: string) {
    setBusy(id);
    try { await action(); await onRefresh(); setEdits((current) => { const next = { ...current }; delete next[id]; return next; }); notify(message); }
    catch (error) { failed(error); }
    finally { setBusy(null); }
  }

  function saveStock(product: Product) {
    const edit = editOf(product);
    const limit = edit.limit.trim() === "" ? null : Number(edit.limit);
    const left = edit.left.trim() === "" ? null : Number(edit.left);
    if (limit !== null && (!Number.isInteger(limit) || limit < 0 || limit > 9999)) return failed(new Error(t("invBadNumber")));
    if (left !== null && (!Number.isInteger(left) || left < 0 || left > 9999)) return failed(new Error(t("invBadNumber")));
    void run(product.id, () => api.setProductStock(product.id, { dailyLimit: limit, leftToday: left }), t("invSaved", { name: nameOf(product, language) }));
  }

  function refill(product: Product) {
    void run(product.id, () => api.setProductStock(product.id, { leftToday: product.dailyLimit ?? null }), t("invSaved", { name: nameOf(product, language) }));
  }

  function setAvailable(product: Product, available: boolean) {
    void run(product.id, () => api.updateProduct(product.id, { ...productToInput(product), available }), t("invAvailChanged", { name: nameOf(product, language), state: t(available ? "invStateRestored" : "invStateSoldOut") }));
  }

  const statusLabel: Record<Status, string> = { soldOut: t("invStatusSoldOut"), outToday: t("invStatusOutToday"), low: t("invStatusLow"), ok: t("invStatusOk") };

  return <section id="stockPanel" className="admin-panel active"><div className="settings-page">
    <div className="list-head">
      <h1 className="settings-title">{t("invTitle")}</h1>
      <p className="settings-hint">{t("invHint")}</p>
    </div>

    <div className="report-tiles">
      <div className="report-tile" data-tone={counts.soldOut ? "warn" : undefined}><small>{t("invTileSoldOut")}</small><b>{counts.soldOut}</b></div>
      <div className="report-tile" data-tone={counts.outToday ? "warn" : undefined}><small>{t("invTileOutToday")}</small><b>{counts.outToday}</b></div>
      <div className="report-tile" data-tone={counts.low ? "low" : undefined}><small>{t("invTileLow")}</small><b>{counts.low}</b></div>
      <div className="report-tile"><small>{t("invTileLimited")}</small><b>{counts.limited}</b></div>
    </div>

    <label className="inv-threshold"><span>{t("invLowLabel")}</span>
      <select value={threshold} onChange={(event) => { const value = Number(event.target.value); setThreshold(value); try { localStorage.setItem(STORE_KEY, String(value)); } catch { /* private window */ } }}>
        {THRESHOLDS.map((value) => <option key={value} value={value}>≤ {value}</option>)}
      </select>
    </label>

    {!rows.length ? <div className="admin-empty">{t("invNone")}</div> : <div className="res-table-wrap"><table className="report-table inv-table">
      <thead><tr><th>{t("invColDish")}</th><th>{t("invColStatus")}</th><th>{t("invColLimit")}</th><th>{t("invColLeft")}</th><th aria-label={t("invColActions")}></th></tr></thead>
      <tbody>{rows.map(({ product, status }) => {
        const edit = editOf(product);
        const changed = edit.limit !== (product.dailyLimit != null ? String(product.dailyLimit) : "") || edit.left !== (product.leftToday != null ? String(product.leftToday) : "");
        return <tr key={product.id} data-status={status}>
          <td><b>{nameOf(product, language)}</b><small className="inv-sub"> · {product.sku} · {product.category}</small></td>
          <td><span className={`inv-pill inv-${status}`}>{statusLabel[status]}</span></td>
          <td><input className="inv-num" type="number" min={0} max={9999} inputMode="numeric" placeholder={t("invUnlimited")} value={edit.limit} onChange={(event) => setEdit(product.id, { limit: event.target.value })} aria-label={t("invColLimit")} /></td>
          <td><input className="inv-num" type="number" min={0} max={9999} inputMode="numeric" placeholder={t("invUnlimited")} value={edit.left} onChange={(event) => setEdit(product.id, { left: event.target.value })} aria-label={t("invColLeft")} /></td>
          <td className="inv-actions">
            <button type="button" className="ghost-action" disabled={busy === product.id || !changed} onClick={() => saveStock(product)}>{t("invSave")}</button>
            {product.dailyLimit != null && <button type="button" className="ghost-action" disabled={busy === product.id} onClick={() => refill(product)}>{t("invRefill")}</button>}
            {product.available === false
              ? <button type="button" className="ghost-action inv-restore" disabled={busy === product.id} onClick={() => setAvailable(product, true)}>{t("invRestore")}</button>
              : <button type="button" className="ghost-action inv-soldout" disabled={busy === product.id} onClick={() => setAvailable(product, false)}>{t("invMarkSoldOut")}</button>}
          </td>
        </tr>;
      })}</tbody>
    </table></div>}
  </div></section>;
}

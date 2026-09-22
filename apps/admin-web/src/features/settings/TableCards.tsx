import { useEffect, useState } from "react";
import type { RestaurantTable } from "@zhaoyun/api-client";
import QRCode from "qrcode";

/**
 * Printable table cards.
 *
 * A guest's phone is the scanner, so nothing here needs a camera: the card
 * carries the same entry URL the settings list already shows, and the app
 * already reads `?table=` and `?k=` on load. The same string is what goes onto
 * an NFC tag — Android opens a URL record without any app installed, so a tag
 * and a printed code are two ways of handing over one link.
 *
 * The codes are rendered as SVG rather than canvas so they stay sharp at
 * whatever size the card is printed, and error correction is set high because
 * these live on a restaurant table and will be smudged, scratched and rained on.
 */
export function TableCards({ tables, entryUrl, onClose }: { tables: RestaurantTable[]; entryUrl: (table: RestaurantTable) => string; onClose: () => void }) {
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      const drawn: Record<string, string> = {};
      const errors: string[] = [];
      for (const table of tables) {
        try {
          drawn[table.table] = await QRCode.toString(entryUrl(table), {
            type: "svg",
            errorCorrectionLevel: "H",
            margin: 1,
            color: { dark: "#141110", light: "#ffffff" }
          });
        } catch {
          errors.push(table.table);
        }
      }
      if (cancelled) return;
      setCodes(drawn);
      setFailed(errors);
    };
    void render();
    return () => { cancelled = true; };
  }, [tables, entryUrl]);

  return <div className="table-cards" role="dialog" aria-label="桌卡">
    <div className="table-cards-bar">
      <div>
        <b>桌卡</b>
        <small>打印后贴在桌上。客人用手机扫码即可进入点餐，桌号自动带上。</small>
      </div>
      <div className="table-cards-actions">
        <button className="primary-action" onClick={() => window.print()}>打印</button>
        <button className="ghost-action" onClick={onClose}>关闭</button>
      </div>
    </div>

    {failed.length > 0 && <p className="table-cards-warning">这些桌的二维码生成失败，请检查入口地址：{failed.join("、")}</p>}

    <div className="table-cards-sheet">{tables.map((table) => <article className="table-card" key={table.table}>
      <div className="table-card-brand"><small>ZHAO YUN</small><b>赵云</b></div>
      <div className="table-card-qr" aria-label={`桌 ${table.table} 的二维码`} dangerouslySetInnerHTML={{ __html: codes[table.table] || "" }} />
      <div className="table-card-foot">
        <b>桌 {table.table}</b>
        {table.label && <small>{table.label}</small>}
        <small className="table-card-hint">扫码点餐 · Scannen zum Bestellen</small>
      </div>
    </article>)}</div>
  </div>;
}

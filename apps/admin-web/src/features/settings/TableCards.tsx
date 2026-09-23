import { useEffect, useState } from "react";
import type { RestaurantTable } from "@zhaoyun/api-client";
import QRCode from "qrcode";
import type { MenuLanguage } from "@zhaoyun/contracts";
import { useI18n } from "../../app/i18n";

/** What the card says to a guest, in each language the menu offers — the
 *  card is read by guests, not by whoever printed it. */
const CARD_COPY: Record<MenuLanguage, { table: string; scan: string }> = {
  zh: { table: "桌", scan: "扫码看菜单" },
  de: { table: "Tisch", scan: "Speisekarte scannen" },
  en: { table: "Table", scan: "Scan for the menu" }
};

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
export function TableCards({ tables, restaurantName, menuLanguages, entryUrl, onClose }: {
  tables: RestaurantTable[];
  restaurantName: string;
  menuLanguages: MenuLanguage[];
  entryUrl: (table: RestaurantTable) => string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  // The URLs, not the function that builds them, are what the codes depend
  // on. The function is a new one on every render of the settings page, and
  // with it as the dependency every render redrew every code, whose state
  // update rendered again — a loop that kept the phone busy for as long as
  // the cards were open.
  const urls = tables.map((table) => `${table.table}\n${entryUrl(table)}`).join("\n");
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
  }, [urls]);

  return <div className="table-cards" role="dialog" aria-label={t("cardsTitle")}>
    <div className="table-cards-bar">
      <div>
        <b>{t("cardsTitle")}</b>
        <small>{t("cardsLead")}</small>
      </div>
      <div className="table-cards-actions">
        <button className="primary-action" onClick={() => window.print()}>{t("print")}</button>
        <button className="ghost-action" onClick={onClose}>{t("close")}</button>
      </div>
    </div>

    {failed.length > 0 && <p className="table-cards-warning">{t("cardsFailed", { tables: failed.join(", ") })}</p>}

    <div className="table-cards-sheet">{tables.map((table) => <article className="table-card" key={table.table}>
      {restaurantName && <div className="table-card-brand"><b>{restaurantName}</b></div>}
      <div className="table-card-qr" aria-label={t("cardQr", { table: table.table })} dangerouslySetInnerHTML={{ __html: codes[table.table] || "" }} />
      <div className="table-card-foot">
        <b>{menuLanguages.map((language) => CARD_COPY[language].table).join(" · ")} {table.table}</b>
        {table.label && <small>{table.label}</small>}
        <small className="table-card-hint">{menuLanguages.map((language) => CARD_COPY[language].scan).join(" · ")}</small>
      </div>
    </article>)}</div>
  </div>;
}

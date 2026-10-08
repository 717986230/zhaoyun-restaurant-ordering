import { useI18n } from "../../app/i18n";
import type { CopyKey } from "../../app/i18n";
import { inventoryAddress } from "../../app/inventory";

/**
 * 跳转: the other apps the restaurant runs, one tap each, every one in a tab
 * of its own — the stock app (its own project and sign-in) and this
 * system's own guest menu, booking page and POS.
 */
export function LinksPanel({ apiBase }: { apiBase: string }) {
  const { t } = useI18n();
  const here = (page: string) => new URL(page, window.location.href).href;
  const links: Array<{ id: string; name: CopyKey; note: CopyKey; href: string }> = [
    { id: "inventory", name: "linkInventory", note: "linkInventoryNote", href: inventoryAddress(window.location.href, apiBase) },
    { id: "menu", name: "linkMenu", note: "linkMenuNote", href: here("index.html") },
    { id: "booking", name: "linkBooking", note: "linkBookingNote", href: here("book.html") },
    { id: "pos", name: "linkPos", note: "linkPosNote", href: here("pos.html") }
  ];
  return <section id="linksPanel" className="admin-panel active">
    <div className="settings-page">
      <h1 className="settings-title">{t("tabLinks")}</h1>
      <ul className="link-list">{links.map((link) => <li key={link.id}>
        <a href={link.href} target="_blank" rel="noopener noreferrer" data-link={link.id}>
          <span><strong>{t(link.name)}</strong><small>{t(link.note)}</small></span>
          <span aria-hidden="true">↗</span>
        </a>
      </li>)}</ul>
    </div>
  </section>;
}

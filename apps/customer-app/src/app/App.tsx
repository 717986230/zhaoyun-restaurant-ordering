import { useEffect, useMemo } from "react";
import { AnimatePresence } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimeEnvelope } from "@zhaoyun/contracts";
import { restaurantApi } from "./api";
import { useCatalog } from "./useCatalog";
import { useCustomerState } from "./model";
import { useMenuTheme } from "./useMenuTheme";
import { useColorScheme } from "./useColorScheme";
import { DEFAULT_FEATURED_TEMPLATE, DEFAULT_MENU_LANGUAGES, resolveMenuLanguage } from "@zhaoyun/domain";
import { CatalogScreen } from "../features/catalog/CatalogScreen";
import { useKiosk } from "../features/kiosk/useKiosk";
import { useMinuteClock } from "./useMinuteClock";
import { DEFAULT_TIME_ZONE, isOnSchedule } from "../../../../src/schedule.js";
import { summarize } from "./cart";
import { orderingState } from "./ordering";
import { assignedTableNo } from "./table";
import { useCustomer } from "../features/account/useCustomer";
import { AccountSheet } from "../features/account/AccountSheet";
import { CartSheet } from "../features/cart/CartSheet";
import { OrdersSheet } from "../features/orders/OrdersSheet";

/**
 * The guest app is the menu. Everything else opens over it as a sheet, and
 * only when the restaurant switched it on (served with the catalogue):
 *
 *  - the guest's account — favourites, points and rewards (features/account);
 *  - the cart, and the order it becomes, at the table or for pickup,
 *    straight to the kitchen within the owner's limits (features/cart);
 *  - the guest's orders and where they are (features/orders).
 *
 * With none of it on, it is the menu it always was. Admin access is a
 * tap-sequence on the title, handled by `useKiosk`, not a screen of its own.
 */
export function App() {
  const { state, dispatch } = useCustomerState();
  const { data: catalog } = useCatalog();
  const queryClient = useQueryClient();
  const handleAdminTap = useKiosk();
  const [scheme, toggleScheme] = useColorScheme(catalog.menu?.defaultScheme);
  const menuTitle = catalog.menu?.title || "La Carte";
  useEffect(() => {
    const name = catalog.menu?.restaurantName;
    document.title = name ? `${name} · ${menuTitle}` : menuTitle;
  }, [catalog.menu?.restaurantName, menuTitle]);
  useMenuTheme(catalog.theme, scheme);

  // The flags the restaurant switched on in 连接设置, and the one of them this
  // guest reads: their own pick while it is still offered, else their phone's
  // language, else German.
  const languages = catalog.languages?.length ? catalog.languages : DEFAULT_MENU_LANGUAGES;
  const language = resolveMenuLanguage(state.languageChosen ? state.language : null, languages, navigator.languages ?? []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);

  useEffect(() => restaurantApi.connect((message: RealtimeEnvelope) => {
    if (message.type === "catalog.changed") void queryClient.invalidateQueries({ queryKey: ["catalog"] });
  }), [queryClient]);

  // The promotions page and the set menus page may each have hours — a lunch
  // offer, Mon–Fri 11:00–14:30 — by the restaurant's clock. Outside them the
  // page and its tab are gone (and the sets with it, from a search too); they
  // come and go as the minutes turn. The hours come with the catalogue, so a
  // phone that has cached it keeps to them offline as well.
  const now = useMinuteClock();
  const timeZone = catalog.menu?.timeZone ?? DEFAULT_TIME_ZONE;
  const minute = Math.floor(now.getTime() / 60_000);
  const isOpen = (schedule: Parameters<typeof isOnSchedule>[0]) => isOnSchedule(schedule, new Date(minute * 60_000), timeZone);
  const setsOpen = isOpen(catalog.menu?.setsSchedule ?? null);
  const featuredOpen = isOpen(catalog.menu?.featured?.schedule ?? null);
  const products = useMemo(
    () => (setsOpen ? catalog.products : catalog.products.filter((product) => !product.bundleItems?.length)),
    [catalog.products, setsOpen]
  );

  // Ordering from the menu and guests' accounts, as the owner switched them on.
  const ordering = orderingState(catalog.menu, assignedTableNo(), new Date(minute * 60_000), timeZone);
  const accountsOn = Boolean(catalog.menu?.accounts);
  const account = useCustomer(accountsOn);
  const loyalty = catalog.menu?.loyalty ?? null;
  const rewardPoints = useMemo(() => new Map((loyalty?.rewards ?? []).map((reward) => [reward.productId, reward.points])), [loyalty]);
  const cart = summarize(state.cart, catalog.products, rewardPoints);
  // A sheet whose feature was switched off while it was open closes.
  const sheet = state.sheet === "account" && !accountsOn ? null : state.sheet === "cart" && !ordering.open && !ordering.closed ? null : state.sheet;

  // The promotions page's dishes, in the owner's order; a dish since taken off
  // the menu is skipped, and a page left with nothing on it is not shown.
  const featuredSettings = featuredOpen ? catalog.menu?.featured : null;
  const featured = useMemo(() => {
    if (!featuredSettings) return null;
    const byId = new Map(products.map((product) => [product.id, product]));
    const chosen = featuredSettings.productIds.flatMap((id) => byId.get(id) ?? []);
    // An older server sends no template; the gallery is what it showed.
    return chosen.length ? { title: featuredSettings.title, products: chosen, template: featuredSettings.template ?? DEFAULT_FEATURED_TEMPLATE } : null;
  }, [featuredSettings, products]);

  return <main className="app-shell">
    <CatalogScreen
      state={{ ...state, language }}
      dispatch={dispatch}
      products={products}
      catalog={catalog.products}
      languages={languages}
      title={menuTitle}
      showTableNumber={catalog.menu?.showTableNumber ?? true}
      scheme={scheme}
      onToggleScheme={toggleScheme}
      onAdminTap={handleAdminTap}
      featured={featured}
      navPinned={catalog.menu?.navPinned ?? []}
      navLabels={catalog.menu?.navLabels ?? {}}
      ordering={ordering}
      account={accountsOn ? account : null}
      cart={cart}
    />
    <AnimatePresence>
      {sheet === "cart" && <CartSheet key="cart" state={{ ...state, language }} dispatch={dispatch} products={catalog.products} ordering={ordering} loyalty={loyalty} account={account} />}
      {sheet === "account" && <AccountSheet key="account" state={{ ...state, language }} dispatch={dispatch} products={catalog.products} account={account} loyalty={loyalty} ordering={ordering} />}
      {sheet === "orders" && <OrdersSheet key="orders" state={{ ...state, language }} dispatch={dispatch} products={catalog.products} signedIn={account.signedIn} />}
    </AnimatePresence>
    <div className={`toast ${state.toast ? "show" : ""}`} role="status" aria-live="polite">{state.toast}</div>
  </main>;
}

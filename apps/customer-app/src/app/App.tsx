import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimeEnvelope } from "@zhaoyun/contracts";
import { restaurantApi } from "./api";
import { useCatalog } from "./useCatalog";
import { useCustomerState } from "./model";
import { useMenuTheme } from "./useMenuTheme";
import { CatalogScreen } from "../features/catalog/CatalogScreen";
import { useKiosk } from "../features/kiosk/useKiosk";

/**
 * The guest app is a menu, and nothing else.
 *
 * A tap on an NFC tag or a scanned table card used to open a home screen with
 * four things to choose between — ordering, service, order status, staff —
 * because the app once took orders. It no longer does for guests: cart,
 * checkout, service calls and the local order board are still here as code
 * (`features/cart`, `features/service`, `features/orders`, `features/staff`,
 * and every reducer case in `model.ts`), one wire away from coming back the
 * day the restaurant wants ordering again, but nothing in this file routes a
 * guest to any of them. `CatalogScreen` is the whole app; admin access is a
 * tap-sequence on its title, handled by `useKiosk`, not a screen of its own.
 */
export function App() {
  const { state, dispatch } = useCustomerState();
  const { data: catalog, usingBundledMenu } = useCatalog();
  const queryClient = useQueryClient();
  const handleAdminTap = useKiosk();
  useMenuTheme(catalog.theme);

  useEffect(() => restaurantApi.connect((message: RealtimeEnvelope) => {
    if (message.type === "catalog.changed") void queryClient.invalidateQueries({ queryKey: ["catalog"] });
  }), [queryClient]);

  return <main className="app-shell">
    <CatalogScreen state={state} dispatch={dispatch} products={catalog.products} offlineMenu={usingBundledMenu} onAdminTap={handleAdminTap} />
  </main>;
}

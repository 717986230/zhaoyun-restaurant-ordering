import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ApiOrder, RealtimeEnvelope } from "@zhaoyun/contracts";
import type { OrderStatus } from "@zhaoyun/domain";
import { ApiError } from "@zhaoyun/api-client";
import { restaurantApi } from "./api";
import { useCatalog } from "./useCatalog";
import { useCustomerState } from "./model";
import { CatalogScreen } from "../features/catalog/CatalogScreen";
import { CartScreen } from "../features/cart/CartScreen";
import { OrdersScreen } from "../features/orders/OrdersScreen";
import { ServiceScreen } from "../features/service/ServiceScreen";
import { StaffScreen } from "../features/staff/StaffScreen";
import { useKiosk } from "../features/kiosk/useKiosk";
import { t } from "./i18n";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

function HomeScreen({ onAdminTap, dispatch, language, table }: { onAdminTap: () => Promise<void>; dispatch: ReturnType<typeof useCustomerState>["dispatch"]; language: "zh" | "de" | "en"; table: string }) {
  return <section id="home" className="screen home active">
    <button className="brand brand-button" onClick={() => void onAdminTap()}><small>ZHAO YUN RESTAURANT</small><h1>赵云</h1><p>{t(language, "table")} {table}</p></button>
    <div className="home-actions">
      <button className="home-btn" onClick={() => dispatch({ type: "navigate", screen: "menu" })}><span>01</span><b>{t(language, "start")}</b><small>SPEISEKARTE</small></button>
      <button className="home-btn" onClick={() => dispatch({ type: "navigate", screen: "orders" })}><span>02</span><b>{t(language, "orders")}</b><small>MEINE BESTELLUNG</small></button>
      <button className="home-btn" onClick={() => dispatch({ type: "navigate", screen: "service" })}><span>03</span><b>{t(language, "service")}</b><small>SERVICE RUFEN</small></button>
      <button className="home-btn staff-link" onClick={() => dispatch({ type: "navigate", screen: "staff" })}><span>04</span><b>{t(language, "staff")}</b><small>MITARBEITER</small></button>
    </div>
    <LanguageSwitcher language={language} dispatch={dispatch} />
  </section>;
}

export function App() {
  const { state, dispatch } = useCustomerState();
  const { data: products } = useCatalog();
  const queryClient = useQueryClient();
  const handleAdminTap = useKiosk();
  const syncingOrders = useRef(new Set<string>());

  useEffect(() => {
    let stopped = false;
    const syncPendingOrders = async () => {
      if (!navigator.onLine || stopped) return;
      const now = Date.now();
      for (const pending of Object.values(state.pendingOrders)) {
        if (pending.nextAttemptAt > now || syncingOrders.current.has(pending.command.clientRequestId)) continue;
        syncingOrders.current.add(pending.command.clientRequestId);
        try {
          const { order } = await restaurantApi.createOrder(pending.command);
          dispatch({ type: "order-status", orderId: order.id, clientRequestId: order.clientRequestId, status: order.status as OrderStatus, totalCents: Math.round(order.total * 100) });
          dispatch({ type: "order-synced", clientRequestId: pending.command.clientRequestId });
        } catch (error) {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) dispatch({ type: "order-synced", clientRequestId: pending.command.clientRequestId });
          else dispatch({ type: "order-retry-scheduled", clientRequestId: pending.command.clientRequestId });
        } finally {
          syncingOrders.current.delete(pending.command.clientRequestId);
        }
      }
    };
    void syncPendingOrders();
    const timer = window.setInterval(() => void syncPendingOrders(), 5_000);
    window.addEventListener("online", syncPendingOrders);
    return () => { stopped = true; window.clearInterval(timer); window.removeEventListener("online", syncPendingOrders); };
  }, [dispatch, state.pendingOrders]);

  useEffect(() => restaurantApi.connect((message: RealtimeEnvelope) => {
    if (message.type === "catalog.changed") void queryClient.invalidateQueries({ queryKey: ["catalog"] });
    if (message.type === "order.changed" && message.payload) {
      const order = message.payload as ApiOrder;
      dispatch({ type: "order-status", orderId: order.id, clientRequestId: order.clientRequestId, status: order.status as OrderStatus, totalCents: Math.round(order.total * 100) });
    }
  }), [dispatch, queryClient]);

  return <>
    <main className="app-shell">
      {state.screen === "home" && <HomeScreen onAdminTap={handleAdminTap} dispatch={dispatch} language={state.language} table={state.table} />}
      {state.screen === "menu" && <CatalogScreen state={state} dispatch={dispatch} products={products} />}
      {state.screen === "cart" && <CartScreen state={state} dispatch={dispatch} products={products} />}
      {state.screen === "orders" && <OrdersScreen orders={state.orders} products={products} dispatch={dispatch} language={state.language} />}
      {state.screen === "service" && <ServiceScreen state={state} dispatch={dispatch} />}
      {state.screen === "staff" && <StaffScreen state={state} products={products} dispatch={dispatch} />}
    </main>
    <div id="toast" className={`toast ${state.toast ? "show" : ""}`} role="status">{state.toast}</div>
  </>;
}

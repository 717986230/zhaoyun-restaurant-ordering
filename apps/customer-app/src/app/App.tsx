import { useEffect, useRef, useState } from "react";
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
import { setTableNo, tableIdentity } from "./table";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

function HomeScreen({ onAdminTap, dispatch, language }: { onAdminTap: () => Promise<void>; dispatch: ReturnType<typeof useCustomerState>["dispatch"]; language: "zh" | "de" | "en" }) {
  const [table, setTable] = useState(tableIdentity);

  function changeTable() {
    const input = window.prompt(t(language, "tablePrompt"), table.tableNo);
    if (input === null) return;
    const saved = setTableNo(input);
    if (!saved) {
      window.alert(t(language, "tableInvalid"));
      return;
    }
    setTable((current) => ({ ...current, tableNo: saved, configured: true }));
  }

  return <section id="home" className="screen home active">
    <button className="brand brand-button" onClick={() => void onAdminTap()}><small>ZHAO YUN RESTAURANT</small><h1>赵云</h1><p>{t(language, "table")} {table.tableNo}</p></button>
    {/* A table that arrived from a scanned card needs no setting, so the control
        only appears when the device has not been told which table it is. */}
    {!table.configured && <div className="table-setup"><button className="table-button unset" onClick={changeTable}>{t(language, "setTable")} · {table.tableNo}</button><small>{t(language, "tableUnset")}</small></div>}
    <div className="home-actions">
      <button className="home-btn home-lead" onClick={() => dispatch({ type: "navigate", screen: "menu" })}><b>{t(language, "start")}</b><small>SPEISEKARTE</small></button>
      <div className="home-secondary">
        <button className="home-btn" onClick={() => dispatch({ type: "navigate", screen: "service" })}><b>{t(language, "service")}</b><small>SERVICE RUFEN</small></button>
        <button className="home-btn" onClick={() => dispatch({ type: "navigate", screen: "orders" })}><b>{t(language, "orders")}</b><small>MEINE BESTELLUNG</small></button>
      </div>
      {/* Staff still need this, guests never do: same control, no longer
          competing with the two things a guest came here to do. */}
      <button className="staff-link" onClick={() => dispatch({ type: "navigate", screen: "staff" })}>{t(language, "staff")}</button>
    </div>
    <LanguageSwitcher language={language} dispatch={dispatch} />
  </section>;
}

export function App() {
  const { state, dispatch } = useCustomerState();
  const { data: products, usingBundledMenu } = useCatalog();
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
      {state.screen === "home" && <HomeScreen onAdminTap={handleAdminTap} dispatch={dispatch} language={state.language} />}
      {state.screen === "menu" && <CatalogScreen state={state} dispatch={dispatch} products={products} offlineMenu={usingBundledMenu} />}
      {state.screen === "cart" && <CartScreen state={state} dispatch={dispatch} products={products} />}
      {state.screen === "orders" && <OrdersScreen orders={state.orders} products={products} dispatch={dispatch} language={state.language} />}
      {state.screen === "service" && <ServiceScreen state={state} dispatch={dispatch} />}
      {state.screen === "staff" && <StaffScreen state={state} products={products} dispatch={dispatch} />}
    </main>
    <div id="toast" className={`toast ${state.toast ? "show" : ""}`} role="status">{state.toast}</div>
  </>;
}

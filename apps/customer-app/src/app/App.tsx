import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ApiOrder, RealtimeEnvelope } from "@zhaoyun/contracts";
import type { OrderStatus } from "@zhaoyun/domain";
import { restaurantApi } from "./api";
import { useCatalog } from "./useCatalog";
import { useCustomerState } from "./model";
import { CatalogScreen } from "../features/catalog/CatalogScreen";
import { CartScreen } from "../features/cart/CartScreen";
import { OrdersScreen } from "../features/orders/OrdersScreen";
import { ServiceScreen } from "../features/service/ServiceScreen";
import { StaffScreen } from "../features/staff/StaffScreen";
import { useKiosk } from "../features/kiosk/useKiosk";

function HomeScreen({ onAdminTap, dispatch }: { onAdminTap: () => Promise<void>; dispatch: ReturnType<typeof useCustomerState>["dispatch"] }) {
  return <section id="home" className="screen home active">
    <button className="brand brand-button" onClick={() => void onAdminTap()}><small>ZHAO YUN RESTAURANT</small><h1>赵云</h1><p>Tisch 08 · 08号桌</p></button>
    <div className="home-actions">
      <button className="home-btn" onClick={() => dispatch({ type: "navigate", screen: "menu" })}><span>01</span><b>开始点餐</b><small>SPEISEKARTE</small></button>
      <button className="home-btn" onClick={() => dispatch({ type: "navigate", screen: "orders" })}><span>02</span><b>订单状态</b><small>MEINE BESTELLUNG</small></button>
      <button className="home-btn" onClick={() => dispatch({ type: "navigate", screen: "service" })}><span>03</span><b>呼叫服务员</b><small>SERVICE RUFEN</small></button>
      <button className="home-btn staff-link" onClick={() => dispatch({ type: "navigate", screen: "staff" })}><span>04</span><b>员工看板</b><small>MITARBEITER</small></button>
    </div>
    <div className="langs"><button onClick={() => dispatch({ type: "language", language: "zh" })}>中文</button><button onClick={() => dispatch({ type: "language", language: "de" })}>Deutsch</button><button onClick={() => dispatch({ type: "language", language: "en" })}>English</button></div>
  </section>;
}

export function App() {
  const { state, dispatch } = useCustomerState();
  const { data: products } = useCatalog();
  const queryClient = useQueryClient();
  const handleAdminTap = useKiosk();

  useEffect(() => restaurantApi.connect((message: RealtimeEnvelope) => {
    if (message.type === "catalog.changed") void queryClient.invalidateQueries({ queryKey: ["catalog"] });
    if (message.type === "order.changed" && message.payload) {
      const order = message.payload as ApiOrder;
      dispatch({ type: "order-status", orderId: order.id, clientRequestId: order.clientRequestId, status: order.status as OrderStatus, totalCents: Math.round(order.total * 100) });
    }
  }), [dispatch, queryClient]);

  return <>
    <main className="app-shell">
      {state.screen === "home" && <HomeScreen onAdminTap={handleAdminTap} dispatch={dispatch} />}
      {state.screen === "menu" && <CatalogScreen state={state} dispatch={dispatch} products={products} />}
      {state.screen === "cart" && <CartScreen state={state} dispatch={dispatch} products={products} />}
      {state.screen === "orders" && <OrdersScreen orders={state.orders} products={products} dispatch={dispatch} />}
      {state.screen === "service" && <ServiceScreen state={state} dispatch={dispatch} />}
      {state.screen === "staff" && <StaffScreen state={state} products={products} dispatch={dispatch} />}
    </main>
    <div id="toast" className={`toast ${state.toast ? "show" : ""}`} role="status">{state.toast}</div>
  </>;
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminApi } from "@zhaoyun/api-client";
import type { AdminProductInput, AdminStorage } from "@zhaoyun/api-client";
import type { ApiCatalogProduct, ApiOrder, ApiServiceRequest, RealtimeEnvelope } from "@zhaoyun/contracts";
import type { PrinterProfile, Product } from "@zhaoyun/domain";
import { kiosk, printer as nativePrinter } from "@zhaoyun/native-bridge";
import type { AdminState, AdminTab, ProductFilter } from "./types";
import { CatalogPanel } from "../features/catalog/CatalogPanel";
import { OrdersPanel } from "../features/orders/OrdersPanel";
import { PrintersPanel } from "../features/printers/PrintersPanel";
import { SettingsPanel } from "../features/settings/SettingsPanel";

const adminApi = new AdminApi();

function mapProduct(product: ApiCatalogProduct): Product {
  return {
    id: String(product.id), sku: product.sku, kind: product.kind, category: product.category,
    names: product.names, description: product.description, priceCents: Math.round(product.price * 100),
    allergens: product.allergens, details: product.details, appearance: product.appearance, modifiers: product.modifiers ?? [],
    media: (product.media ?? []).map((media) => ({
      ...(media.id ? { id: media.id } : {}), type: media.type, url: media.url,
      ...(media.posterUrl !== undefined ? { posterUrl: media.posterUrl } : {}),
      ...(media.sortOrder !== undefined ? { sortOrder: media.sortOrder } : {})
    })),
    available: product.available ?? true, published: product.published ?? true,
    printStation: product.printStation ?? (product.kind === "drink" ? "bar" : product.kind === "sushi" ? "sushi" : "kitchen")
  };
}

const initialState: AdminState = {
  tab: "orders", connected: false, connectionText: "未连接", products: [], orders: [], requests: [],
  busyId: null, printers: [], discoveredPrinters: [], editingProduct: null, editingPrinter: null,
  productFilter: "all", toast: null
};

export function App() {
  const [state, setState] = useState(initialState);
  const storage = useMemo(() => adminApi.storage, [state.connected, state.tab]);

  const notify = useCallback((message: string, kind: "success" | "warning" | "error" = "success") => {
    setState((current) => ({ ...current, toast: { message, kind } }));
    window.setTimeout(() => setState((current) => ({ ...current, toast: null })), 2400);
  }, []);

  const loadBoard = useCallback(async () => {
    try {
      const [{ orders }, { requests }] = await Promise.all([adminApi.orders(), adminApi.serviceRequests()]);
      setState((current) => ({ ...current, orders, requests }));
    } catch { /* The connection banner already reports an unreachable server. */ }
  }, []);

  const connect = useCallback(async () => {
    try {
      await adminApi.health();
      const [{ products }, { printers }, { orders }, { requests }] = await Promise.all([
        adminApi.products(), adminApi.printers(), adminApi.orders(), adminApi.serviceRequests()
      ]);
      setState((current) => ({ ...current, connected: true, connectionText: "服务器在线", products: products.map(mapProduct), printers, orders, requests }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "连接失败";
      setState((current) => ({ ...current, connected: false, connectionText: message, ...(!adminApi.storage.token ? { tab: "system" as const } : {}) }));
    }
  }, []);

  useEffect(() => { void connect(); }, [connect]);

  useEffect(() => adminApi.connect((message: RealtimeEnvelope) => {
    if (message.type === "order.changed" || message.type === "service.changed") void loadBoard();
  }), [loadBoard]);

  async function updateOrderStatus(id: string, status: ApiOrder["status"]) {
    setState((current) => ({ ...current, busyId: id }));
    try {
      const { order } = await adminApi.updateOrderStatus(id, status);
      setState((current) => ({ ...current, busyId: null, orders: current.orders.map((row) => row.id === order.id ? order : row) }));
    } catch (error) {
      setState((current) => ({ ...current, busyId: null }));
      notify(error instanceof Error ? error.message : "更新订单状态失败", "error");
    }
  }

  async function updateRequestStatus(id: string, status: ApiServiceRequest["status"]) {
    setState((current) => ({ ...current, busyId: id }));
    try {
      const { request } = await adminApi.updateServiceRequestStatus(id, status);
      setState((current) => ({ ...current, busyId: null, requests: current.requests.map((row) => row.id === request.id ? request : row) }));
    } catch (error) {
      setState((current) => ({ ...current, busyId: null }));
      notify(error instanceof Error ? error.message : "更新服务呼叫失败", "error");
    }
  }

  async function saveProduct(input: AdminProductInput, id: string | null, media: File | null) {
    try {
      const result = id ? await adminApi.updateProduct(id, input) : await adminApi.createProduct(input);
      if (media) await adminApi.uploadMedia(result.product.id, media);
      setState((current) => ({ ...current, editingProduct: null }));
      await connect();
      notify("商品已保存");
    } catch (error) { notify(error instanceof Error ? error.message : "保存失败", "error"); }
  }

  async function deleteProduct(id: string) {
    try { await adminApi.deleteProduct(id); setState((current) => ({ ...current, editingProduct: null })); await connect(); notify("商品已删除"); }
    catch (error) { notify(error instanceof Error ? error.message : "删除失败", "error"); }
  }

  async function discoverPrinters() {
    if (!nativePrinter.isNative()) { notify("周围设备搜索需要在 Android App 内运行；网页端可手动填写 IP", "warning"); return; }
    try {
      const { devices } = await nativePrinter.plugin.discover();
      setState((current) => ({ ...current, discoveredPrinters: devices }));
      notify(`发现 ${devices.length} 台设备`);
    } catch (error) { notify(error instanceof Error ? error.message : "搜索失败", "error"); }
  }

  async function savePrinter(profile: Omit<PrinterProfile, "id">, id: string | null) {
    try {
      if (id) await adminApi.updatePrinter(id, profile); else await adminApi.createPrinter(profile);
      setState((current) => ({ ...current, editingPrinter: null }));
      await connect();
      notify("打印机配置已保存");
    } catch (error) { notify(error instanceof Error ? error.message : "保存失败", "error"); }
  }

  async function testPrinter(profile: PrinterProfile) {
    if (!nativePrinter.isNative()) { notify("测试打印需要在 Android App 内运行", "warning"); return; }
    try { await nativePrinter.plugin.testPrint(profile); notify("测试页已发送"); }
    catch (error) { notify(error instanceof Error ? error.message : "测试打印失败", "error"); }
  }

  async function saveConnection(nextStorage: AdminStorage) {
    adminApi.configure(nextStorage);
    await connect();
    notify("连接设置已保存");
  }

  async function returnToApp() {
    if (kiosk.isNative()) { try { await kiosk.plugin.lock(); } catch { /* Navigation remains available in test mode. */ } }
    window.location.href = "index.html";
  }

  function setTab(tab: AdminTab) { setState((current) => ({ ...current, tab })); }

  return <><div className="admin-shell">
    <header className="admin-head"><div><strong>赵云餐厅管理台</strong><small>ZHAO YUN OPERATIONS</small></div><div className="admin-head-actions"><div className="connection"><i className={state.connected ? "online" : ""} /><span>{state.connectionText}</span></div><button onClick={() => void returnToApp()}>返回点餐</button></div></header>
    <nav className="admin-tabs" aria-label="管理模块"><button className={state.tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}>订单看板</button><button className={state.tab === "catalog" ? "active" : ""} onClick={() => setTab("catalog")}>商品与媒体</button><button className={state.tab === "printers" ? "active" : ""} onClick={() => setTab("printers")}>打印机</button><button className={state.tab === "system" ? "active" : ""} onClick={() => setTab("system")}>连接设置</button></nav>
    <main>
      {state.tab === "orders" && <OrdersPanel orders={state.orders} requests={state.requests} busyId={state.busyId} onOrderStatus={updateOrderStatus} onRequestStatus={updateRequestStatus} onRefresh={loadBoard} />}
      {state.tab === "catalog" && <CatalogPanel products={state.products} editing={state.editingProduct} filter={state.productFilter} mediaUrl={(path) => adminApi.mediaUrl(path)} onFilter={(productFilter: ProductFilter) => setState((current) => ({ ...current, productFilter }))} onEdit={(editingProduct) => setState((current) => ({ ...current, editingProduct }))} onSave={saveProduct} onDelete={deleteProduct} onRefresh={connect} />}
      {state.tab === "printers" && <PrintersPanel printers={state.printers} discovered={state.discoveredPrinters} editing={state.editingPrinter} onEdit={(editingPrinter) => setState((current) => ({ ...current, editingPrinter }))} onDiscover={discoverPrinters} onSave={savePrinter} onTest={testPrinter} />}
      {state.tab === "system" && <SettingsPanel storage={storage} onSave={saveConnection} />}
    </main>
  </div><div id="adminToast" className={`admin-toast ${state.toast ? "show" : ""} ${state.toast?.kind ?? ""}`} role="status">{state.toast?.message ?? ""}</div></>;
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminApi } from "@zhaoyun/api-client";
import type { AdminProductInput, AdminStorage, StaffRole } from "@zhaoyun/api-client";
import type { ApiCatalogProduct, ApiOrder, ApiServiceRequest, MenuThemeId } from "@zhaoyun/contracts";
import type { PrinterProfile, Product } from "@zhaoyun/domain";
import { kiosk, printer as nativePrinter } from "@zhaoyun/native-bridge";
import type { AdminState, AdminTab, ProductFilter } from "./types";
import { GatePanel } from "../features/gate/GatePanel";
import { BoardPanel } from "../features/board/BoardPanel";
import { TablesPanel } from "../features/tables/TablesPanel";
import { CatalogPanel } from "../features/catalog/CatalogPanel";
import { PrintersPanel } from "../features/printers/PrintersPanel";
import { SettingsPanel } from "../features/settings/SettingsPanel";

const adminApi = new AdminApi();

function mapProduct(product: ApiCatalogProduct): Product {
  return {
    id: String(product.id), sku: product.sku, kind: product.kind, category: product.category,
    names: product.names, description: product.description, priceCents: Math.round(product.price * 100),
    vatPercent: product.vatPercent ?? (product.kind === "drink" ? 20 : 10),
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
  tab: "catalog", role: null,
  gate: { checking: true, configured: false, busy: false, error: null, reachable: true },
  auditEntries: [],
  connected: false, connectionText: "未连接", products: [], printers: [],
  orders: [], requests: [], failedJobs: [], bill: null, tables: [], tableOverview: [], boardBusy: false,
  discoveredPrinters: [], editingProduct: null, editingPrinter: null, productFilter: "all", menuTheme: null, toast: null
};

const BOARD_REFRESH_MS = 5000;

// The waiter tablet and the kitchen screen open the same console; the role
// decides which of it exists at all, so nobody is offered a 403.
const TABS_BY_ROLE: Record<StaffRole, AdminTab[]> = {
  manager: ["catalog", "board", "tables", "printers", "system"],
  staff: ["board", "tables"],
  kitchen: ["board"]
};

const ROLE_LABELS: Record<StaffRole, string> = { manager: "经理", staff: "服务员", kitchen: "厨房" };

const TAB_LABELS: Record<AdminTab, string> = {
  catalog: "商品与媒体",
  board: "订单看板",
  tables: "桌位",
  printers: "打印机",
  system: "连接设置"
};

export function App() {
  const [state, setState] = useState(initialState);
  // The board polls on an interval; keeping the role in a ref avoids rebuilding
  // that callback (and restarting the timer) on every reconnect.
  const roleRef = useRef<StaffRole | null>(null);
  const storage = useMemo(() => adminApi.storage, [state.connected, state.tab]);

  const notify = useCallback((message: string, kind: "success" | "warning" | "error" = "success") => {
    setState((current) => ({ ...current, toast: { message, kind } }));
    window.setTimeout(() => setState((current) => ({ ...current, toast: null })), 2400);
  }, []);

  /** True when the console is through and loaded; false when whatever is in
   *  the header did not open the door. */
  const connect = useCallback(async (): Promise<boolean> => {
    try {
      await adminApi.health();
      const { role } = await adminApi.session();
      roleRef.current = role;
      const manager = role === "manager";
      const [catalog, printerList, settings] = manager
        ? await Promise.all([adminApi.products(), adminApi.printers(), adminApi.settings()])
        : [{ products: [] }, { printers: [] }, null];
      setState((current) => ({
        ...current,
        role,
        connected: true,
        connectionText: `服务器在线 · ${ROLE_LABELS[role]}`,
        products: catalog.products.map(mapProduct),
        printers: printerList.printers,
        menuTheme: settings?.menuTheme ?? current.menuTheme,
        tab: TABS_BY_ROLE[role].includes(current.tab) ? current.tab : TABS_BY_ROLE[role][0] ?? "board"
      }));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "连接失败";
      setState((current) => ({ ...current, role: null, connected: false, connectionText: message }));
      return false;
    }
  }, []);

  const loadBoard = useCallback(async (silent = false) => {
    if (!adminApi.storage.token) return;
    try {
      const { orders } = await adminApi.orders();
      // The kitchen screen may only read orders; asking for the rest would 403.
      const floor = roleRef.current === "kitchen"
        ? { requests: [], jobs: [], tables: [] }
        : await Promise.all([adminApi.serviceRequests(), adminApi.printJobs("failed"), adminApi.tableOverview()])
          .then(([a, b, c]) => ({ requests: a.requests, jobs: b.jobs, tables: c.tables }));
      setState((current) => ({ ...current, orders, requests: floor.requests, failedJobs: floor.jobs, tableOverview: floor.tables }));
    } catch (error) {
      if (!silent) notify(error instanceof Error ? error.message : "看板加载失败", "error");
    }
  }, [notify]);

  /**
   * Ask the door before drawing anything.
   *
   * A token already in the header gets first go — that is a session from
   * earlier in this browser tab, or an ADMIN_TOKEN somebody configured on the
   * connection tab, and either way there is nothing to ask. Only when it does
   * not open the door does the gate appear.
   *
   * If the gate itself is unreachable the console falls back to the connection
   * tab, because then the problem is the address, not the password.
   */
  useEffect(() => {
    void (async () => {
      if (adminApi.storage.token && await connect()) {
        setState((current) => ({ ...current, gate: { ...current.gate, checking: false, configured: true } }));
        return;
      }
      try {
        const { configured } = await adminApi.gate();
        setState((current) => ({ ...current, gate: { checking: false, configured, busy: false, error: null, reachable: true } }));
      } catch (error) {
        setState((current) => ({
          ...current,
          tab: "system",
          connectionText: error instanceof Error ? error.message : "连接失败",
          gate: { ...current.gate, checking: false, reachable: false }
        }));
      }
    })();
  }, [connect]);

  /** Both doors end the same way: keep the token, then load the console. */
  const enterWith = useCallback(async (open: () => Promise<{ token: string }>) => {
    setState((current) => ({ ...current, gate: { ...current.gate, busy: true, error: null } }));
    try {
      const { token } = await open();
      adminApi.remember(token);
      const entered = await connect();
      setState((current) => ({
        ...current,
        gate: { ...current.gate, checking: false, configured: true, busy: false, error: entered ? null : current.connectionText }
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        gate: { ...current.gate, busy: false, error: error instanceof Error ? error.message : "登录失败" }
      }));
    }
  }, [connect]);

  const signIn = useCallback((password: string) => enterWith(() => adminApi.signIn(password)), [enterWith]);

  // Setting the first password does not sign anyone in by itself, so the
  // console immediately spends it on a session rather than asking for it twice.
  const setFirstPassword = useCallback((password: string) => enterWith(async () => {
    await adminApi.setPassword(password);
    return adminApi.signIn(password);
  }), [enterWith]);

  const signOut = useCallback(async () => {
    try { await adminApi.signOut(); } catch { /* Leaving is not something to fail at. */ }
    adminApi.forget();
    setState((current) => ({
      ...initialState,
      gate: { checking: false, configured: current.gate.configured, busy: false, error: null, reachable: true }
    }));
  }, []);

  const loadTables = useCallback(async () => {
    if (!adminApi.storage.token) return;
    try {
      const [{ tables }, { entries }] = await Promise.all([adminApi.tables(), adminApi.audit(50)]);
      setState((current) => ({ ...current, tables, auditEntries: entries }));
    } catch {
      /* The connection form stays usable while the server is unreachable. */
    }
  }, []);

  useEffect(() => {
    if (state.tab !== "system") return;
    void loadTables();
  }, [state.tab, loadTables]);

  useEffect(() => {
    if (state.tab !== "board" && state.tab !== "tables") return undefined;
    void loadBoard();
    const timer = window.setInterval(() => void loadBoard(true), BOARD_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [state.tab, loadBoard]);

  async function runBoardAction(action: () => Promise<unknown>, message: string) {
    setState((current) => ({ ...current, boardBusy: true }));
    try {
      await action();
      await loadBoard(true);
      notify(message);
    } catch (error) {
      notify(error instanceof Error ? error.message : "操作失败", "error");
    } finally {
      setState((current) => ({ ...current, boardBusy: false }));
    }
  }

  async function lockTable(table: string, locked: boolean) {
    await runBoardAction(() => adminApi.setTableLock(table, locked), locked ? `桌 ${table} 已锁定，暂不接受新订单` : `桌 ${table} 已解除锁定`);
  }

  async function openBill(table: string) {
    try {
      const { bill } = await adminApi.bill(table);
      setState((current) => ({ ...current, bill }));
    } catch (error) { notify(error instanceof Error ? error.message : "账单加载失败", "error"); }
  }

  async function settleBill(table: string) {
    setState((current) => ({ ...current, boardBusy: true }));
    try {
      const { bill } = await adminApi.settleBill(table);
      setState((current) => ({ ...current, bill: null }));
      await loadBoard(true);
      notify(`桌 ${table} 已结账 EUR ${bill.total.toFixed(2)}，账单已送前台打印，桌位已释放`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "结账失败", "error");
    } finally {
      setState((current) => ({ ...current, boardBusy: false }));
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

  async function saveMenuTheme(menuTheme: MenuThemeId) {
    try {
      const settings = await adminApi.updateSettings(menuTheme);
      setState((current) => ({ ...current, menuTheme: settings.menuTheme }));
      notify("菜单样式已更新");
    } catch (error) { notify(error instanceof Error ? error.message : "保存失败", "error"); }
  }

  /** Changing the password ends every session opened with the old one — this
   *  one included, so the console signs itself back in with the new one. */
  async function changePassword(password: string, currentPassword: string) {
    try {
      await adminApi.setPassword(password, currentPassword);
      const { token } = await adminApi.signIn(password);
      adminApi.remember(token);
      notify("管理密码已修改，其他设备需要重新登录");
    } catch (error) { notify(error instanceof Error ? error.message : "修改密码失败", "error"); }
  }

  async function saveConnection(nextStorage: AdminStorage) {
    adminApi.configure(nextStorage);
    await connect();
    await loadTables();
    notify("连接设置已保存");
  }

  async function saveTable(input: { table: string; label?: string; rotateToken?: boolean }) {
    try {
      await adminApi.saveTable(input);
      await loadTables();
      notify(input.rotateToken ? "桌台令牌已更换，请重新分发入口链接" : "桌台已登记");
    } catch (error) { notify(error instanceof Error ? error.message : "桌台保存失败", "error"); }
  }

  async function deleteTable(table: string) {
    try {
      await adminApi.deleteTable(table);
      await loadTables();
      notify("桌台已删除");
    } catch (error) { notify(error instanceof Error ? error.message : "删除失败", "error"); }
  }

  async function returnToApp() {
    if (kiosk.isNative()) { try { await kiosk.plugin.lock(); } catch { /* Navigation remains available in test mode. */ } }
    window.location.href = "index.html";
  }

  function setTab(tab: AdminTab) { setState((current) => ({ ...current, tab })); }

  // The gate stands in front of everything, and nothing behind it is rendered
  // — not even the tab strip, which is what a hidden tab would be.
  if (state.gate.checking) {
    return <div className="admin-shell gate-shell"><p className="gate-note">正在连接…</p></div>;
  }
  if (!state.role && state.gate.reachable) {
    return <div className="admin-shell gate-shell"><GatePanel
      configured={state.gate.configured}
      busy={state.gate.busy}
      error={state.gate.error}
      onSignIn={signIn}
      onSetPassword={setFirstPassword}
    /></div>;
  }

  return <><div className="admin-shell">
    <header className="admin-head"><div><strong>赵云餐厅管理台</strong><small>ZHAO YUN OPERATIONS</small></div><div className="admin-head-actions"><div className="connection"><i className={state.connected ? "online" : ""} /><span>{state.connectionText}</span></div><button onClick={() => void returnToApp()}>返回点餐</button><button onClick={() => void signOut()}>退出</button></div></header>
    <nav className="admin-tabs" aria-label="管理模块">{(state.role ? TABS_BY_ROLE[state.role] : (["system"] as AdminTab[])).map((tab) => <button key={tab} className={state.tab === tab ? "active" : ""} onClick={() => setTab(tab)}>{TAB_LABELS[tab]}</button>)}</nav>
    <main>
      {state.tab === "catalog" && <CatalogPanel products={state.products} editing={state.editingProduct} filter={state.productFilter} mediaUrl={(path) => adminApi.mediaUrl(path)} onFilter={(productFilter: ProductFilter) => setState((current) => ({ ...current, productFilter }))} onEdit={(editingProduct) => setState((current) => ({ ...current, editingProduct }))} onSave={saveProduct} onDelete={deleteProduct} onRefresh={async () => { await connect(); }} />}
      {state.tab === "board" && <BoardPanel
        orders={state.orders}
        requests={state.requests}
        failedJobs={state.failedJobs}
        busy={state.boardBusy}
        onRefresh={() => loadBoard()}
        onOrderStatus={(id: string, status: ApiOrder["status"]) => runBoardAction(() => adminApi.updateOrderStatus(id, status), "订单状态已更新")}
        onRequestStatus={(id: string, status: ApiServiceRequest["status"]) => runBoardAction(() => adminApi.updateServiceRequestStatus(id, status), "服务呼叫已处理")}
        onRetryJob={(id: string) => runBoardAction(() => adminApi.retryPrintJob(id), "打印任务已重新排队")}
        role={state.role}
      />}
      {state.tab === "tables" && <TablesPanel
        tables={state.tableOverview}
        bill={state.bill}
        role={state.role}
        busy={state.boardBusy}
        onRefresh={() => loadBoard()}
        onLock={lockTable}
        onOpenBill={openBill}
        onCloseBill={() => setState((current) => ({ ...current, bill: null }))}
        onSettleBill={settleBill}
      />}
      {state.tab === "printers" && <PrintersPanel printers={state.printers} discovered={state.discoveredPrinters} editing={state.editingPrinter} onEdit={(editingPrinter) => setState((current) => ({ ...current, editingPrinter }))} onDiscover={discoverPrinters} onSave={savePrinter} onTest={testPrinter} />}
      {state.tab === "system" && <SettingsPanel storage={storage} tables={state.tables} auditEntries={state.auditEntries} menuTheme={state.menuTheme} onSave={saveConnection} onSaveTable={saveTable} onDeleteTable={deleteTable} onSaveMenuTheme={saveMenuTheme} onChangePassword={changePassword} />}
    </main>
  </div><div id="adminToast" className={`admin-toast ${state.toast ? "show" : ""} ${state.toast?.kind ?? ""}`} role="status">{state.toast?.message ?? ""}</div></>;
}

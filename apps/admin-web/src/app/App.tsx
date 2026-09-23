import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminApi } from "@zhaoyun/api-client";
import type { AdminProductInput, AdminStorage, StaffRole } from "@zhaoyun/api-client";
import type { ApiCatalogProduct, ApiOrder, ApiServiceRequest, ApiSettings } from "@zhaoyun/contracts";
import type { PrinterProfile, Product } from "@zhaoyun/domain";
import { LANGUAGE_INFO } from "@zhaoyun/domain";
import { kiosk, printer as nativePrinter } from "@zhaoyun/native-bridge";
import type { AdminState, AdminTab, ProductFilter } from "./types";
import { ADMIN_LANGUAGES, useI18n } from "./i18n";
import type { CopyKey } from "./i18n";
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
  connected: false, connectionError: null, products: [], printers: [],
  orders: [], requests: [], failedJobs: [], bill: null, tables: [], tableOverview: [], boardBusy: false,
  discoveredPrinters: [], editingProduct: null, editingPrinter: null, productFilter: "all", settings: null, toast: null
};

const BOARD_REFRESH_MS = 5000;

/**
 * Which sections exist for whom. The waiter tablet and the kitchen screen
 * open the same console, and the role decides which of it exists at all, so
 * nobody is offered a 403. For the owner, orders, tables and printers only
 * appear once ordering is switched on: while the menu is view-only they would
 * be three empty screens.
 */
function tabsFor(role: StaffRole, showOrdering: boolean): AdminTab[] {
  if (role === "kitchen") return ["board"];
  if (role === "staff") return ["board", "tables"];
  return showOrdering ? ["catalog", "board", "tables", "printers", "system"] : ["catalog", "system"];
}

const TAB_KEYS: Record<AdminTab, CopyKey> = {
  catalog: "tabCatalog",
  board: "tabBoard",
  tables: "tabTables",
  printers: "tabPrinters",
  system: "tabSettings"
};

const ROLE_KEYS: Record<StaffRole, CopyKey> = { manager: "roleManager", staff: "roleStaff", kitchen: "roleKitchen" };

export function App() {
  const { t, language, setLanguage } = useI18n();
  const [state, setState] = useState(initialState);
  // The board polls on an interval; keeping the role in a ref avoids rebuilding
  // that callback (and restarting the timer) on every reconnect.
  const roleRef = useRef<StaffRole | null>(null);
  const storage = useMemo(() => adminApi.storage, [state.connected, state.tab]);
  const restaurantName = state.settings?.restaurantName ?? "";

  useEffect(() => {
    document.title = restaurantName ? `${restaurantName} · ${t("admin")}` : t("admin");
  }, [restaurantName, t]);

  const notify = useCallback((message: string, kind: "success" | "warning" | "error" = "success") => {
    setState((current) => ({ ...current, toast: { message, kind } }));
    window.setTimeout(() => setState((current) => ({ ...current, toast: null })), 2400);
  }, []);

  const failed = useCallback((error: unknown, fallback: CopyKey) => {
    notify(error instanceof Error && error.message ? error.message : t(fallback), "error");
  }, [notify, t]);

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
      setState((current) => {
        const tabs = tabsFor(role, settings?.showOrdering ?? false);
        return {
          ...current,
          role,
          connected: true,
          connectionError: null,
          products: catalog.products.map(mapProduct),
          printers: printerList.printers,
          settings: settings ?? current.settings,
          tab: tabs.includes(current.tab) ? current.tab : tabs[0] ?? "board"
        };
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : null;
      setState((current) => ({ ...current, role: null, connected: false, connectionError: message }));
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
      if (!silent) failed(error, "boardLoadFailed");
    }
  }, [failed]);

  /**
   * Ask the door before drawing anything.
   *
   * A token already in the header gets first go — that is a session from
   * earlier in this browser tab, or an ADMIN_TOKEN somebody configured on the
   * connection section, and either way there is nothing to ask. Only when it
   * does not open the door does the gate appear.
   *
   * If the gate itself is unreachable the console falls back to settings,
   * because then the problem is the address, not the password.
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
          connectionError: error instanceof Error ? error.message : null,
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
        gate: { ...current.gate, checking: false, configured: true, busy: false, error: entered ? null : current.connectionError }
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        gate: { ...current.gate, busy: false, error: error instanceof Error ? error.message : t("signInFailed") }
      }));
    }
  }, [connect, t]);

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
      failed(error, "genericFailed");
    } finally {
      setState((current) => ({ ...current, boardBusy: false }));
    }
  }

  async function lockTable(table: string, locked: boolean) {
    await runBoardAction(() => adminApi.setTableLock(table, locked), t(locked ? "tableLockedToast" : "tableUnlockedToast", { table }));
  }

  async function openBill(table: string) {
    try {
      const { bill } = await adminApi.bill(table);
      setState((current) => ({ ...current, bill }));
    } catch (error) { failed(error, "billLoadFailed"); }
  }

  async function settleBill(table: string) {
    setState((current) => ({ ...current, boardBusy: true }));
    try {
      const { bill } = await adminApi.settleBill(table);
      setState((current) => ({ ...current, bill: null }));
      await loadBoard(true);
      notify(t("billSettled", { table, total: bill.total.toFixed(2) }));
    } catch (error) {
      failed(error, "billSettleFailed");
    } finally {
      setState((current) => ({ ...current, boardBusy: false }));
    }
  }

  async function saveProduct(input: AdminProductInput, id: string | null, media: File | null): Promise<boolean> {
    try {
      const result = id ? await adminApi.updateProduct(id, input) : await adminApi.createProduct(input);
      if (media) await adminApi.uploadMedia(result.product.id, media);
      setState((current) => ({ ...current, editingProduct: null }));
      await connect();
      notify(t("productSaved"));
      return true;
    } catch (error) {
      failed(error, "saveFailed");
      return false;
    }
  }

  /** Copies a dish and opens the copy, so only what differs needs typing. */
  async function duplicateProduct(id: string) {
    try {
      const { product } = await adminApi.duplicateProduct(id);
      await connect();
      setState((current) => ({ ...current, editingProduct: mapProduct(product) }));
      notify(t("productDuplicated"));
    } catch (error) { failed(error, "saveFailed"); }
  }

  function toggleFeatured(id: string, on: boolean) {
    const current = state.settings?.featuredProductIds ?? [];
    const next = on ? [...current.filter((item) => item !== id), id] : current.filter((item) => item !== id);
    void saveSettings({ featuredProductIds: next }, on ? "featuredAdded" : "featuredRemoved");
  }

  async function deleteProduct(id: string) {
    try {
      await adminApi.deleteProduct(id);
      setState((current) => ({ ...current, editingProduct: null }));
      await connect();
      notify(t("productDeleted"));
    } catch (error) { failed(error, "deleteFailed"); }
  }

  async function discoverPrinters() {
    try {
      const { devices } = await nativePrinter.plugin.discover();
      setState((current) => ({ ...current, discoveredPrinters: devices }));
      notify(t("printersFoundToast", { count: devices.length }));
    } catch (error) { failed(error, "printersSearchFailed"); }
  }

  async function savePrinter(profile: Omit<PrinterProfile, "id">, id: string | null) {
    try {
      if (id) await adminApi.updatePrinter(id, profile); else await adminApi.createPrinter(profile);
      setState((current) => ({ ...current, editingPrinter: null }));
      await connect();
      notify(t("printerSaved"));
    } catch (error) { failed(error, "saveFailed"); }
  }

  async function testPrinter(profile: PrinterProfile) {
    try { await nativePrinter.plugin.testPrint(profile); notify(t("printerTestSent")); }
    catch (error) { failed(error, "printerTestFailed"); }
  }

  /**
   * Every setting saves the same way: shown at once, saved behind it. A
   * control works out its next value from what is on screen, so waiting for
   * the server before updating the screen meant a second tap during a save
   * was computed from the value before the first — which is how the language
   * toggles once saved a set of languages nobody chose.
   */
  async function saveSettings(change: Partial<ApiSettings>, done: CopyKey) {
    const before = state.settings;
    if (!before) return;
    const optimistic = { ...before, ...change };
    setState((current) => ({
      ...current,
      settings: current.settings ? { ...current.settings, ...change } : current.settings
    }));
    try {
      const saved = await adminApi.updateSettings(change);
      // Only adopt the server's answer for what this save touched, so a later
      // change already on screen is not rolled back by an earlier reply.
      setState((current) => {
        if (!current.settings) return current;
        const merged = { ...current.settings };
        for (const key of Object.keys(change) as Array<keyof ApiSettings>) {
          if (current.settings[key] === optimistic[key]) (merged as Record<string, unknown>)[key] = saved[key];
        }
        const tabs = current.role ? tabsFor(current.role, merged.showOrdering) : [];
        return { ...current, settings: merged, tab: current.role && !tabs.includes(current.tab) ? "system" : current.tab };
      });
      notify(t(done));
    } catch (error) {
      setState((current) => {
        if (!current.settings) return current;
        const reverted = { ...current.settings };
        for (const key of Object.keys(change) as Array<keyof ApiSettings>) {
          if (current.settings[key] === optimistic[key]) (reverted as Record<string, unknown>)[key] = before[key];
        }
        return { ...current, settings: reverted };
      });
      failed(error, "saveFailed");
    }
  }

  /** Changing the password ends every session opened with the old one — this
   *  one included, so the console signs itself back in with the new one. */
  async function changePassword(password: string, currentPassword: string): Promise<boolean> {
    try {
      await adminApi.setPassword(password, currentPassword);
      const { token } = await adminApi.signIn(password);
      adminApi.remember(token);
      notify(t("passwordChanged"));
      return true;
    } catch (error) {
      failed(error, "passwordChangeFailed");
      return false;
    }
  }

  async function saveConnection(nextStorage: AdminStorage) {
    adminApi.configure(nextStorage);
    await connect();
    await loadTables();
    notify(t("connectionSaved"));
  }

  async function saveTable(input: { table: string; label?: string; rotateToken?: boolean }): Promise<boolean> {
    try {
      await adminApi.saveTable(input);
      await loadTables();
      notify(t(input.rotateToken ? "tokenRotated" : "tableRegistered"));
      return true;
    } catch (error) {
      failed(error, "tableSaveFailed");
      return false;
    }
  }

  async function deleteTable(table: string) {
    try {
      await adminApi.deleteTable(table);
      await loadTables();
      notify(t("tableDeleted"));
    } catch (error) { failed(error, "deleteFailed"); }
  }

  async function openMenu() {
    if (kiosk.isNative()) { try { await kiosk.plugin.lock(); } catch { /* Navigation remains available in test mode. */ } }
    window.location.href = "index.html";
  }

  function setTab(tab: AdminTab) { setState((current) => ({ ...current, tab })); }

  const languagePicker = <div className="admin-languages" role="group" aria-label={t("language")}>{ADMIN_LANGUAGES.map((option) => <button
    key={option}
    type="button"
    className={option === language ? "on" : ""}
    aria-label={LANGUAGE_INFO[option].name}
    aria-pressed={option === language}
    onClick={() => setLanguage(option)}
  ><img src={LANGUAGE_INFO[option].flag} alt="" /></button>)}</div>;

  // The gate stands in front of everything, and nothing behind it is rendered
  // — not even the tab strip, which is what a hidden tab would be.
  if (state.gate.checking) {
    return <div className="admin-shell gate-shell"><p className="gate-note">{t("connecting")}</p></div>;
  }
  if (!state.role && state.gate.reachable) {
    return <div className="admin-shell gate-shell">
      <div className="gate-languages">{languagePicker}</div>
      <GatePanel
        configured={state.gate.configured}
        busy={state.gate.busy}
        error={state.gate.error}
        onSignIn={signIn}
        onSetPassword={setFirstPassword}
      />
    </div>;
  }

  const tabs = state.role ? tabsFor(state.role, state.settings?.showOrdering ?? false) : (["system"] as AdminTab[]);

  return <><div className="admin-shell">
    <header className="admin-head">
      <div className="admin-brand">
        <strong>{restaurantName || t("admin")}</strong>
        {state.role && <span className={`admin-role ${state.role}`}>{t(ROLE_KEYS[state.role])}</span>}
        <i className={`admin-status ${state.connected ? "online" : ""}`} title={t(state.connected ? "online" : "offline")} aria-label={t(state.connected ? "online" : "offline")} />
      </div>
      <div className="admin-head-actions">
        {languagePicker}
        <button className="head-action" onClick={() => void openMenu()} aria-label={t("openMenu")} title={t("openMenu")}><span aria-hidden="true">↗</span><em>{t("openMenu")}</em></button>
        {state.role && <button className="head-action" onClick={() => void signOut()} aria-label={t("signOut")} title={t("signOut")}><span aria-hidden="true">⏻</span><em>{t("signOut")}</em></button>}
      </div>
    </header>
    <nav className="admin-tabs" aria-label={t("modules")}>{tabs.map((tab) => <button key={tab} className={state.tab === tab ? "active" : ""} aria-current={state.tab === tab ? "page" : undefined} onClick={() => setTab(tab)}>{t(TAB_KEYS[tab])}</button>)}</nav>
    {!state.connected && state.connectionError && <p className="admin-banner" role="alert">{t("offline")} · {state.connectionError}</p>}
    <main>
      {state.tab === "catalog" && <CatalogPanel products={state.products} editing={state.editingProduct} filter={state.productFilter} mediaUrl={(path) => adminApi.mediaUrl(path)} onFilter={(productFilter: ProductFilter) => setState((current) => ({ ...current, productFilter }))} onEdit={(editingProduct) => setState((current) => ({ ...current, editingProduct }))} onSave={saveProduct} onDelete={deleteProduct} onDuplicate={duplicateProduct} featuredIds={state.settings?.featuredProductIds ?? []} onToggleFeatured={toggleFeatured} onRefresh={async () => { await connect(); }} />}
      {state.tab === "board" && <BoardPanel
        orders={state.orders}
        requests={state.requests}
        failedJobs={state.failedJobs}
        busy={state.boardBusy}
        onRefresh={() => loadBoard()}
        onOrderStatus={(id: string, status: ApiOrder["status"]) => runBoardAction(() => adminApi.updateOrderStatus(id, status), t("orderUpdated"))}
        onRequestStatus={(id: string, status: ApiServiceRequest["status"]) => runBoardAction(() => adminApi.updateServiceRequestStatus(id, status), t("callHandled"))}
        onRetryJob={(id: string) => runBoardAction(() => adminApi.retryPrintJob(id), t("jobRequeued"))}
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
      {state.tab === "printers" && <PrintersPanel printers={state.printers} discovered={state.discoveredPrinters} editing={state.editingPrinter} native={nativePrinter.isNative()} onEdit={(editingPrinter) => setState((current) => ({ ...current, editingPrinter }))} onDiscover={discoverPrinters} onSave={savePrinter} onTest={testPrinter} />}
      {state.tab === "system" && <SettingsPanel
        storage={storage}
        settings={state.settings}
        products={state.products}
        tables={state.tables}
        auditEntries={state.auditEntries}
        onSaveSettings={saveSettings}
        onSaveConnection={saveConnection}
        onSaveTable={saveTable}
        onDeleteTable={deleteTable}
        onChangePassword={changePassword}
      />}
    </main>
  </div><div id="adminToast" className={`admin-toast ${state.toast ? "show" : ""} ${state.toast?.kind ?? ""}`} role="status">{state.toast?.message ?? ""}</div></>;
}

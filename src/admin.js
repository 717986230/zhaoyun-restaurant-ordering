import { Capacitor, registerPlugin } from "@capacitor/core";
import { adminApi } from "./admin-api.js";
import "./admin.css";

const Printer = registerPlugin("Printer");
const Kiosk = registerPlugin("Kiosk");
const state = {
  products: [],
  printers: [],
  discoveredPrinters: [],
  productFilter: "all",
  editingProduct: null,
  editingPrinter: null,
  tab: "catalog"
};

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");
const euro = (value) => new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" }).format(value);

function notify(message, tone = "info") {
  const toast = $("#adminToast");
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.classList.add("show");
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function renderShell() {
  $("#adminApp").innerHTML = `
    <div class="admin-shell">
      <header class="admin-head">
        <div><strong>赵云餐厅管理台</strong><small>ZHAO YUN OPERATIONS</small></div>
        <div class="admin-head-actions">
          <div class="connection"><i id="connectionDot"></i><span id="connectionText">未连接</span></div>
          <button data-return-app>返回点餐</button>
        </div>
      </header>
      <nav class="admin-tabs" aria-label="管理模块">
        <button data-tab="catalog" class="active">商品与媒体</button>
        <button data-tab="printers">打印机</button>
        <button data-tab="system">连接设置</button>
      </nav>
      <main>
        <section id="catalogPanel" class="admin-panel active"></section>
        <section id="printersPanel" class="admin-panel"></section>
        <section id="systemPanel" class="admin-panel"></section>
      </main>
    </div>
    <div id="adminToast" class="admin-toast" role="status"></div>
  `;
}

function productForm(product = {}) {
  const names = product.names || {};
  const details = product.details || {};
  return `
    <form id="productForm" class="editor-form">
      <input type="hidden" name="id" value="${escapeHtml(product.id || "")}" />
      <div class="form-title"><div><h2>${product.id ? "编辑商品" : "新增商品"}</h2><p>菜品、酒水与寿司共用统一商品模型</p></div>${product.id ? `<button type="button" class="icon-action" data-new-product title="新建商品">＋</button>` : ""}</div>
      <div class="segmented">
        ${[["food", "菜品"], ["drink", "酒水"], ["sushi", "寿司"]].map(([value, label]) => `<label><input type="radio" name="kind" value="${value}" ${(product.kind || "food") === value ? "checked" : ""}><span>${label}</span></label>`).join("")}
      </div>
      <div class="field-grid">
        <label><span>SKU</span><input name="sku" value="${escapeHtml(product.sku || "")}" placeholder="自动生成"></label>
        <label><span>分类</span><input name="category" required value="${escapeHtml(product.category || "")}" placeholder="MAIN / WINE / NIGIRI"></label>
      </div>
      <label><span>中文名称</span><input name="nameZh" value="${escapeHtml(names.zh || "")}"></label>
      <label><span>德文名称</span><input name="nameDe" value="${escapeHtml(names.de || "")}"></label>
      <label><span>英文名称</span><input name="nameEn" value="${escapeHtml(names.en || "")}"></label>
      <label><span>简介</span><textarea name="description" rows="3">${escapeHtml(product.description || "")}</textarea></label>
      <div class="field-grid">
        <label><span>价格 EUR</span><input name="price" required type="number" min="0" step="0.01" value="${product.price ?? ""}"></label>
        <label><span>出单档口</span><select name="printStation">
          ${[["kitchen", "厨房"], ["bar", "吧台"], ["sushi", "寿司台"], ["front", "前台"]].map(([value, label]) => `<option value="${value}" ${product.printStation === value ? "selected" : ""}>${label}</option>`).join("")}
        </select></label>
      </div>
      <label><span>主要食材</span><input name="ingredients" value="${escapeHtml(details.ingredients || "")}"></label>
      <div class="field-grid three">
        <label><span>制作时间</span><input name="time" value="${escapeHtml(details.time || "")}"></label>
        <label><span>份量</span><input name="people" value="${escapeHtml(details.people || "")}"></label>
        <label><span>口味/难度</span><input name="level" value="${escapeHtml(details.level || "")}"></label>
      </div>
      <label><span>过敏原（逗号分隔）</span><input name="allergens" value="${escapeHtml((product.allergens || []).join(", "))}"></label>
      <label class="upload-zone"><input name="media" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"><b>选择图片或视频</b><small>JPEG、PNG、WebP、MP4、WebM，最大 50 MB</small></label>
      <div class="switch-row">
        <label><input type="checkbox" name="available" ${product.available !== false ? "checked" : ""}><span>可售</span></label>
        <label><input type="checkbox" name="published" ${product.published !== false ? "checked" : ""}><span>前台显示</span></label>
      </div>
      <button class="primary-action" type="submit">${product.id ? "保存修改" : "创建商品"}</button>
    </form>
  `;
}

function productRows() {
  const rows = state.products.filter((product) => state.productFilter === "all" || product.kind === state.productFilter);
  if (!rows.length) return `<div class="admin-empty">当前分类暂无商品</div>`;
  return rows.map((product) => {
    const media = product.media?.[0];
    const thumbnail = media?.type === "image"
      ? `<img src="${escapeHtml(`${adminApi.storage.baseUrl}${media.url}`)}" alt="">`
      : media?.type === "video" ? `<span class="media-mark">▶</span>` : `<span class="media-mark">${product.kind === "drink" ? "杯" : product.kind === "sushi" ? "鮨" : "菜"}</span>`;
    return `
      <button class="product-row ${state.editingProduct?.id === product.id ? "selected" : ""}" data-edit-product="${escapeHtml(product.id)}">
        <span class="product-thumb">${thumbnail}</span>
        <span class="product-copy"><b>${escapeHtml(product.names.zh || product.names.de || product.names.en)}</b><small>${escapeHtml(product.sku)} · ${escapeHtml(product.category)}</small></span>
        <span class="product-kind">${({ food: "菜品", drink: "酒水", sushi: "寿司" })[product.kind]}</span>
        <strong>${euro(product.price)}</strong>
        <i class="${product.published && product.available ? "live" : ""}" title="${product.published && product.available ? "已上架" : "未上架"}"></i>
      </button>
    `;
  }).join("");
}

function renderCatalog() {
  $("#catalogPanel").innerHTML = `
    <div class="catalog-layout">
      <aside class="editor-pane">${productForm(state.editingProduct || {})}</aside>
      <section class="list-pane">
        <header class="list-head"><div><h1>商品目录</h1><p>${state.products.length} 个商品</p></div><button class="icon-action" data-refresh title="刷新">↻</button></header>
        <div class="filter-tabs">
          ${[["all", "全部"], ["food", "菜品"], ["drink", "酒水"], ["sushi", "寿司"]].map(([value, label]) => `<button data-filter="${value}" class="${state.productFilter === value ? "active" : ""}">${label}</button>`).join("")}
        </div>
        <div class="product-list">${productRows()}</div>
        ${state.editingProduct ? `<button class="danger-action" data-delete-product="${escapeHtml(state.editingProduct.id)}">删除当前商品</button>` : ""}
      </section>
    </div>
  `;
}

function printerForm(printer = {}) {
  return `
    <form id="printerForm" class="editor-form compact-form">
      <input type="hidden" name="id" value="${escapeHtml(printer.id || "")}">
      <div class="form-title"><div><h2>${printer.id ? "编辑打印机" : "添加打印机"}</h2><p>按档口自动分配打印任务</p></div></div>
      <label><span>名称</span><input name="name" required value="${escapeHtml(printer.name || "")}" placeholder="厨房热菜打印机"></label>
      <div class="field-grid">
        <label><span>连接方式</span><select name="transport"><option value="lan">局域网</option><option value="bluetooth">蓝牙</option><option value="usb">USB</option></select></label>
        <label><span>负责档口</span><select name="role">
          ${[["kitchen", "厨房"], ["bar", "吧台"], ["sushi", "寿司台"], ["front", "前台"]].map(([value, label]) => `<option value="${value}" ${printer.role === value ? "selected" : ""}>${label}</option>`).join("")}
        </select></label>
      </div>
      <div class="field-grid">
        <label><span>IP / 设备地址</span><input name="address" required value="${escapeHtml(printer.address || "")}" placeholder="192.168.1.88"></label>
        <label><span>端口</span><input name="port" type="number" value="${printer.port || 9100}"></label>
      </div>
      <label class="checkline"><input type="checkbox" name="enabled" ${printer.enabled !== false ? "checked" : ""}><span>启用自动打印</span></label>
      <button class="primary-action" type="submit">${printer.id ? "保存打印机" : "添加打印机"}</button>
    </form>
  `;
}

function renderPrinters() {
  $("#printersPanel").innerHTML = `
    <div class="printer-toolbar">
      <div><h1>打印机连接</h1><p>搜索周围设备，测试后分配到对应档口</p></div>
      <button class="discover-action" data-discover>⌕ 搜索周围打印机</button>
    </div>
    ${state.discoveredPrinters.length ? `
      <section class="discovered">
        <h2>发现的设备</h2>
        <div class="discovered-grid">
          ${state.discoveredPrinters.map((printer, index) => `
            <div class="discovered-row">
              <span class="printer-icon">▣</span>
              <span><b>${escapeHtml(printer.name)}</b><small>${escapeHtml(printer.transport.toUpperCase())} · ${escapeHtml(printer.address)}${printer.port ? `:${printer.port}` : ""}</small></span>
              <button data-select-discovered="${index}">选择</button>
            </div>
          `).join("")}
        </div>
      </section>
    ` : ""}
    <div class="printer-layout">
      <div class="printer-list">
        ${state.printers.length ? state.printers.map((printer) => `
          <button class="printer-row" data-edit-printer="${escapeHtml(printer.id)}">
            <span class="printer-icon">▣</span>
            <span><b>${escapeHtml(printer.name)}</b><small>${escapeHtml(printer.transport.toUpperCase())} · ${escapeHtml(printer.address)}:${printer.port || ""}</small></span>
            <em>${({ kitchen: "厨房", bar: "吧台", sushi: "寿司台", front: "前台" })[printer.role]}</em>
            <i class="${printer.enabled ? "live" : ""}"></i>
          </button>
          <button class="test-printer" data-test-printer="${escapeHtml(printer.id)}">测试打印</button>
        `).join("") : `<div class="admin-empty">还没有配置打印机</div>`}
      </div>
      <aside>${printerForm(state.editingPrinter || {})}</aside>
    </div>
  `;
}

function renderSystem() {
  $("#systemPanel").innerHTML = `
    <div class="system-pane">
      <h1>服务器连接</h1>
      <p>Android 设备请填写餐厅局域网内后端电脑的地址。</p>
      <form id="connectionForm" class="editor-form compact-form">
        <label><span>API 地址</span><input name="baseUrl" required value="${escapeHtml(adminApi.storage.baseUrl)}" placeholder="http://192.168.1.20:8787"></label>
        <label><span>管理员令牌</span><input name="token" required type="password" value="${escapeHtml(adminApi.storage.token)}" autocomplete="current-password"></label>
        <button class="primary-action" type="submit">测试并保存连接</button>
      </form>
    </div>
  `;
}

function renderActivePanel() {
  document.querySelectorAll(".admin-panel").forEach((node) => node.classList.toggle("active", node.id === `${state.tab}Panel`));
  document.querySelectorAll("[data-tab]").forEach((node) => node.classList.toggle("active", node.dataset.tab === state.tab));
  if (state.tab === "catalog") renderCatalog();
  if (state.tab === "printers") renderPrinters();
  if (state.tab === "system") renderSystem();
}

async function connect() {
  try {
    await adminApi.health();
    const [{ products }, { printers }] = await Promise.all([adminApi.products(), adminApi.printers()]);
    state.products = products;
    state.printers = printers;
    $("#connectionDot").classList.add("online");
    $("#connectionText").textContent = "服务器在线";
    renderActivePanel();
  } catch (error) {
    $("#connectionDot").classList.remove("online");
    $("#connectionText").textContent = error.message;
    if (!adminApi.storage.token) {
      state.tab = "system";
      renderActivePanel();
    }
  }
}

function formProduct(form) {
  const data = new FormData(form);
  return {
    sku: data.get("sku"),
    kind: data.get("kind"),
    category: data.get("category"),
    names: { zh: data.get("nameZh"), de: data.get("nameDe"), en: data.get("nameEn") },
    description: data.get("description"),
    price: Number(data.get("price")),
    details: { ingredients: data.get("ingredients"), time: data.get("time"), people: data.get("people"), level: data.get("level") },
    allergens: String(data.get("allergens")).split(",").map((item) => item.trim()).filter(Boolean),
    printStation: data.get("printStation"),
    available: data.get("available") === "on",
    published: data.get("published") === "on"
  };
}

async function saveProduct(form) {
  const id = new FormData(form).get("id");
  const media = form.elements.media.files[0];
  const result = id ? await adminApi.updateProduct(id, formProduct(form)) : await adminApi.createProduct(formProduct(form));
  if (media) await adminApi.uploadMedia(result.product.id, media);
  state.editingProduct = null;
  await connect();
  notify("商品已保存", "success");
}

async function discoverPrinters() {
  if (!Capacitor.isNativePlatform()) {
    notify("周围设备搜索需要在 Android App 内运行；网页端可手动填写 IP", "warning");
    return;
  }
  try {
    const result = await Printer.discover();
    state.discoveredPrinters = result.devices || [];
    renderPrinters();
    notify(`发现 ${result.devices.length} 台设备`, "success");
  } catch (error) {
    notify(error.message || "搜索失败", "error");
  }
}

document.addEventListener("click", async (event) => {
  if (event.target.closest("[data-return-app]")) {
    if (Capacitor.isNativePlatform()) {
      try {
        await Kiosk.lock();
      } catch {
        // Navigation still returns to the customer app if lock-task is unavailable.
      }
    }
    window.location.href = "index.html";
    return;
  }
  const tab = event.target.closest("[data-tab]");
  if (tab) {
    state.tab = tab.dataset.tab;
    renderActivePanel();
  }
  const filter = event.target.closest("[data-filter]");
  if (filter) {
    state.productFilter = filter.dataset.filter;
    renderCatalog();
  }
  const editProduct = event.target.closest("[data-edit-product]");
  if (editProduct) {
    state.editingProduct = state.products.find((item) => item.id === editProduct.dataset.editProduct);
    renderCatalog();
  }
  if (event.target.closest("[data-new-product]")) {
    state.editingProduct = null;
    renderCatalog();
  }
  if (event.target.closest("[data-refresh]")) await connect();
  const deleteProduct = event.target.closest("[data-delete-product]");
  if (deleteProduct && window.confirm("确定删除这个商品及其媒体吗？")) {
    await adminApi.deleteProduct(deleteProduct.dataset.deleteProduct);
    state.editingProduct = null;
    await connect();
    notify("商品已删除", "success");
  }
  const editPrinter = event.target.closest("[data-edit-printer]");
  if (editPrinter) {
    state.editingPrinter = state.printers.find((item) => item.id === editPrinter.dataset.editPrinter);
    renderPrinters();
  }
  const discovered = event.target.closest("[data-select-discovered]");
  if (discovered) {
    const printer = state.discoveredPrinters[Number(discovered.dataset.selectDiscovered)];
    state.editingPrinter = {
      name: printer.name,
      transport: printer.transport,
      address: printer.address,
      port: printer.port || (printer.transport === "lan" ? 9100 : null),
      role: printer.transport === "lan" ? "kitchen" : "front",
      enabled: true
    };
    renderPrinters();
  }
  const testPrinter = event.target.closest("[data-test-printer]");
  if (testPrinter) {
    const printer = state.printers.find((item) => item.id === testPrinter.dataset.testPrinter);
    if (!Capacitor.isNativePlatform()) notify("测试打印需要在 Android App 内运行", "warning");
    else {
      try {
        await Printer.testPrint(printer);
        notify("测试页已发送", "success");
      } catch (error) {
        notify(error.message || "测试打印失败", "error");
      }
    }
  }
  if (event.target.closest("[data-discover]")) await discoverPrinters();
});

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    if (event.target.matches("#productForm")) await saveProduct(event.target);
    if (event.target.matches("#printerForm")) {
      const data = new FormData(event.target);
      const printer = {
        name: data.get("name"),
        transport: data.get("transport"),
        role: data.get("role"),
        address: data.get("address"),
        port: Number(data.get("port")) || null,
        enabled: data.get("enabled") === "on"
      };
      const id = data.get("id");
      if (id) await adminApi.updatePrinter(id, printer);
      else await adminApi.createPrinter(printer);
      state.editingPrinter = null;
      await connect();
      notify("打印机配置已保存", "success");
    }
    if (event.target.matches("#connectionForm")) {
      const data = new FormData(event.target);
      adminApi.storage.baseUrl = String(data.get("baseUrl"));
      adminApi.storage.token = String(data.get("token"));
      await connect();
      notify("连接成功", "success");
    }
  } catch (error) {
    notify(error.message, "error");
  }
});

renderShell();
renderCatalog();
renderPrinters();
renderSystem();
connect();

import { Capacitor, registerPlugin } from "@capacitor/core";
import { dishes as seedDishes, orderStatuses, services } from "./data.js";
import { customerApi } from "./customer-api.js";
import "./styles.css";

const Kiosk = registerPlugin("Kiosk");
const storageKey = "zy_customer_state_v3";
const initialState = {
  active: null,
  cat: "ALLE",
  query: "",
  cart: {},
  orders: [],
  requests: [],
  lang: "zh"
};

let catalog = seedDishes.map((dish) => ({
  ...dish,
  id: String(dish.id),
  sku: `FOOD-${dish.id}`,
  kind: "food",
  media: []
}));
const state = { ...initialState, ...JSON.parse(localStorage.getItem(storageKey) || "{}") };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");
const euro = (value) => `EUR ${Number(value).toFixed(2)}`;
const sameId = (left, right) => String(left) === String(right);

function persist() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function toast(text) {
  const node = $("#toast");
  node.textContent = text;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 1600);
}

function statusLabel(status) {
  return ({ new: "新订单", preparing: "制作中", ready: "可上菜", completed: "已完成", cancelled: "已取消" })[status] || status;
}

function mapProduct(product) {
  return {
    id: String(product.id),
    sku: product.sku,
    kind: product.kind,
    zh: product.names.zh,
    de: product.names.de,
    en: product.names.en,
    cat: product.category,
    price: product.price,
    time: product.details.time,
    people: product.details.people,
    level: product.details.level,
    allergens: product.allergens.join(", "),
    ingredients: product.details.ingredients,
    intro: product.description,
    art: product.appearance.art,
    pattern: product.appearance.pattern,
    media: product.media || []
  };
}

function cartSummary() {
  return Object.entries(state.cart).reduce((summary, [id, item]) => {
    const product = catalog.find((candidate) => sameId(candidate.id, id));
    if (!product) return summary;
    summary.count += item.qty;
    summary.total += product.price * item.qty;
    return summary;
  }, { count: 0, total: 0 });
}

function visibleProducts() {
  const query = state.query.trim().toLowerCase();
  return catalog.filter((product) => {
    const matchesCat = state.cat === "ALLE" || product.cat === state.cat;
    const text = [product.sku, product.zh, product.de, product.en, product.cat].join(" ").toLowerCase();
    return matchesCat && (!query || text.includes(query));
  });
}

function icon(name) {
  const paths = {
    water: "M12 3s6 6.4 6 10.4A6 6 0 1 1 6 13.4C6 9.4 12 3 12 3Z",
    utensils: "M7 3v8M4 3v8M10 3v8M4 7h6M7 11v10M17 3v18M14 3h6",
    napkin: "M5 4h14v16H5zM8 7h8M8 11h8M8 15h5",
    takeaway: "M5 8h14l-1 12H6L5 8ZM8 8a4 4 0 0 1 8 0",
    clear: "M4 19h16M7 19V8h10v11M9 8V5h6v3",
    pay: "M3 6h18v12H3zM3 10h18M7 15h4"
  };
  return `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="${paths[name]}" /></svg>`;
}

function renderShell() {
  $("#app").innerHTML = `
    <main class="app-shell">
      <section id="home" class="screen home active">
        <div class="brand"><small>ZHAO YUN RESTAURANT</small><h1>赵云</h1><p>Tisch 08 · 08号桌</p></div>
        <div class="home-actions">
          <button class="home-btn" data-go="menu"><span>01</span><b>开始点餐</b><small>SPEISEKARTE</small></button>
          <button class="home-btn" data-go="orders"><span>02</span><b>订单状态</b><small>MEINE BESTELLUNG</small></button>
          <button class="home-btn" data-go="service"><span>03</span><b>呼叫服务员</b><small>SERVICE RUFEN</small></button>
          <button class="home-btn staff-link" data-go="staff"><span>04</span><b>员工看板</b><small>MITARBEITER</small></button>
        </div>
        <div class="langs"><button data-lang="zh">中文</button><button data-lang="de">Deutsch</button><button data-lang="en">English</button></div>
      </section>
      <section id="menu" class="screen menu">
        <header class="topbar">
          <button class="icon-btn back" data-go="home" aria-label="返回">‹</button>
          <div class="title"><strong>La Carte</strong><small>TISCH 08</small></div>
          <button id="searchBtn" class="icon-btn" aria-label="搜索">⌕</button>
        </header>
        <div id="searchBox" class="search-box"><input id="searchInput" placeholder="菜名 / Gericht / SKU" /><button id="clearSearch">清除</button></div>
        <nav id="chips" class="chips"></nav>
        <div id="stack" class="stack"></div>
        <div id="dishOverlay" class="dish-overlay" aria-hidden="true"></div>
        <button class="cartbar" data-go="cart"><span>购物车 · WARENKORB</span><b id="cartCount">0</b><em id="cartTotal">EUR 0.00</em></button>
      </section>
      <section id="cart" class="screen panel"><header class="panel-head"><button class="icon-btn back" data-go="menu">‹</button><div><h2>购物车</h2><small>WARENKORB</small></div></header><div id="cartContent" class="content"></div></section>
      <section id="orders" class="screen panel"><header class="panel-head"><button class="icon-btn back" data-go="home">‹</button><div><h2>订单状态</h2><small>MEINE BESTELLUNG</small></div></header><div id="ordersContent" class="content"></div></section>
      <section id="service" class="screen panel"><header class="panel-head"><button class="icon-btn back" data-go="home">‹</button><div><h2>呼叫服务员</h2><small>SERVICE RUFEN</small></div></header><div class="content"><div id="serviceGrid" class="service-grid"></div><p id="serviceStatus" class="status">请选择需要的服务</p></div></section>
      <section id="staff" class="screen panel staff"><header class="panel-head"><button class="icon-btn back" data-go="home">‹</button><div><h2>员工看板</h2><small>MITARBEITER</small></div></header><div id="staffContent" class="content"></div></section>
    </main>
    <div id="toast" class="toast" role="status"></div>
  `;
}

function go(screen) {
  if (state.active) closeProduct(false);
  $$(".screen").forEach((node) => node.classList.toggle("active", node.id === screen));
  if (screen === "menu") renderMenu();
  if (screen === "cart") renderCart();
  if (screen === "orders") renderOrders();
  if (screen === "service") renderService();
  if (screen === "staff") renderStaff();
}

function productCard(product) {
  return `
    <article class="dish-card" data-id="${escapeHtml(product.id)}">
      <div class="summary">
        <span class="number">${escapeHtml(product.sku)}</span>
        <div><h3>${escapeHtml(product.zh || product.de || product.en)}</h3><p>${escapeHtml(product.de)}</p></div>
        <span class="cat">${escapeHtml(product.cat)}</span>
      </div>
    </article>
  `;
}

function renderChips() {
  const categories = ["ALLE", ...new Set(catalog.map((product) => product.cat))];
  $("#chips").innerHTML = categories.map((category) => `<button class="chip ${state.cat === category ? "on" : ""}" data-cat="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join("");
}

function renderMenu() {
  renderChips();
  const products = visibleProducts();
  $("#stack").innerHTML = products.length ? products.map(productCard).join("") : `<div class="empty">没有找到商品</div>`;
  updateCartBar();
}

function mediaMarkup(product) {
  const media = product.media[0];
  if (!media) return `<div class="art ${escapeHtml(product.pattern)}" style="--art:${escapeHtml(product.art)}"></div>`;
  const source = customerApi.mediaUrl(media.url);
  if (media.type === "video") {
    const poster = media.posterUrl ? `poster="${escapeHtml(customerApi.mediaUrl(media.posterUrl))}"` : "";
    return `<video class="dish-media" src="${escapeHtml(source)}" ${poster} playsinline muted loop autoplay></video>`;
  }
  return `<img class="dish-media" src="${escapeHtml(source)}" alt="${escapeHtml(product.zh)}">`;
}

function detailMarkup(product) {
  const quantity = state.cart[product.id]?.qty || 1;
  return `
    <div class="dish-detail-card" data-detail-id="${escapeHtml(product.id)}">
      <button class="detail-close" data-close-product aria-label="关闭详情">×</button>
      <div class="detail-heading">
        <span class="number">${escapeHtml(product.sku)}</span><span class="cat">${escapeHtml(product.cat)}</span>
        <h3>${escapeHtml(product.zh || product.de || product.en)}</h3><p>${escapeHtml(product.de)}</p>
      </div>
      <div class="detail-scroll">
        <div class="feature">${mediaMarkup(product)}<div><h4>${escapeHtml(product.en)}</h4><p>${escapeHtml(product.intro)}</p></div></div>
        <div class="meta"><span>${escapeHtml(product.time)}</span><span>${escapeHtml(product.people)}</span><span>${escapeHtml(product.level)}</span></div>
        <section class="ingredients"><small>主要食材 · ZUTATEN</small><p>${escapeHtml(product.ingredients)}</p><b>过敏原 ${escapeHtml(product.allergens || "—")}</b></section>
      </div>
      <div class="detail-buy">
        <div class="buyline"><strong>${euro(product.price)}</strong><div class="qty"><button data-minus="${escapeHtml(product.id)}">−</button><span data-qty-for="${escapeHtml(product.id)}">${quantity}</span><button data-plus="${escapeHtml(product.id)}">＋</button></div></div>
        <button class="primary add" data-add="${escapeHtml(product.id)}">加入购物车 · IN DEN WARENKORB</button>
      </div>
    </div>
  `;
}

function openProduct(id, source) {
  const product = catalog.find((candidate) => sameId(candidate.id, id));
  if (!product || state.active) return;
  state.active = String(id);
  persist();
  source.classList.add("selected");
  $(".menu").classList.add("detail-open");
  const overlay = $("#dishOverlay");
  overlay.innerHTML = detailMarkup(product);
  overlay.classList.add("open");
  overlay.setAttribute("aria-hidden", "false");
  const target = overlay.querySelector(".dish-detail-card");
  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  target.animate([
    { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`, opacity: .75 },
    { transform: "translate(0, 0) scale(1)", opacity: 1 }
  ], { duration: 480, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" });
}

async function closeProduct(animate = true) {
  const id = state.active;
  if (!id) return;
  const overlay = $("#dishOverlay");
  const target = overlay.querySelector(".dish-detail-card");
  const source = [...document.querySelectorAll(".dish-card")].find((node) => sameId(node.dataset.id, id));
  if (animate && target && source) {
    const from = target.getBoundingClientRect();
    const to = source.getBoundingClientRect();
    const motion = target.animate([
      { transform: "translate(0, 0) scale(1)", opacity: 1 },
      { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`, opacity: .35 }
    ], { duration: 360, easing: "cubic-bezier(.4,0,.2,1)", fill: "both" });
    await motion.finished.catch(() => {});
  }
  state.active = null;
  persist();
  overlay.classList.remove("open");
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = "";
  $(".menu").classList.remove("detail-open");
  source?.classList.remove("selected");
}

function updateCartBar() {
  const { count, total } = cartSummary();
  $("#cartCount").textContent = count;
  $("#cartTotal").textContent = euro(total);
}

function changeQty(id, delta) {
  const field = [...document.querySelectorAll("[data-qty-for]")].find((node) => sameId(node.dataset.qtyFor, id));
  const next = Math.max(1, (state.cart[id]?.qty || Number(field?.textContent || 1)) + delta);
  state.cart[id] = { qty: next };
  if (field) field.textContent = next;
  persist();
  updateCartBar();
}

function addToCart(id) {
  const field = [...document.querySelectorAll("[data-qty-for]")].find((node) => sameId(node.dataset.qtyFor, id));
  state.cart[id] = { qty: Number(field?.textContent || state.cart[id]?.qty || 1) };
  persist();
  updateCartBar();
  toast("已加入购物车");
}

function renderCart() {
  const entries = Object.entries(state.cart).filter(([id]) => catalog.some((product) => sameId(product.id, id)));
  if (!entries.length) {
    $("#cartContent").innerHTML = `<div class="empty">购物车还是空的<button class="secondary" data-go="menu">返回菜单</button></div>`;
    return;
  }
  const { total } = cartSummary();
  $("#cartContent").innerHTML = `
    ${entries.map(([id, item]) => {
      const product = catalog.find((candidate) => sameId(candidate.id, id));
      return `<div class="row"><div><h3>${escapeHtml(product.zh)}</h3><small>${escapeHtml(product.de)} × ${item.qty}</small></div><strong>${euro(product.price * item.qty)}</strong></div>`;
    }).join("")}
    <label class="note-label">订单备注<input id="orderNote" placeholder="例如：少盐、不要香菜" /></label>
    <div class="total"><span>合计 · GESAMT</span><b>${euro(total)}</b></div>
    <button id="submitOrder" class="primary">确认下单</button>
    <button id="clearCart" class="secondary">清空购物车</button>
  `;
}

async function submitOrder() {
  const { count, total } = cartSummary();
  if (!count) return;
  const items = Object.entries(state.cart).map(([id, item]) => ({ id, qty: item.qty }));
  const clientRequestId = crypto.randomUUID();
  const localOrder = {
    id: clientRequestId,
    clientRequestId,
    no: String(Date.now()).slice(-6),
    table: "08",
    time: Date.now(),
    status: orderStatuses[0],
    note: $("#orderNote")?.value || "",
    items,
    total
  };
  try {
    const { order } = await customerApi.createOrder({ clientRequestId, table: "08", note: localOrder.note, items });
    Object.assign(localOrder, { id: order.id, no: order.no, status: statusLabel(order.status), total: order.total, time: Date.parse(order.createdAt) });
  } catch {
    localOrder.offline = true;
  }
  state.orders.unshift(localOrder);
  state.cart = {};
  persist();
  renderCart();
  toast(localOrder.offline ? "服务器离线，订单仅保存在本机" : "订单已提交");
}

function orderView(order) {
  return `
    <article class="order">
      <div class="order-head"><h3>订单 ${escapeHtml(order.no)}</h3><span>${escapeHtml(order.status)}</span></div>
      <small>${new Date(order.time).toLocaleString("de-AT")} · Tisch ${escapeHtml(order.table)}</small>
      <p>${order.items.map((item) => {
        const product = catalog.find((candidate) => sameId(candidate.id, item.id));
        return `${item.qty}x ${escapeHtml(product?.zh || item.name || "商品")}`;
      }).join("<br>")}</p>
      ${order.note ? `<p class="note">备注：${escapeHtml(order.note)}</p>` : ""}
      ${order.offline ? `<p class="offline-note">离线订单，仅保存在本机</p>` : ""}
      <div class="total"><span>合计</span><b>${euro(order.total)}</b></div>
    </article>
  `;
}

function renderOrders() {
  $("#ordersContent").innerHTML = state.orders.length ? state.orders.map(orderView).join("") : `<div class="empty">还没有已提交订单</div>`;
}

function renderService() {
  $("#serviceGrid").innerHTML = services.map((service, index) => `
    <button class="service" data-service="${index}">${icon(service[0])}<b>${service[1]}</b><small>${service[2]}</small></button>
  `).join("");
}

async function createServiceRequest(index) {
  const service = services[index];
  const local = { id: crypto.randomUUID(), table: "08", type: service[1], de: service[2], time: Date.now(), done: false };
  try {
    const result = await customerApi.createServiceRequest({ table: "08", type: service[0] });
    local.id = result.request.id;
  } catch {
    local.offline = true;
  }
  state.requests.unshift(local);
  persist();
  $("#serviceStatus").textContent = `${service[1]}请求已发送，服务员马上过来`;
  toast("服务请求已发送");
}

function renderStaff() {
  const orders = state.orders.length ? state.orders.map((order) => {
    const current = orderStatuses.indexOf(order.status);
    const next = orderStatuses[Math.min(current + 1, orderStatuses.length - 1)];
    return `<article class="order staff-order">${orderView(order)}<button class="primary" data-next-order="${escapeHtml(order.no)}" ${current === orderStatuses.length - 1 ? "disabled" : ""}>更新为：${next}</button></article>`;
  }).join("") : `<div class="empty">暂无订单</div>`;
  const requests = state.requests.length ? state.requests.map((request) => `
    <div class="row request ${request.done ? "done" : ""}"><div><h3>${escapeHtml(request.type)}</h3><small>Tisch ${escapeHtml(request.table)} · ${new Date(request.time).toLocaleTimeString("de-AT")}</small></div><button class="secondary" data-done-request="${escapeHtml(request.id)}" ${request.done ? "disabled" : ""}>已处理</button></div>
  `).join("") : `<div class="empty compact">暂无服务请求</div>`;
  $("#staffContent").innerHTML = `<h3 class="section-title">厨房订单</h3>${orders}<h3 class="section-title">服务呼叫</h3>${requests}`;
}

function advanceOrder(no) {
  const order = state.orders.find((item) => item.no === no);
  if (!order) return;
  const current = orderStatuses.indexOf(order.status);
  order.status = orderStatuses[Math.min(current + 1, orderStatuses.length - 1)];
  persist();
  renderStaff();
}

function markRequestDone(id) {
  const request = state.requests.find((item) => sameId(item.id, id));
  if (request) request.done = true;
  persist();
  renderStaff();
}

async function loadCatalog() {
  try {
    const { products } = await customerApi.catalog();
    catalog = products.map(mapProduct);
    localStorage.setItem("zy_catalog_cache", JSON.stringify(catalog));
  } catch {
    const cached = JSON.parse(localStorage.getItem("zy_catalog_cache") || "null");
    if (Array.isArray(cached) && cached.length) catalog = cached;
  }
  if ($("#menu")?.classList.contains("active")) renderMenu();
}

function handleRealtime(message) {
  if (message.type === "catalog.changed") loadCatalog();
  if (message.type === "order.changed") {
    const order = state.orders.find((item) => sameId(item.id, message.payload.id) || item.clientRequestId === message.payload.clientRequestId);
    if (!order) return;
    order.status = statusLabel(message.payload.status);
    order.total = message.payload.total;
    persist();
    if ($("#orders").classList.contains("active")) renderOrders();
  }
}

function bindEvents() {
  let adminTapCount = 0;
  let adminTapTimer;

  document.addEventListener("click", async (event) => {
    const goTarget = event.target.closest("[data-go]");
    if (goTarget) go(goTarget.dataset.go);
    const product = event.target.closest(".dish-card");
    if (product) openProduct(product.dataset.id, product);
    const category = event.target.closest("[data-cat]");
    if (category) {
      state.cat = category.dataset.cat;
      persist();
      renderMenu();
    }
    const minus = event.target.closest("[data-minus]");
    const plus = event.target.closest("[data-plus]");
    const add = event.target.closest("[data-add]");
    if (minus) changeQty(minus.dataset.minus, -1);
    if (plus) changeQty(plus.dataset.plus, 1);
    if (add) addToCart(add.dataset.add);
    if (event.target.closest("[data-close-product]") || event.target === $("#dishOverlay")) await closeProduct();
    if (event.target.id === "submitOrder") await submitOrder();
    if (event.target.id === "clearCart") {
      state.cart = {};
      persist();
      renderCart();
    }
    const service = event.target.closest("[data-service]");
    if (service) await createServiceRequest(Number(service.dataset.service));
    const nextOrder = event.target.closest("[data-next-order]");
    if (nextOrder) advanceOrder(nextOrder.dataset.nextOrder);
    const doneRequest = event.target.closest("[data-done-request]");
    if (doneRequest) markRequestDone(doneRequest.dataset.doneRequest);
    if (event.target.dataset.lang) {
      state.lang = event.target.dataset.lang;
      persist();
      toast("语言偏好已保存");
    }
  });

  $(".brand").addEventListener("click", () => {
    if (!Capacitor.isNativePlatform()) return;
    adminTapCount += 1;
    clearTimeout(adminTapTimer);
    adminTapTimer = setTimeout(() => { adminTapCount = 0; }, 4000);
    if (adminTapCount >= 7) {
      adminTapCount = 0;
      unlockKiosk();
    }
  });
  $("#searchBtn").addEventListener("click", () => {
    $("#searchBox").classList.toggle("open");
    $("#searchInput").focus();
  });
  $("#searchInput").addEventListener("input", (event) => {
    state.query = event.target.value;
    persist();
    renderMenu();
  });
  $("#clearSearch").addEventListener("click", () => {
    state.query = "";
    $("#searchInput").value = "";
    persist();
    renderMenu();
  });
}

async function configureKiosk() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { configured } = await Kiosk.status();
    if (configured) {
      await Kiosk.lock();
      return;
    }
    const pin = window.prompt("首次配置：请设置 6-12 位管理员数字 PIN");
    if (!pin) return;
    const confirmation = window.prompt("请再次输入管理员 PIN");
    if (pin !== confirmation) return window.alert("两次 PIN 不一致");
    await Kiosk.configure({ pin });
  } catch (error) {
    window.alert(error.message || "终端模式配置失败");
  }
}

async function unlockKiosk() {
  const pin = window.prompt("管理员解锁 PIN");
  if (!pin) return;
  try {
    await Kiosk.unlock({ pin });
    window.location.href = "admin.html";
  } catch {
    window.alert("PIN 错误");
  }
}

renderShell();
renderMenu();
renderService();
bindEvents();
configureKiosk();
loadCatalog();
customerApi.connect(handleRealtime);

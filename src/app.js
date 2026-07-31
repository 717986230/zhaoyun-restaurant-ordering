import { Capacitor, registerPlugin } from "@capacitor/core";
import { dishes, orderStatuses, services } from "./data.js";
import "./styles.css";

const Kiosk = registerPlugin("Kiosk");
const storageKey = "zy_capacitor_demo_v2";
const initialState = {
  active: null,
  flipped: null,
  cat: "ALLE",
  query: "",
  cart: {},
  orders: [],
  requests: [],
  lang: "zh"
};

const load = () => ({ ...initialState, ...JSON.parse(localStorage.getItem(storageKey) || "{}") });
const state = load();
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const euro = (value) => `EUR ${value.toFixed(2)}`;

function persist() {
  localStorage.setItem(storageKey, JSON.stringify({
    active: state.active,
    flipped: state.flipped,
    cat: state.cat,
    query: state.query,
    cart: state.cart,
    orders: state.orders,
    requests: state.requests,
    lang: state.lang
  }));
}

function toast(text) {
  const node = $("#toast");
  node.textContent = text;
  node.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("show"), 1500);
}

function cartSummary() {
  const count = Object.values(state.cart).reduce((sum, item) => sum + item.qty, 0);
  const total = Object.entries(state.cart).reduce((sum, [id, item]) => {
    const dish = dishes.find((candidate) => candidate.id === Number(id));
    return sum + (dish ? dish.price * item.qty : 0);
  }, 0);
  return { count, total };
}

function visibleDishes() {
  const query = state.query.trim().toLowerCase();
  return dishes.filter((dish) => {
    const matchesCat = state.cat === "ALLE" || dish.cat === state.cat;
    const haystack = [dish.id, dish.zh, dish.de, dish.en, dish.cat].join(" ").toLowerCase();
    return matchesCat && (!query || haystack.includes(query));
  });
}

function go(screen) {
  $$(".screen").forEach((node) => node.classList.toggle("active", node.id === screen));
  if (screen === "menu") renderMenu();
  if (screen === "cart") renderCart();
  if (screen === "orders") renderOrders();
  if (screen === "staff") renderStaff();
  if (screen === "service") renderService();
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
        <div class="brand">
          <small>ZHAO YUN RESTAURANT</small>
          <h1>赵云</h1>
          <p>Tisch 08 · 08号桌</p>
        </div>
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
        <div id="searchBox" class="search-box"><input id="searchInput" placeholder="菜名 / Gericht / No.80" /><button id="clearSearch">清除</button></div>
        <nav id="chips" class="chips"></nav>
        <div id="stack" class="stack"></div>
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

function renderChips() {
  const cats = ["ALLE", ...new Set(dishes.map((dish) => dish.cat))];
  $("#chips").innerHTML = cats.map((cat) => `<button class="chip ${state.cat === cat ? "on" : ""}" data-cat="${cat}">${cat}</button>`).join("");
}

function dishCard(dish) {
  const stored = state.cart[dish.id]?.qty || 1;
  const expanded = state.active === dish.id;
  const flipped = state.flipped === dish.id;
  return `
    <article class="dish-card ${expanded ? "expanded" : ""} ${flipped ? "flipped" : ""}" data-id="${dish.id}">
      <div class="card-inner">
        <div class="card-face card-front">
          <div class="summary">
            <span class="number">No.${dish.id}</span>
            <div><h3>${dish.zh}</h3><p>${dish.de}</p></div>
            <span class="cat">${dish.cat}</span>
          </div>
          <div class="detail">
            <div class="feature">
              <div class="art ${dish.pattern}" style="--art:${dish.art}"></div>
              <div><h4>${dish.en}</h4><p>${dish.intro}</p></div>
            </div>
            <div class="meta"><span>${dish.time}</span><span>${dish.people}</span><span>${dish.level}</span></div>
            <div class="buyline"><strong>${euro(dish.price)}</strong><div class="qty"><button data-minus="${dish.id}">-</button><span id="q${dish.id}">${stored}</span><button data-plus="${dish.id}">+</button></div></div>
            <button class="primary add" data-add="${dish.id}">加入购物车 · IN DEN WARENKORB</button>
          </div>
        </div>
        <div class="card-face card-back">
          <button class="flip-back" data-flip-back="${dish.id}">返回正面</button>
          <h3>${dish.zh}</h3>
          <p>${dish.ingredients}</p>
          <dl>
            <div><dt>时间</dt><dd>${dish.time}</dd></div>
            <div><dt>份量</dt><dd>${dish.people}</dd></div>
            <div><dt>难度</dt><dd>${dish.level}</dd></div>
            <div><dt>过敏原</dt><dd>${dish.allergens}</dd></div>
          </dl>
          <button class="primary add" data-add="${dish.id}">背面加入购物车</button>
        </div>
      </div>
    </article>
  `;
}

function renderMenu() {
  renderChips();
  const list = visibleDishes();
  if (state.active !== null && !list.some((dish) => dish.id === state.active)) {
    state.active = null;
    state.flipped = null;
  }
  $("#stack").innerHTML = list.length ? list.map(dishCard).join("") : `<div class="empty">没有找到菜品</div>`;
  updateCartBar();
}

function updateCartBar() {
  const { count, total } = cartSummary();
  $("#cartCount").textContent = count;
  $("#cartTotal").textContent = euro(total);
}

function selectDish(id) {
  if (state.active === id) {
    state.flipped = state.flipped === id ? null : id;
  } else {
    state.active = id;
    state.flipped = null;
  }
  persist();
  renderMenu();
  setTimeout(() => document.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 30);
}

function changeQty(id, delta) {
  const next = Math.max(1, (state.cart[id]?.qty || Number($(`#q${id}`)?.textContent || 1)) + delta);
  state.cart[id] = { qty: next };
  persist();
  const field = $(`#q${id}`);
  if (field) field.textContent = next;
  updateCartBar();
}

function addToCart(id) {
  const qty = Number($(`#q${id}`)?.textContent || state.cart[id]?.qty || 1);
  state.cart[id] = { qty };
  persist();
  updateCartBar();
  toast("已加入购物车");
}

function renderCart() {
  const items = Object.entries(state.cart);
  if (!items.length) {
    $("#cartContent").innerHTML = `<div class="empty">购物车还是空的<button class="secondary" data-go="menu">返回菜单</button></div>`;
    return;
  }
  const { total } = cartSummary();
  $("#cartContent").innerHTML = `
    ${items.map(([id, item]) => {
      const dish = dishes.find((candidate) => candidate.id === Number(id));
      return `<div class="row"><div><h3>${dish.zh}</h3><small>${dish.de} x ${item.qty}</small></div><strong>${euro(dish.price * item.qty)}</strong></div>`;
    }).join("")}
    <label class="note-label">订单备注<input id="orderNote" placeholder="例如：少盐、不要香菜" /></label>
    <div class="total"><span>合计 · GESAMT</span><b>${euro(total)}</b></div>
    <button id="submitOrder" class="primary">确认下单并打印</button>
    <button id="clearCart" class="secondary">清空购物车</button>
  `;
}

function submitOrder() {
  const { count, total } = cartSummary();
  if (!count) return;
  state.orders.unshift({
    no: String(Date.now()).slice(-6),
    table: "08",
    time: Date.now(),
    status: orderStatuses[0],
    note: $("#orderNote")?.value || "",
    items: Object.entries(state.cart).map(([id, item]) => ({ id: Number(id), qty: item.qty })),
    total
  });
  state.cart = {};
  persist();
  renderCart();
  toast("订单已提交");
}

function renderOrders() {
  if (!state.orders.length) {
    $("#ordersContent").innerHTML = `<div class="empty">还没有已提交订单</div>`;
    return;
  }
  $("#ordersContent").innerHTML = state.orders.map(orderView).join("");
}

function orderView(order) {
  return `
    <article class="order">
      <div class="order-head"><h3>订单 ${order.no}</h3><span>${order.status}</span></div>
      <small>${new Date(order.time).toLocaleString("de-AT")} · Tisch ${order.table}</small>
      <p>${order.items.map((item) => `${item.qty}x ${dishes.find((dish) => dish.id === item.id)?.zh}`).join("<br>")}</p>
      ${order.note ? `<p class="note">备注：${order.note}</p>` : ""}
      <div class="total"><span>合计</span><b>${euro(order.total)}</b></div>
    </article>
  `;
}

function renderService() {
  $("#serviceGrid").innerHTML = services.map((service, index) => `
    <button class="service" data-service="${index}">
      ${icon(service[0])}
      <b>${service[1]}</b>
      <small>${service[2]}</small>
    </button>
  `).join("");
}

function createServiceRequest(index) {
  const service = services[index];
  state.requests.unshift({ id: Date.now(), table: "08", type: service[1], de: service[2], time: Date.now(), done: false });
  persist();
  $("#serviceStatus").textContent = `${service[1]}请求已发送，服务员马上过来`;
  toast("服务请求已发送");
}

function renderStaff() {
  const orderHtml = state.orders.length ? state.orders.map((order) => {
    const current = orderStatuses.indexOf(order.status);
    const next = orderStatuses[Math.min(current + 1, orderStatuses.length - 1)];
    return `<article class="order staff-order">${orderView(order)}<button class="primary" data-next-order="${order.no}" ${current === orderStatuses.length - 1 ? "disabled" : ""}>更新为：${next}</button></article>`;
  }).join("") : `<div class="empty">暂无订单</div>`;
  const requestsHtml = state.requests.length ? state.requests.map((request) => `
    <div class="row request ${request.done ? "done" : ""}">
      <div><h3>${request.type}</h3><small>Tisch ${request.table} · ${new Date(request.time).toLocaleTimeString("de-AT")}</small></div>
      <button class="secondary" data-done-request="${request.id}" ${request.done ? "disabled" : ""}>已处理</button>
    </div>
  `).join("") : `<div class="empty compact">暂无服务请求</div>`;
  $("#staffContent").innerHTML = `<h3 class="section-title">厨房订单</h3>${orderHtml}<h3 class="section-title">服务呼叫</h3>${requestsHtml}`;
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
  const request = state.requests.find((item) => item.id === Number(id));
  if (request) request.done = true;
  persist();
  renderStaff();
}

function bindEvents() {
  let adminTapCount = 0;
  let adminTapTimer;

  document.addEventListener("click", (event) => {
    const goTarget = event.target.closest("[data-go]");
    if (goTarget) go(goTarget.dataset.go);
    const dish = event.target.closest(".dish-card");
    if (dish && !event.target.closest("button")) selectDish(Number(dish.dataset.id));
    if (event.target.dataset.cat) {
      state.cat = event.target.dataset.cat;
      state.flipped = null;
      persist();
      renderMenu();
    }
    if (event.target.dataset.minus) changeQty(Number(event.target.dataset.minus), -1);
    if (event.target.dataset.plus) changeQty(Number(event.target.dataset.plus), 1);
    if (event.target.dataset.add) addToCart(Number(event.target.dataset.add));
    if (event.target.dataset.flipBack) {
      state.flipped = null;
      persist();
      renderMenu();
    }
    if (event.target.id === "submitOrder") submitOrder();
    if (event.target.id === "clearCart") {
      state.cart = {};
      persist();
      renderCart();
    }
    const serviceTarget = event.target.closest("[data-service]");
    if (serviceTarget) createServiceRequest(Number(serviceTarget.dataset.service));
    const nextOrderTarget = event.target.closest("[data-next-order]");
    if (nextOrderTarget) advanceOrder(nextOrderTarget.dataset.nextOrder);
    const doneRequestTarget = event.target.closest("[data-done-request]");
    if (doneRequestTarget) markRequestDone(doneRequestTarget.dataset.doneRequest);
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
    adminTapTimer = setTimeout(() => {
      adminTapCount = 0;
    }, 4000);
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
  const { configured } = await Kiosk.status();
  if (configured) {
    await Kiosk.lock();
    return;
  }

  const pin = window.prompt("首次配置：请设置 6-12 位管理员数字 PIN");
  if (!pin) return;
  const confirmation = window.prompt("请再次输入管理员 PIN");
  if (pin !== confirmation) {
    window.alert("两次 PIN 不一致，请重新启动应用后设置。");
    return;
  }
  try {
    await Kiosk.configure({ pin });
  } catch (error) {
    window.alert("PIN 必须是 6-12 位数字。");
  }
}

async function unlockKiosk() {
  const pin = window.prompt("管理员解锁 PIN");
  if (!pin) return;
  try {
    await Kiosk.unlock({ pin });
    toast("终端模式已解锁");
  } catch (error) {
    window.alert("PIN 错误");
  }
}

renderShell();
renderMenu();
renderService();
bindEvents();
configureKiosk();

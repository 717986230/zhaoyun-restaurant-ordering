import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";

const require = createRequire(import.meta.url);

// The board refetches after every mutation, so the stubbed list has to answer
// with the status the stubbed PATCH just accepted. A fixture frozen at "new"
// would make a passing PATCH look like a board that never updates.
let orderStatus;
let requestStatus;
let menuTheme;
let menuLanguages;
let appSettings;

// The admin follows the browser's language; these tests read the Chinese copy.
test.use({ locale: "zh-CN" });

test.beforeEach(async ({ page }) => {
  orderStatus = "new";
  requestStatus = "open";
  menuTheme = "jade";
  menuLanguages = ["en", "de"];
  // Orders, tables and printers are behind the ordering module, which a
  // restaurant turns on once guests can order; these tests run with it on.
  appSettings = { restaurantName: "赵云", menuTitle: "La Carte", menuDefaultScheme: "dark", showTableNumber: true, showOrdering: true, featuredEnabled: false, featuredTitle: "", featuredProductIds: [] };
  await page.addInitScript(() => sessionStorage.setItem("zy_admin_token", "test-admin"));
  await page.route("**/api/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }));
  await page.route("**/api/admin/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ role: "manager" }) }));
  await page.route("**/api/admin/settings", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      // As both backends do: either setting may come alone, stored in flag order.
      if (body.menuTheme) menuTheme = body.menuTheme;
      if (body.menuLanguages) menuLanguages = ["zh", "en", "de"].filter((language) => body.menuLanguages.includes(language));
      for (const key of Object.keys(appSettings)) if (key in body) appSettings[key] = body[key];
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ menuTheme, menuLanguages, ...appSettings }) });
  });
  await page.route("**/api/admin/products", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [{
    id: "80", sku: "FOOD-80", kind: "food", category: "MAIN",
    names: { zh: "黑椒牛柳", de: "Rinderfilet", en: "Beef Fillet" }, description: "",
    price: 34.5, allergens: ["F"], details: { ingredients: "Rind", time: "35 min", people: "2", level: "Mittel" },
    appearance: { art: "#222", pattern: "ring" }, available: true, published: true, printStation: "kitchen", media: [], modifiers: [{ id: "spice", names: { zh: "辣度", de: "Scharf", en: "Spice" }, selection: "single", options: [] }]
  }] }) }));
  await page.route("**/api/admin/printers", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ printers: [{ id: "printer-1", name: "厨房打印机", transport: "lan", address: "192.168.1.88", port: 9100, role: "kitchen", enabled: true }] }) }));
  await page.route("**/api/orders?**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ orders: [{
    id: "order-1", clientRequestId: "req-1", no: "260902-001", table: "12", status: orderStatus, note: "少盐", total: 34.5,
    items: [{ id: "80", name: "黑椒牛柳", qty: 2, modifiers: [{ id: "extra-chili", name: "加辣椒", price: 0.5 }] }],
    createdAt: new Date().toISOString()
  }] }) }));
  await page.route("**/api/service-requests?**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ requests: [{
    id: "request-1", table: "12", type: "water", status: requestStatus, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  }] }) }));
  await page.route("**/api/admin/print-jobs*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jobs: [] }) }));
  await page.route("**/api/admin/tables/overview", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tables: [] }) }));
  await page.goto("/admin.html");
});

test("orders board renders server orders and advances their status", async ({ page }) => {
  let patched;
  await page.route("**/api/orders/order-1/status", async (route) => {
    patched = route.request().postDataJSON();
    orderStatus = patched.status;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ order: {
      id: "order-1", clientRequestId: "req-1", no: "260902-001", table: "12", status: patched.status, note: "少盐", total: 34.5,
      items: [{ id: "80", name: "黑椒牛柳", qty: 2 }], createdAt: new Date().toISOString()
    } }) });
  });
  await page.getByRole("button", { name: "订单", exact: true }).click();
  const order = page.locator(".board-column").first().locator(".board-card");
  await expect(order).toContainText("桌 12");
  await expect(order).toContainText("黑椒牛柳");
  await expect(order).toContainText("加辣椒");
  await expect(order).toContainText("少盐");

  // The board is the only consumer of the order status machine, so the button
  // it offers has to be the one transition the server will accept.
  await page.getByRole("button", { name: "更新为：制作中" }).click();
  await expect.poll(() => patched?.status).toBe("preparing");
  await expect(order.locator(".status")).toHaveText("制作中");
});

test("service call is acknowledged from the orders board", async ({ page }) => {
  let patched;
  await page.route("**/api/service-requests/request-1/status", async (route) => {
    patched = route.request().postDataJSON();
    requestStatus = patched.status;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ request: {
      id: "request-1", table: "12", type: "water", status: patched.status,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    } }) });
  });
  await page.getByRole("button", { name: "订单", exact: true }).click();
  // Service calls sit in the floor column; the failed-print cards share the
  // compact card class, so exclude them rather than matching by position.
  const request = page.locator(".board-card.compact:not(.failed)");
  await expect(request).toContainText("桌 12");
  await expect(request).toContainText("加水");
  await page.getByRole("button", { name: "已处理" }).click();
  await expect.poll(() => patched?.status).toBe("completed");
  await expect(request).toHaveCount(0);
});

test("admin workspace loads catalog and printer modules", async ({ page }) => {
  await expect(page.locator(".admin-status.online")).toBeVisible();
  await page.getByRole("button", { name: "菜品", exact: true }).click();
  await expect(page.locator(".product-list")).toContainText("黑椒牛柳");
  await page.locator(".product-row").click({ force: true });
  await expect(page.locator('textarea[name="modifiers"]')).toHaveValue(/"spice"/);
  await page.getByRole("button", { name: "打印", exact: true }).click();
  await expect(page.locator(".printer-list")).toContainText("厨房打印机");
  // Searching the room and test prints need the Android shell; a browser has
  // no radio to search with, so it is not offered a button that cannot work.
  await expect(page.getByRole("button", { name: /搜索周围打印机/ })).toHaveCount(0);
});

test("a manager picks a menu style, and the choice is saved", async ({ page }) => {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const picker = page.locator(".theme-picker");
  await expect(picker).toBeVisible();
  await expect(picker.locator(".theme-swatch.selected")).toContainText("墨玉");

  await picker.locator(".theme-swatch", { hasText: "赤陶" }).click();
  await expect.poll(() => menuTheme).toBe("terracotta");
  await expect(picker.locator(".theme-swatch.selected")).toContainText("赤陶");
});

test("a manager chooses the menu's languages, and cannot switch off the last one", async ({ page }) => {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const languages = page.getByRole("group", { name: "菜单语言" });
  const toggle = (name) => languages.getByRole("button", { name });
  // English and German are on out of the box; Chinese is one tap away.
  await expect(toggle("English")).toHaveAttribute("aria-pressed", "true");
  await expect(toggle("Deutsch")).toHaveAttribute("aria-pressed", "true");
  await expect(toggle("中文")).toHaveAttribute("aria-pressed", "false");

  await toggle("中文").click();
  await expect.poll(() => menuLanguages).toEqual(["zh", "en", "de"]);
  await expect(toggle("中文")).toHaveAttribute("aria-pressed", "true");

  // Two taps in a row while the first save is still on its way — on a slow
  // phone the server answers after the second tap, which is how this failed
  // in CI. Each tap must be worked out from what the one before left on
  // screen, not from the list the page had before it.
  await page.route("**/api/admin/settings", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    await new Promise((resolve) => setTimeout(resolve, 400));
    return route.fallback();
  });
  await toggle("English").click();
  await toggle("中文").click();
  await expect.poll(() => menuLanguages).toEqual(["de"]);
  await expect(toggle("English")).toHaveAttribute("aria-pressed", "false");
  await expect(toggle("中文")).toHaveAttribute("aria-pressed", "false");
  // A menu has to be in some language.
  await expect(toggle("Deutsch")).toBeDisabled();
  // The style was never part of these saves.
  expect(menuTheme).toBe("jade");
});

test("a combo is built by packaging existing dishes into a new entry", async ({ page }) => {
  await page.unroute("**/api/admin/products");
  let posted;
  await page.route("**/api/admin/products", async (route) => {
    if (route.request().method() !== "POST") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [
        {
          id: "80", sku: "FOOD-80", kind: "food", category: "MAIN",
          names: { zh: "黑椒牛柳", de: "Rinderfilet", en: "Beef Fillet" }, description: "",
          price: 34.5, allergens: ["F"], details: { ingredients: "Rind", time: "35 min", people: "2", level: "Mittel" },
          appearance: { art: "#222", pattern: "ring" }, available: true, published: true, printStation: "kitchen", media: [], modifiers: []
        },
        {
          id: "81", sku: "DRINK-81", kind: "drink", category: "WINE",
          names: { zh: "红酒", de: "Rotwein", en: "Red Wine" }, description: "",
          price: 8, allergens: [], details: { ingredients: "", time: "", people: "", level: "" },
          appearance: { art: "#333", pattern: "dots" }, available: true, published: true, printStation: "bar", media: [], modifiers: []
        }
      ] }) });
    }
    posted = route.request().postDataJSON();
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ product: {
      id: "combo-1", sku: "SET-1", kind: posted.kind, category: posted.category, names: posted.names,
      description: posted.description, price: posted.price, allergens: posted.allergens,
      details: posted.details, appearance: { art: "", pattern: "lines" }, available: true, published: true,
      printStation: posted.printStation, media: [], modifiers: [], bundleItems: posted.bundleItems
    } }) });
  });

  await page.getByRole("button", { name: "菜品", exact: true }).click();
  await expect(page.locator(".product-list")).toContainText("黑椒牛柳");
  // "套餐" lists the dishes that package others — none yet.
  await page.locator(".filter-tabs").getByRole("button", { name: "套餐" }).click();
  await expect(page.locator(".product-row")).toHaveCount(0);
  await page.locator(".filter-tabs").getByRole("button", { name: "全部" }).click();
  // On a phone the list and the form take turns; the button opens a blank one.
  await page.getByRole("button", { name: "＋ 新增菜品" }).click();

  await page.locator('input[name="category"]').fill("SET");
  await page.locator('input[name="nameZh"]').fill("双人套餐");
  await page.locator('input[name="price"]').fill("39.90");

  // Dishes go in by search and a tap; each one then shows with its quantity.
  const picker = page.locator(".bundle-picker");
  await expect(picker.locator(".bundle-chosen")).toHaveCount(0);
  await picker.locator(".bundle-search").fill("黑椒");
  await expect(picker.locator(".bundle-option")).toHaveCount(1);
  await picker.locator(".bundle-option", { hasText: "黑椒牛柳" }).click();
  await picker.locator(".bundle-search").fill("");
  await picker.locator(".bundle-option", { hasText: "红酒" }).click();
  const chosen = picker.locator(".bundle-chosen li");
  await expect(chosen).toHaveCount(2);
  await expect(picker.locator(".bundle-option")).toHaveCount(0);
  await chosen.filter({ hasText: "红酒" }).locator('input[type="number"]').fill("2");
  // Taken out and put back: still one line per dish.
  await chosen.filter({ hasText: "红酒" }).getByRole("button", { name: "从套餐移除" }).click();
  await expect(chosen).toHaveCount(1);
  await picker.locator(".bundle-option", { hasText: "红酒" }).click();
  await chosen.filter({ hasText: "红酒" }).locator('input[type="number"]').fill("2");

  await page.getByRole("button", { name: "创建菜品" }).click({ force: true });
  await expect.poll(() => posted?.bundleItems).toEqual([
    { productId: "80", quantity: 1 },
    { productId: "81", quantity: 2 }
  ]);
});

test("admin controls remain usable in the responsive matrix", async ({ page }) => {
  await expect(page.getByRole("navigation", { name: "管理模块" })).toBeInViewport();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  // Only a separately installed tablet needs a server address, so the form
  // stays folded until someone asks for it.
  await page.getByText("服务器连接").click();
  await expect(page.getByRole("button", { name: "测试并保存" })).toBeVisible();
});

test("a waiter tablet only gets the board, never the catalog", async ({ page }) => {
  await page.unroute("**/api/admin/session");
  await page.route("**/api/admin/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ role: "staff" }) }));
  await page.route("**/api/orders*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ orders: [] }) }));
  await page.route("**/api/service-requests*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ requests: [] }) }));
  await page.route("**/api/admin/print-jobs*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jobs: [] }) }));
  await page.route("**/api/admin/tables/overview", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tables: [] }) }));
  await page.goto("/admin.html");

  await expect(page.getByText("服务员")).toBeVisible();
  // A waiter runs the floor, so the board and the room are theirs; the menu,
  // the printers and the table tokens are not.
  await expect(page.getByRole("navigation", { name: "管理模块" })).toHaveText("订单桌位");
  await expect(page.getByRole("button", { name: "菜品", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "打印", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "设置", exact: true })).toHaveCount(0);
  await expect(page.locator("#boardPanel")).toBeVisible();
});

test("a kitchen screen sees orders without billing or service calls", async ({ page }) => {
  await page.unroute("**/api/admin/session");
  await page.route("**/api/admin/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ role: "kitchen" }) }));
  await page.route("**/api/orders*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ orders: [{
    id: "order-1", clientRequestId: "c1", no: "260817-001", table: "07", status: "new", note: "",
    total: 12.5, items: [{ id: "photo-r1", name: "蔬菜拉面", qty: 1 }], createdAt: new Date().toISOString()
  }] }) }));
  await page.goto("/admin.html");

  await expect(page.getByText("厨房")).toBeVisible();
  await expect(page.locator(".board-card")).toContainText("蔬菜拉面");
  await expect(page.getByRole("button", { name: /更新为：制作中/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "取消订单" })).toHaveCount(0);
  await expect(page.getByText("结账")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "桌位" })).toHaveCount(0);
});

test("a table card carries the entry link a guest phone will scan", async ({ page }) => {
  // The panel loads tables and the audit log together, so a missing audit stub
  // takes the table list down with it.
  await page.route("**/api/admin/audit*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ entries: [] }) }));
  await page.route("**/api/admin/tables", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tables: [
    { table: "12", label: "窗边", token: "tok-12-secret", enabled: true },
    { table: "07", label: "", token: "tok-07-secret", enabled: true }
  ] }) }));
  await page.goto("/admin.html");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: /生成桌卡/ }).click();

  const cards = page.locator(".table-card");
  await expect(cards).toHaveCount(2);
  // The card speaks the menu's languages (English and German here), not the
  // language the admin happens to be reading in.
  await expect(cards.first()).toContainText("Table · Tisch 12");
  await expect(cards.first()).toContainText("Scan for the menu · Speisekarte scannen");
  await expect(cards.first()).toContainText("窗边");

  // The picture has to encode the link, not merely exist. Decoding a QR in a
  // test is more machinery than it is worth; the module that draws it is given
  // the URL, so assert on what it was given and that something was drawn.
  await expect(cards.first().locator("svg")).toBeVisible();
  const modules = await cards.first().locator("svg rect, svg path").count();
  expect(modules, "an empty svg would render as a blank card on every table").toBeGreaterThan(0);
});

test("the table page shows what is on each table, and locking stops it ordering", async ({ page }) => {
  const overview = [
    {
      table: "07", label: "窗边", enabled: true, locked: false, lockedAt: null, registered: true,
      state: "seated", total: 27.4, since: new Date().toISOString(),
      orders: [{
        id: "order-1", clientRequestId: "c1", no: "260902-001", table: "07", status: "preparing",
        note: "少盐", total: 27.4, createdAt: new Date().toISOString(),
        items: [{ id: "photo-r1", name: "蔬菜拉面", qty: 2, modifiers: [{ name: "加面" }] }]
      }]
    },
    { table: "08", label: "", enabled: true, locked: false, lockedAt: null, registered: true, state: "free", total: 0, since: null, orders: [] },
    { table: "09", label: "", enabled: true, locked: true, lockedAt: new Date().toISOString(), registered: true, state: "locked", total: 9.9, since: new Date().toISOString(), orders: [] }
  ];
  await page.unroute("**/api/admin/tables/overview");
  await page.route("**/api/admin/tables/overview", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tables: overview }) }));
  let lockedWith = null;
  await page.route("**/api/admin/tables/07/lock", (route) => {
    lockedWith = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ table: { table: "07", label: "窗边", token: "t", enabled: true, locked: true, lockedAt: new Date().toISOString() } }) });
  });
  await page.goto("/admin.html");
  await page.getByRole("button", { name: "桌位" }).click();

  const seven = page.locator(".table-tile", { hasText: "桌 07" });
  // What a manager asked for: the state, and what has actually been ordered.
  await expect(seven.locator(".status").first()).toHaveText("用餐中");
  await expect(seven).toContainText("蔬菜拉面");
  await expect(seven).toContainText("加面");
  await expect(seven).toContainText("€27.40");
  await expect(page.locator(".table-tile", { hasText: "桌 08" }).locator(".status").first()).toHaveText("空闲");
  await expect(page.locator(".table-tile", { hasText: "桌 09" }).locator(".status").first()).toHaveText("已锁定");
  // A table already locked offers the way back, not a second lock.
  await expect(page.locator(".table-tile", { hasText: "桌 09" }).getByRole("button", { name: "解除锁定" })).toBeVisible();

  await seven.getByRole("button", { name: "锁定", exact: true }).click();
  await expect.poll(() => lockedWith).toEqual({ locked: true });
});

test("settling a table releases it, and the guest is told why the table refused", async ({ page }) => {
  const table = {
    table: "07", label: "", enabled: true, locked: true, lockedAt: new Date().toISOString(), registered: true,
    state: "locked", total: 12.5, since: new Date().toISOString(),
    orders: [{
      id: "order-1", clientRequestId: "c1", no: "260902-001", table: "07", status: "ready", note: "",
      total: 12.5, createdAt: new Date().toISOString(), items: [{ id: "photo-r1", name: "蔬菜拉面", qty: 1 }]
    }]
  };
  await page.unroute("**/api/admin/tables/overview");
  await page.route("**/api/admin/tables/overview", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tables: [table] }) }));
  await page.route("**/api/admin/tables/07/bill", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ bill: {
    table: "07", orderNos: ["260902-001"], orderIds: ["order-1"],
    items: [{ orderNo: "260902-001", name: "蔬菜拉面", qty: 1, unitPrice: 12.5, lineTotal: 12.5, vatPercent: 10 }],
    vatBreakdown: [{ percent: 10, gross: 12.5, net: 11.36, vat: 1.14 }],
    total: 12.5, issuedAt: new Date().toISOString(), fiscalReceipt: false
  } }) }));
  let settled = false;
  await page.route("**/api/admin/tables/07/bill/settle", (route) => {
    settled = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ bill: { table: "07", orderNos: [], orderIds: [], items: [], vatBreakdown: [], total: 12.5, issuedAt: new Date().toISOString(), fiscalReceipt: false, printJobId: "job-1" } }) });
  });
  await page.goto("/admin.html");
  await page.getByRole("button", { name: "桌位" }).click();
  await page.locator(".table-tile", { hasText: "桌 07" }).getByRole("button", { name: "结账" }).click();

  const bill = page.getByRole("dialog", { name: "账单" });
  await expect(bill).toContainText("€12.50");
  await expect(bill).toContainText("结账后这桌会自动解除锁定");
  await bill.getByRole("button", { name: "打印账单并结账" }).click();
  await expect.poll(() => settled).toBe(true);
  await expect(page.getByRole("status")).toContainText("桌位已释放");
});

test("the console says Admin, and switches its own language without touching the menu's", async ({ page }) => {
  const head = page.locator(".admin-head");
  await expect(head).toContainText("赵云");
  await expect(head).not.toContainText("经理");
  await expect(page.getByRole("navigation", { name: "管理模块" })).toHaveText("菜品订单桌位打印设置");

  const picker = page.getByRole("group", { name: "界面语言" });
  await picker.getByRole("button", { name: "Deutsch" }).click();
  await expect(page.getByRole("navigation", { name: "Bereiche" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Einstellungen", exact: true })).toBeVisible();
  await expect(page).toHaveTitle("赵云 · Admin");

  // A device's choice, kept across reloads; the menu languages are untouched.
  await page.reload();
  await expect(page.getByRole("button", { name: "Einstellungen", exact: true })).toBeVisible();
  expect(menuLanguages).toEqual(["en", "de"]);

  await page.getByRole("group", { name: "Sprache der Oberfläche" }).getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
});

test("the restaurant's name and the menu title are the owner's to change", async ({ page }) => {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.locator('input[name="restaurantName"]').fill("Goldener Drache");
  await page.locator('input[name="menuTitle"]').fill("Speisekarte");
  await page.locator('input[name="restaurantName"]').press("Enter");
  await expect.poll(() => appSettings.restaurantName).toBe("Goldener Drache");
  expect(appSettings.menuTitle).toBe("Speisekarte");
  await expect(page.locator(".admin-head")).toContainText("Goldener Drache");
  await expect(page).toHaveTitle("Goldener Drache · Admin");

  await page.getByRole("group", { name: "默认明暗" }).getByRole("button", { name: /浅色/ }).click();
  await expect.poll(() => appSettings.menuDefaultScheme).toBe("light");
});

test("orders, tables and printers stay out of the way until ordering is switched on", async ({ page }) => {
  appSettings.showOrdering = false;
  await page.reload();
  const nav = page.getByRole("navigation", { name: "管理模块" });
  await expect(nav).toHaveText("菜品设置");

  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("switch", { name: "显示订单、桌位和打印" }).click();
  await expect.poll(() => appSettings.showOrdering).toBe(true);
  await expect(nav).toHaveText("菜品订单桌位打印设置");
});

test("a dish is copied in one tap, and the copy opens ready to change", async ({ page }) => {
  let duplicated = null;
  await page.route("**/api/admin/products/80/duplicate", (route) => {
    duplicated = true;
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ product: {
      id: "81", sku: "ITEM-81", kind: "food", category: "MAIN",
      names: { zh: "黑椒牛柳（副本）", de: "Rinderfilet (Kopie)", en: "Beef Fillet (copy)" }, description: "",
      price: 34.5, allergens: ["F"], details: { ingredients: "Rind", time: "35 min", people: "2", level: "Mittel" },
      appearance: { art: "#222", pattern: "ring" }, available: true, published: false, printStation: "kitchen", media: [], modifiers: []
    } }) });
  });
  await page.getByRole("navigation", { name: "管理模块" }).getByRole("button", { name: "菜品", exact: true }).click();
  await page.locator(".product-row").first().click({ force: true });
  await page.getByRole("button", { name: /复制这个菜品/ }).click();
  await expect.poll(() => duplicated).toBe(true);
  // The copy is what is open now, under names that say so and off the menu.
  await expect(page.locator('input[name="nameZh"]')).toHaveValue("黑椒牛柳（副本）");
  await expect(page.locator('input[name="published"]')).not.toBeChecked();
  await expect(page.getByRole("status")).toContainText("已复制");
});

test("a dish goes onto the promotions page from its editor, and the page is switched on in settings", async ({ page }) => {
  await page.getByRole("navigation", { name: "管理模块" }).getByRole("button", { name: "菜品", exact: true }).click();
  await page.locator(".product-row").first().click({ force: true });
  const toggle = page.getByRole("button", { name: /放到活动页/ });
  await toggle.click();
  await expect.poll(() => appSettings.featuredProductIds).toEqual(["80"]);
  await expect(page.getByRole("button", { name: /在活动页上/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".product-row .feature-mark")).toHaveCount(1);

  await page.getByRole("navigation", { name: "管理模块" }).getByRole("button", { name: "设置", exact: true }).click();
  const card = page.locator(".settings-card", { has: page.locator("#featured-title") });
  await expect(card.locator(".featured-list li")).toContainText(["黑椒牛柳"]);
  await card.getByRole("switch", { name: "在菜单上显示活动页" }).click();
  await expect.poll(() => appSettings.featuredEnabled).toBe(true);
  await card.locator('input[name="featuredTitle"]').fill("主厨套餐");
  await card.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => appSettings.featuredTitle).toBe("主厨套餐");
  await card.getByRole("button", { name: "移除" }).click();
  await expect.poll(() => appSettings.featuredProductIds).toEqual([]);
});

test("no admin screen is wider than the window, at any common width", async ({ page }) => {
  // Hidden radios once took the page's full width, so the console scrolled
  // sideways into empty space on every screen with the dish editor open.
  // Measured against the width set here, not window.innerWidth: a phone-sized
  // browser widens its layout to fit oversized content, which hides the bug.
  let width = 0;
  const fits = () => page.evaluate((limit) => document.scrollingElement.scrollWidth <= limit + 1, width);
  for (width of [360, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("navigation", { name: "管理模块" }).getByRole("button", { name: "菜品", exact: true }).click();
    expect(await fits(), `dishes at ${width}px`).toBe(true);
    await page.locator(".product-row").first().click({ force: true });
    expect(await fits(), `dish editor at ${width}px`).toBe(true);
    await page.getByRole("navigation", { name: "管理模块" }).getByRole("button", { name: "设置", exact: true }).click();
    expect(await fits(), `settings at ${width}px`).toBe(true);
  }
});

test("on a computer the dishes page fits the window, and the long list scrolls inside its own box", async ({ page }) => {
  const dish = (index) => ({
    id: `dish-${index}`, sku: `D${index}`, kind: "food", category: "MAIN",
    names: { zh: `菜品 ${index}`, de: `Gericht ${index}`, en: `Dish ${index}` }, description: "",
    price: 10 + index, allergens: [], details: {}, appearance: { art: "#222", pattern: "ring" },
    available: true, published: true, printStation: "kitchen", media: [], modifiers: []
  });
  await page.unroute("**/api/admin/products");
  await page.route("**/api/admin/products", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: Array.from({ length: 120 }, (_, index) => dish(index + 1)) }) }));
  for (const [width, height] of [[1024, 700], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await page.reload();
    await expect(page.locator(".product-row")).toHaveCount(120);
    const measured = await page.evaluate(() => {
      const list = document.querySelector(".product-list");
      const frame = document.querySelector(".catalog-layout").getBoundingClientRect();
      return {
        page: document.scrollingElement.scrollHeight,
        listScrolls: list.scrollHeight > list.clientHeight + 100,
        frameBottom: frame.bottom
      };
    });
    expect(measured.page, `the page at ${width}×${height} is no taller than the window`).toBeLessThanOrEqual(height + 1);
    expect(measured.frameBottom).toBeLessThanOrEqual(height);
    expect(measured.listScrolls, `the list at ${width}px scrolls inside its box`).toBe(true);
    // The last dish is reached by scrolling the list, and opens like any other.
    await page.locator(".product-row").last().click();
    await expect(page.locator("#productForm input").first()).toBeVisible();
  }
});

test("the header and tabs stay on screen, and a long page goes back to its top in one tap", async ({ page }) => {
  const dish = (index) => ({
    id: `dish-${index}`, sku: `D${index}`, kind: "food", category: "MAIN",
    names: { zh: `菜品 ${index}`, de: `Gericht ${index}`, en: `Dish ${index}` }, description: "",
    price: 10 + index, allergens: [], details: {}, appearance: { art: "#222", pattern: "ring" },
    available: true, published: true, printStation: "kitchen", media: [], modifiers: []
  });
  await page.unroute("**/api/admin/products");
  await page.route("**/api/admin/products", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: Array.from({ length: 120 }, (_, index) => dish(index + 1)) }) }));
  const toTop = page.getByRole("button", { name: "回到顶部" });
  const tabs = page.getByRole("navigation", { name: "管理模块" });

  // A phone: the whole page scrolls, under the header and the tabs.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator(".product-row")).toHaveCount(120);
  await expect(page.locator(".back-to-top")).not.toHaveClass(/\bon\b/);
  await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight / 2));
  await expect(toTop).toBeVisible();
  expect((await page.locator(".admin-head").boundingBox()).y).toBe(0);
  await expect(tabs).toBeInViewport();
  await toTop.click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  // A computer: the dish list scrolls in its own box, and the button follows it there.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await expect(page.locator(".product-row")).toHaveCount(120);
  const list = page.locator(".product-list");
  await list.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await expect(toTop).toBeVisible();
  await toTop.click();
  await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBe(0);
  await expect(page.locator(".back-to-top")).not.toHaveClass(/\bon\b/);

  // Settings is a long page too; the header stays while it scrolls.
  await tabs.getByRole("button", { name: "设置", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.evaluate(() => window.scrollTo(0, document.scrollingElement.scrollHeight));
  expect((await page.locator(".admin-head").boundingBox()).y).toBe(0);
  await expect(tabs).toBeInViewport();
  await expect(toTop).toBeVisible();
});

test("the menu's QR code downloads as a PNG that a phone can scan", async ({ page }) => {
  await page.route("**/api/admin/audit*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ entries: [] }) }));
  await page.route("**/api/admin/tables", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tables: [
    { table: "12", label: "窗边", token: "tok-12-secret", enabled: true }
  ] }) }));
  await page.goto("/admin.html");
  await page.getByRole("navigation", { name: "管理模块" }).getByRole("button", { name: "设置", exact: true }).click();

  /** The downloaded file, decoded in the page by a real QR reader. */
  const scan = async (trigger) => {
    const [download] = await Promise.all([page.waitForEvent("download"), trigger()]);
    const bytes = readFileSync(await download.path());
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    const text = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      return window.jsQR(pixels.data, pixels.width, pixels.height)?.data ?? null;
    }, bytes.toString("base64"));
    return { name: download.suggestedFilename(), text };
  };
  await page.addScriptTag({ path: require.resolve("jsqr/dist/jsQR.js") });

  // The code has to carry exactly the link the console shows for that table.
  const row = page.locator(".table-row", { hasText: "桌 12" });
  const shown = await row.locator("code").textContent();
  expect(shown).toContain("?table=12&k=tok-12-secret");

  const menu = await scan(() => page.getByRole("button", { name: /下载菜单二维码/ }).click());
  expect(menu.name).toBe("menu-qr.png");
  expect(menu.text).toBe(shown.split("?")[0]);

  const table = await scan(() => row.getByRole("button", { name: /二维码/ }).click());
  expect(table.name).toBe("table-12-qr.png");
  expect(table.text).toBe(shown);
});

test("a set opened for editing shows its dishes, and saving it keeps them", async ({ page }) => {
  // The console once mapped products without their contents: a set opened
  // empty, and pressing save wiped what it held.
  const beef = {
    id: "80", sku: "FOOD-80", kind: "food", category: "MAIN",
    names: { zh: "黑椒牛柳", de: "Rinderfilet", en: "Beef Fillet" }, description: "",
    price: 34.5, allergens: ["F"], details: { ingredients: "", time: "", people: "", level: "" },
    appearance: { art: "#222", pattern: "ring" }, available: true, published: true, printStation: "kitchen", media: [], modifiers: []
  };
  const set = { ...beef, id: "set-1", sku: "SET-1", category: "SET", names: { zh: "双人套餐", de: "Menü für zwei", en: "Set for Two" }, price: 39, bundleItems: [{ productId: "80", quantity: 2 }] };
  await page.unroute("**/api/admin/products");
  await page.route("**/api/admin/products", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [beef, set] }) }));
  let saved;
  await page.route("**/api/admin/products/set-1", (route) => {
    saved = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ product: set }) });
  });
  await page.reload();
  await page.getByRole("navigation", { name: "管理模块" }).getByRole("button", { name: "菜品", exact: true }).click();
  // A set's thumbnail is its dishes, and "套餐" lists it.
  await page.locator(".filter-tabs").getByRole("button", { name: "套餐" }).click();
  await expect(page.locator(".product-row")).toHaveCount(1);
  await page.locator(".product-row", { hasText: "双人套餐" }).click({ force: true });
  const chosen = page.locator(".bundle-chosen li");
  await expect(chosen).toHaveCount(1);
  await expect(chosen).toContainText("黑椒牛柳");
  await expect(chosen.locator('input[type="number"]')).toHaveValue("2");
  await page.getByRole("button", { name: "保存修改" }).click({ force: true });
  await expect.poll(() => saved?.bundleItems).toEqual([{ productId: "80", quantity: 2 }]);
});

test("the promotions and set menus pages are given hours in settings, and have them taken away", async ({ page }) => {
  appSettings.featuredSchedule = null;
  appSettings.setsSchedule = null;
  appSettings.timeZone = "Europe/Vienna";
  const saves = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/admin/settings") && request.method() === "PUT") saves.push(request.postDataJSON());
  });
  await page.reload();
  await page.getByRole("navigation", { name: "管理模块" }).getByRole("button", { name: "设置", exact: true }).click();
  const card = (title) => page.locator(".settings-card", { has: page.getByRole("heading", { name: title, exact: true }) });

  // The set menus page: weekends, 11:30 to 15:00.
  const sets = card("套餐页");
  await expect(sets.locator(".schedule-days")).toHaveCount(0);
  await sets.getByText("只在设定的时间段显示").click();
  await sets.getByRole("button", { name: "周末" }).click();
  await sets.getByLabel("开始").fill("11:30");
  await sets.getByLabel("结束").fill("15:00");
  await expect(sets.locator(".schedule-status")).toContainText("周末 11:30–15:00");
  await sets.getByRole("button", { name: "保存时间段" }).click();
  await expect.poll(() => saves.at(-1)?.setsSchedule).toEqual({ days: [6, 7], from: "11:30", to: "15:00" });
  await expect(sets.getByRole("button", { name: "已保存" })).toBeDisabled();

  // No day left is caught before anything is saved.
  await sets.getByRole("button", { name: "六", exact: true }).click();
  await sets.getByRole("button", { name: "日", exact: true }).click();
  await expect(sets.locator(".schedule-status")).toHaveText("至少选一天");
  await expect(sets.getByRole("button", { name: "保存时间段" })).toBeDisabled();

  // Switched off, the hours go at once: always on the menu again.
  const count = saves.length;
  await sets.getByText("只在设定的时间段显示").click();
  await expect.poll(() => saves.length).toBe(count + 1);
  expect(saves.at(-1).setsSchedule).toBeNull();

  // The promotions page has its own.
  const featured = card("活动页");
  await featured.getByText("只在设定的时间段显示").click();
  await featured.getByRole("button", { name: "保存时间段" }).click();
  await expect.poll(() => saves.at(-1)?.featuredSchedule).toEqual({ days: [1, 2, 3, 4, 5], from: "11:00", to: "14:30" });
});

test("a settings card folds to its title and what is set in it, and stays folded", async ({ page }) => {
  await page.getByRole("navigation", { name: "管理模块" }).getByRole("button", { name: "设置", exact: true }).click();
  const card = page.locator(".settings-card", { has: page.getByRole("heading", { name: "餐厅", exact: true }) });
  await expect(card.getByLabel("餐厅名称")).toBeVisible();
  await card.locator("summary").click();
  await expect(card.getByLabel("餐厅名称")).toBeHidden();
  await expect(card.locator(".settings-summary")).toHaveText("赵云 · La Carte");
  await page.reload();
  await page.getByRole("navigation", { name: "管理模块" }).getByRole("button", { name: "设置", exact: true }).click();
  await expect(card.getByLabel("餐厅名称")).toBeHidden();
  await card.locator("summary").click();
  await expect(card.getByLabel("餐厅名称")).toBeVisible();
});

test("on a computer, a long set's editor keeps its save button on screen", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  const dishes = Array.from({ length: 12 }, (_, index) => ({
    id: `d${index}`, sku: `D${index}`, kind: "food", category: "MAIN", names: { zh: `菜 ${index}`, de: `Gericht ${index}`, en: `Dish ${index}` },
    description: "", price: 10, allergens: [], details: {}, appearance: { art: "#222", pattern: "ring" }, available: true, published: true, printStation: "kitchen", media: [], modifiers: []
  }));
  const set = { ...dishes[0], id: "set", sku: "SET", names: { zh: "大套餐", de: "Großes Menü", en: "Big Set" }, bundleItems: dishes.map((dish) => ({ productId: dish.id, quantity: 1 })) };
  await page.unroute("**/api/admin/products");
  await page.route("**/api/admin/products", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [...dishes, set] }) }));
  await page.reload();
  await page.locator(".product-row", { hasText: "大套餐" }).click();
  await expect(page.getByRole("button", { name: "保存修改" })).toBeInViewport();
});

test("the second and third tabs are chosen in settings, and cannot be the same", async ({ page }) => {
  appSettings.navPinned = [];
  const dish = (id, category) => ({ id, sku: id, kind: "food", category, names: { zh: id, de: id, en: id }, description: "", price: 9, allergens: [], details: {}, appearance: { art: "#222", pattern: "ring" }, available: true, published: true, printStation: "kitchen", media: [], modifiers: [] });
  await page.unroute("**/api/admin/products");
  await page.route("**/api/admin/products", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [
    dish("r1", "RAMEN"), dish("s1", "SUSHI"), { ...dish("set", "SET"), bundleItems: [{ productId: "r1", quantity: 1 }] }
  ] }) }));
  await page.reload();
  await page.getByRole("navigation", { name: "管理模块" }).getByRole("button", { name: "设置", exact: true }).click();
  const card = page.locator(".settings-card", { has: page.getByRole("heading", { name: "导航标签顺序", exact: true }) });
  const second = card.getByLabel("第 2 个");
  const third = card.getByLabel("第 3 个");
  await expect(card.locator(".nav-order-fixed")).toContainText("套餐");
  // The third opens once the second is set.
  await expect(third).toBeDisabled();
  await second.selectOption("SUSHI");
  await expect.poll(() => appSettings.navPinned).toEqual(["SUSHI"]);
  await expect(third).toBeEnabled();
  // What is second cannot also be third.
  await expect(third.locator('option[value="SUSHI"]')).toHaveJSProperty("disabled", true);
  await third.selectOption("ALLE");
  await expect.poll(() => appSettings.navPinned).toEqual(["SUSHI", "ALLE"]);
  await expect(second.locator('option[value="ALLE"]')).toHaveJSProperty("disabled", true);
  // The preview is the order a guest gets.
  await expect(card.locator(".nav-order-preview li")).toHaveText(["套餐", "SUSHI", "全部", "RAMEN"]);
});

test("the console can be installed as a desktop app", async ({ page, request }) => {
  // What a browser reads before it offers to install: the manifest and its icons.
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  const manifest = await (await request.get(manifestHref)).json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("admin.html");
  for (const icon of manifest.icons) {
    const response = await request.get(new URL(icon.src, new URL(manifestHref, "http://127.0.0.1:5173/")).pathname);
    expect(response.status(), icon.src).toBe(200);
  }
  expect(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable")).toBe(true);

  // No offer from the browser: Settings says how, for the browser in use.
  await page.getByRole("navigation", { name: "管理模块" }).getByRole("button", { name: "设置", exact: true }).click();
  const card = page.locator(".settings-card", { has: page.getByRole("heading", { name: "桌面版", exact: true }) });
  // Chrome on a computer is pointed at the address bar; an Android phone at its menu.
  await expect(card.locator(".install-steps")).toContainText(/「安装」|「安装应用」/);
  await expect(page.locator(".head-install")).toHaveCount(0);

  // The browser offers it (Chrome, Edge): one tap in the header asks, and once
  // it is installed the button goes.
  await page.evaluate(() => {
    const offer = new Event("beforeinstallprompt", { cancelable: true });
    window.__prompted = false;
    Object.assign(offer, { prompt: async () => { window.__prompted = true; }, userChoice: Promise.resolve({ outcome: "accepted" }) });
    window.dispatchEvent(offer);
  });
  const header = page.locator(".head-install");
  if ((page.viewportSize()?.width ?? 0) > 520) {
    await header.click();
    await expect.poll(() => page.evaluate(() => window.__prompted)).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    await expect(header).toHaveCount(0);
    await expect(card.locator(".install-state")).toBeVisible();
  } else {
    // A phone keeps its header to three buttons; Settings has the install.
    await expect(header).toBeHidden();
    await card.getByRole("button", { name: /安装桌面版/ }).click();
    await expect.poll(() => page.evaluate(() => window.__prompted)).toBe(true);
  }
});

test("the restaurant's time zone is chosen in settings", async ({ page }) => {
  appSettings.timeZone = "Europe/Vienna";
  await page.reload();
  await page.getByRole("navigation", { name: "管理模块" }).getByRole("button", { name: "设置", exact: true }).click();
  const zone = page.getByLabel("时区");
  await expect(zone).toHaveValue("Europe/Vienna");
  // The main zones only, by name, not the four hundred the world has.
  expect(await zone.locator("option").allTextContents()).toEqual(["维也纳", "柏林", "苏黎世", "罗马", "巴黎", "伦敦", "北京"]);
  await zone.selectOption("Europe/Berlin");
  await page.locator(".settings-card", { has: page.getByRole("heading", { name: "餐厅", exact: true }) }).getByRole("button", { name: "保存" }).click();
  await expect.poll(() => appSettings.timeZone).toBe("Europe/Berlin");
});

test("the header fits on the narrowest phone, every button inside the screen and drawn", async ({ page }) => {
  // The sign-out icon was a font glyph some Android phones do not have — an
  // empty circle — and the header ran off the right edge of a phone.
  for (const width of [320, 360, 412]) {
    await page.setViewportSize({ width, height: 800 });
    const buttons = page.locator(".admin-head .head-action");
    await expect(buttons).toHaveCount(2);
    for (const button of await buttons.all()) {
      const box = await button.boundingBox();
      expect(box.x + box.width, `a header button leaves a ${width}px screen`).toBeLessThanOrEqual(width);
      const icon = await button.locator("svg").boundingBox();
      expect(icon.width).toBeGreaterThan(10);
    }
    const flags = await page.locator(".admin-head .admin-languages").boundingBox();
    expect(flags.x + flags.width).toBeLessThanOrEqual(width);
  }
});

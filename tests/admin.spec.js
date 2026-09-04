import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("zy_admin_token", "test-admin"));
  await page.route("**/api/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }));
  await page.route("**/api/admin/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ role: "manager" }) }));
  await page.route("**/api/admin/products", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [{
    id: "80", sku: "FOOD-80", kind: "food", category: "MAIN",
    names: { zh: "黑椒牛柳", de: "Rinderfilet", en: "Beef Fillet" }, description: "",
    price: 34.5, allergens: ["F"], details: { ingredients: "Rind", time: "35 min", people: "2", level: "Mittel" },
    appearance: { art: "#222", pattern: "ring" }, available: true, published: true, printStation: "kitchen", media: [], modifiers: [{ id: "spice", names: { zh: "辣度", de: "Scharf", en: "Spice" }, selection: "single", options: [] }]
  }] }) }));
  await page.route("**/api/admin/printers", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ printers: [{ id: "printer-1", name: "厨房打印机", transport: "lan", address: "192.168.1.88", port: 9100, role: "kitchen", enabled: true }] }) }));
  await page.goto("/admin.html");
});

test("admin workspace loads catalog and printer modules", async ({ page }) => {
  await expect(page.getByText("服务器在线")).toBeVisible();
  await expect(page.locator(".product-list")).toContainText("黑椒牛柳");
  await page.locator(".product-row").click({ force: true });
  await expect(page.locator('textarea[name="modifiers"]')).toHaveValue(/"spice"/);
  await page.getByRole("button", { name: "打印机" }).click();
  await expect(page.locator(".printer-list")).toContainText("厨房打印机");
  await page.getByRole("button", { name: /搜索周围打印机/ }).click();
  await expect(page.getByRole("status")).toContainText("Android App");
});

test("admin controls remain usable in the responsive matrix", async ({ page }) => {
  await expect(page.getByRole("navigation", { name: "管理模块" })).toBeInViewport();
  await page.getByRole("button", { name: "连接设置" }).click();
  await expect(page.getByRole("button", { name: "测试并保存连接" })).toBeVisible();
});

test("a waiter tablet only gets the board, never the catalog", async ({ page }) => {
  await page.unroute("**/api/admin/session");
  await page.route("**/api/admin/session", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ role: "staff" }) }));
  await page.route("**/api/orders*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ orders: [] }) }));
  await page.route("**/api/service-requests*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ requests: [] }) }));
  await page.route("**/api/admin/print-jobs*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jobs: [] }) }));
  await page.route("**/api/admin/tables/open", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tables: [] }) }));
  await page.goto("/admin.html");

  await expect(page.getByText("服务员")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "管理模块" })).toHaveText("订单看板");
  await expect(page.getByRole("button", { name: "商品与媒体" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "连接设置" })).toHaveCount(0);
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
});

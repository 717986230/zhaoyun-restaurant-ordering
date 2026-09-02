import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("zy_admin_token", "test-admin"));
  await page.route("**/api/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }));
  await page.route("**/api/admin/products", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [{
    id: "80", sku: "FOOD-80", kind: "food", category: "MAIN",
    names: { zh: "黑椒牛柳", de: "Rinderfilet", en: "Beef Fillet" }, description: "",
    price: 34.5, allergens: ["F"], details: { ingredients: "Rind", time: "35 min", people: "2", level: "Mittel" },
    appearance: { art: "#222", pattern: "ring" }, available: true, published: true, printStation: "kitchen", media: [], modifiers: [{ id: "spice", names: { zh: "辣度", de: "Scharf", en: "Spice" }, selection: "single", options: [] }]
  }] }) }));
  await page.route("**/api/admin/printers", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ printers: [{ id: "printer-1", name: "厨房打印机", transport: "lan", address: "192.168.1.88", port: 9100, role: "kitchen", enabled: true }] }) }));
  await page.route("**/api/orders?**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ orders: [{
    id: "order-1", clientRequestId: "req-1", no: "260902-001", table: "12", status: "new", note: "少盐", total: 34.5,
    items: [{ id: "80", name: "黑椒牛柳", qty: 2, modifiers: [{ id: "extra-chili", name: "加辣椒", price: 0.5 }] }],
    createdAt: new Date().toISOString()
  }] }) }));
  await page.route("**/api/service-requests?**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ requests: [{
    id: "request-1", table: "12", serviceType: "water", status: "open", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  }] }) }));
  await page.goto("/admin.html");
});

test("orders board renders server orders and advances their status", async ({ page }) => {
  let patched;
  await page.route("**/api/orders/order-1/status", async (route) => {
    patched = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ order: {
      id: "order-1", clientRequestId: "req-1", no: "260902-001", table: "12", status: patched.status, note: "少盐", total: 34.5,
      items: [{ id: "80", name: "黑椒牛柳", qty: 2 }], createdAt: new Date().toISOString()
    } }) });
  });
  await expect(page.getByText("服务器在线")).toBeVisible();
  const order = page.locator(".board-order");
  await expect(order).toContainText("Tisch 12");
  await expect(order).toContainText("黑椒牛柳");
  await expect(order).toContainText("加辣椒");
  await expect(order).toContainText("少盐");
  await expect(page.locator(".board-request")).toContainText("加水");
  await page.getByRole("button", { name: "制作中", exact: true }).click();
  await expect.poll(() => patched?.status).toBe("preparing");
  await expect(page.locator(".board-order .board-status")).toHaveText("制作中");
});

test("service call is acknowledged from the orders board", async ({ page }) => {
  let patched;
  await page.route("**/api/service-requests/request-1/status", async (route) => {
    patched = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ request: {
      id: "request-1", table: "12", serviceType: "water", status: patched.status,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    } }) });
  });
  await expect(page.locator(".board-request")).toContainText("待处理");
  await page.getByRole("button", { name: "已处理" }).click();
  await expect.poll(() => patched?.status).toBe("completed");
  await expect(page.locator(".board-request")).toHaveCount(0);
});

test("admin workspace loads catalog and printer modules", async ({ page }) => {
  await expect(page.getByText("服务器在线")).toBeVisible();
  await page.getByRole("button", { name: "商品与媒体" }).click();
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

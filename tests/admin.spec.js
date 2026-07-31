import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("zy_admin_token", "test-admin"));
  await page.route("**/api/health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }));
  await page.route("**/api/admin/products", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [{
    id: "80", sku: "FOOD-80", kind: "food", category: "MAIN",
    names: { zh: "黑椒牛柳", de: "Rinderfilet", en: "Beef Fillet" }, description: "",
    price: 34.5, allergens: ["F"], details: { ingredients: "Rind", time: "35 min", people: "2", level: "Mittel" },
    appearance: { art: "#222", pattern: "ring" }, available: true, published: true, printStation: "kitchen", media: []
  }] }) }));
  await page.route("**/api/admin/printers", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ printers: [{ id: "printer-1", name: "厨房打印机", transport: "lan", address: "192.168.1.88", port: 9100, role: "kitchen", enabled: true }] }) }));
  await page.goto("/admin.html");
});

test("admin workspace loads catalog and printer modules", async ({ page }) => {
  await expect(page.getByText("服务器在线")).toBeVisible();
  await expect(page.locator(".product-list")).toContainText("黑椒牛柳");
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

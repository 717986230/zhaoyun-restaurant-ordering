import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("dish opens with shared-element detail, adds to cart, and submits an order", async ({ page }) => {
  await page.getByRole("button", { name: /开始点餐/ }).click();
  const beef = page.locator(".dish-card", { hasText: "黑椒牛柳" });
  await expect(beef).toBeVisible();
  await beef.click();
  await expect(page.locator(".dish-overlay")).toHaveClass(/open/);
  await expect(page.locator(".dish-detail-card")).toContainText("Rinderfilet, Pfeffer");
  await expect(page.locator(".menu")).toHaveClass(/detail-open/);
  await page.locator(".dish-detail-card .add").click();
  await expect(page.locator("#cartCount")).toHaveText("1");
  await page.getByRole("button", { name: "关闭详情" }).click();
  await expect(page.locator(".dish-overlay")).not.toHaveClass(/open/);
  await page.locator(".cartbar").click();
  await page.getByRole("button", { name: /确认下单/ }).click();
  await page.locator(".screen.active .back").click();
  await page.locator(".screen.active .back").click();
  await page.getByRole("button", { name: /订单状态/ }).click();
  await expect(page.locator("#ordersContent")).toContainText("订单");
  await expect(page.locator("#ordersContent")).toContainText("新订单");
});

test("service request appears in staff board and can be completed", async ({ page }) => {
  await page.getByRole("button", { name: /呼叫服务员/ }).click();
  await page.getByRole("button", { name: /加水/ }).click();
  await expect(page.locator("#serviceStatus")).toContainText("加水请求已发送");
  await page.getByRole("button", { name: "‹" }).click();
  await page.getByRole("button", { name: /员工看板/ }).click();
  await expect(page.locator("#staffContent")).toContainText("加水");
  await page.getByRole("button", { name: "已处理" }).click();
  await expect(page.locator(".request.done")).toContainText("加水");
});

test("staff can advance order status", async ({ page }) => {
  await page.getByRole("button", { name: /开始点餐/ }).click();
  const beef = page.locator(".dish-card", { hasText: "黑椒牛柳" });
  await beef.click();
  await page.locator(".dish-detail-card .add").click();
  await page.getByRole("button", { name: "关闭详情" }).click();
  await page.locator(".cartbar").click();
  await page.getByRole("button", { name: /确认下单/ }).click();
  await page.locator(".screen.active .back").click();
  await page.locator(".screen.active .back").click();
  await page.getByRole("button", { name: /员工看板/ }).click();
  await page.getByRole("button", { name: /更新为：制作中/ }).click();
  await expect(page.locator("#staffContent")).toContainText("制作中");
});

test("layout keeps main controls visible", async ({ page }) => {
  await expect(page.getByRole("button", { name: /开始点餐/ })).toBeInViewport();
  await page.getByRole("button", { name: /开始点餐/ }).click();
  await expect(page.locator(".cartbar")).toBeInViewport();
  await expect(page.locator(".topbar")).toBeInViewport();
});

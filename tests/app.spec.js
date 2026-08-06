import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  const products = [
    {
      id: "80", sku: "FOOD-80", kind: "food", category: "MAIN",
      names: { zh: "黑椒牛柳", de: "Rinderfilet mit schwarzem Pfeffer", en: "Black Pepper Beef Fillet" },
      description: "Zartes Rinderfilet mit schwarzem Pfeffer.", price: 34.5,
      allergens: ["F", "O"], details: { time: "35 min", people: "2 Personen", level: "Mittel", ingredients: "Rinderfilet, Pfeffer" },
      appearance: { art: "linear-gradient(135deg,#7e1e18,#190f0e 76%)", pattern: "ring" }, media: [],
      modifiers: [{ id: "custom", names: { zh: "口味要求", de: "Sonderwünsche", en: "Preferences" }, selection: "multi", options: [
        { id: "extra-noodles", names: { zh: "加面", de: "Extra Nudeln", en: "Extra noodles" }, priceCents: 250 },
        { id: "no-cilantro", names: { zh: "不要香菜", de: "Ohne Koriander", en: "No cilantro" }, priceCents: 0 },
        { id: "extra-chili", names: { zh: "加辣椒", de: "Extra Chili", en: "Extra chili" }, priceCents: 50 }
      ] }]
    },
    {
      id: "video-1", sku: "SUSHI-01", kind: "sushi", category: "SUSHI",
      names: { zh: "火炙三文鱼寿司", de: "Flambierter Lachs", en: "Torched Salmon Sushi" },
      description: "Flambierter Lachs.", price: 12.8,
      allergens: ["D"], details: { time: "10 min", people: "1 Person", level: "Mild", ingredients: "Lachs, Reis" },
      appearance: { art: "#37231d", pattern: "lines" }, media: [{ type: "video", url: "/media/demo.mp4" }]
    }
  ];
  await page.route("**/api/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products }) }));
  await page.route("**/api/orders", async (route) => {
    const command = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ order: {
      id: "order-1", clientRequestId: command.clientRequestId, no: "260801-001", table: command.table,
      status: "new", note: command.note, total: 34.5, items: command.items, createdAt: new Date().toISOString()
    } }) });
  });
  await page.route("**/api/service-requests", (route) => route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ request: { id: "service-1" } }) }));
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("image and video products use the same 3D flip interaction", async ({ page }) => {
  await page.getByRole("button", { name: /开始点餐/ }).click();
  for (const name of ["黑椒牛柳", "火炙三文鱼寿司"]) {
    await page.locator(".dish-card", { hasText: name }).click();
    await expect(page.locator(".detail-front")).toBeVisible();
    await page.locator(".detail-heading").click({ delay: 50 });
    await expect(page.locator(".detail-flip-inner")).toHaveClass(/flipped/);
    await expect(page.getByRole("region", { name: "菜品详细信息" })).toBeVisible();
    if (name === "黑椒牛柳") {
      await expect(page.getByText("加面")).toBeVisible();
      await expect(page.getByText("不要香菜")).toBeVisible();
      await expect(page.getByText("加辣椒")).toBeVisible();
    }
    await page.getByRole("button", { name: "返回正面" }).click();
    await page.getByRole("button", { name: "关闭详情" }).click();
  }
});

test("language switcher changes home and menu copy", async ({ page }) => {
  await expect(page.getByRole("button", { name: /开始点餐/ })).toBeVisible();
  await page.getByRole("button", { name: "Deutsch" }).click();
  await expect(page.getByRole("button", { name: "Bestellen" })).toBeVisible();
  await page.getByRole("button", { name: "Bestellen" }).click();
  await expect(page.locator(".dish-card", { hasText: "Rinderfilet mit schwarzem Pfeffer" })).toBeVisible();
  await expect(page.locator(".menu .langs")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "English" })).toHaveCount(0);
  await page.getByRole("button", { name: "返回" }).click();
  await page.getByRole("button", { name: "English" }).click();
  await page.getByRole("button", { name: /Start order/ }).click();
  await expect(page.locator(".dish-card", { hasText: "Black Pepper Beef Fillet" })).toBeVisible();
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
  await expect(page.locator(".dish-overlay")).not.toBeAttached();
  await page.locator(".cartbar").click();
  await page.getByRole("button", { name: /确认下单/ }).click();
  await page.locator(".screen.active .back").click();
  await page.locator(".screen.active .back").click();
  await page.getByRole("button", { name: /订单状态/ }).click();
  await expect(page.locator("#ordersContent")).toContainText("订单");
  await expect(page.locator("#ordersContent")).toContainText("新订单");
});

test("dish options are selected before adding and remain attached to cart order", async ({ page }) => {
  let submitted;
  await page.unroute("**/api/orders");
  await page.route("**/api/orders", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ order: {
      id: "customized-order", clientRequestId: submitted.clientRequestId, no: "260806-001", table: submitted.table,
      status: "new", note: submitted.note, total: 37.5, items: [], createdAt: new Date().toISOString()
    } }) });
  });
  await page.getByRole("button", { name: /开始点餐/ }).click();
  await page.locator(".dish-card", { hasText: "黑椒牛柳" }).click();
  await expect(page.getByText("加入购物车前选择口味与加料")).toBeVisible();
  await page.getByText("加面", { exact: true }).click();
  await page.getByText("不要香菜", { exact: true }).click();
  await page.getByText("加辣椒", { exact: true }).click();
  await page.locator(".dish-detail-card .add").click();
  await page.getByRole("button", { name: "关闭详情" }).click();
  await page.locator(".cartbar").click();
  await expect(page.locator(".modifier-summary")).toContainText("加面");
  await expect(page.locator(".modifier-summary")).toContainText("不要香菜");
  await expect(page.locator(".modifier-summary")).toContainText("加辣椒");
  await page.getByRole("button", { name: /确认下单/ }).click();
  await expect.poll(() => submitted?.items?.[0]?.modifiers?.map((modifier) => modifier.id)).toEqual(["extra-noodles", "no-cilantro", "extra-chili"]);
});

test("offline order is persisted and automatically retried", async ({ page }) => {
  await page.unroute("**/api/orders");
  let attempts = 0;
  await page.route("**/api/orders", async (route) => {
    attempts += 1;
    if (attempts < 2) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "offline" }) });
      return;
    }
    const command = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ order: {
      id: "retried-order", clientRequestId: command.clientRequestId, no: "260805-001", table: command.table,
      status: "new", note: command.note, total: 34.5, items: command.items, createdAt: new Date().toISOString()
    } }) });
  });
  await page.getByRole("button", { name: /开始点餐/ }).click();
  await page.locator(".dish-card", { hasText: "黑椒牛柳" }).click();
  await page.locator(".dish-detail-card .add").click();
  await page.getByRole("button", { name: "关闭详情" }).click();
  await page.locator(".cartbar").click();
  await page.getByRole("button", { name: /确认下单/ }).click();
  await expect.poll(() => attempts).toBeGreaterThanOrEqual(2);
  await page.locator(".screen.active .back").click();
  await page.locator(".screen.active .back").click();
  await page.getByRole("button", { name: /订单状态/ }).click();
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

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
      // Sesame is in the ingredients and deliberately not in the declaration:
      // the glossary knows sesame carries N, and the test below is that it
      // still does not put N on the dish. Only the kitchen declares.
      allergens: ["D"], details: { time: "10 min", people: "1 Person", level: "Mild", ingredients: "Lachs, Reis, Sesam" },
      appearance: { art: "#37231d", pattern: "lines" }, media: [{ type: "video", url: "/media/demo.mp4" }]
    },
    {
      // Every term here is in the ingredient glossary, which is what makes the
      // breakdown assertions below about the feature rather than about a
      // fixture nobody translated.
      id: "ramen-1", sku: "R1", kind: "food", category: "RAMEN",
      names: { zh: "蔬菜拉面", de: "Ramen mit Gemüse", en: "Ramen with Vegetables" },
      description: "Ramen, Gemüse, Ei.", price: 12.5,
      allergens: ["A", "C", "F"], details: { time: "20 min", people: "1 Person", level: "Mild", ingredients: "Ramen, Gemüse, Ei" },
      appearance: { art: "#1d2320", pattern: "dots" }, media: []
    },
    {
      // A 套餐: its own entry, its own price and photo, that also names the
      // existing dishes it packages — not a new product kind.
      id: "combo-1", sku: "SET-1", kind: "food", category: "SET",
      names: { zh: "双人套餐", de: "Menü für zwei", en: "Set for Two" },
      description: "Rinderfilet und Ramen zusammen.", price: 42,
      allergens: [], details: { time: "35 min", people: "2 Personen", level: "Mild", ingredients: "" },
      appearance: { art: "#2a2318", pattern: "ring" }, media: [],
      bundleItems: [{ productId: "80", quantity: 1 }, { productId: "ramen-1", quantity: 2 }]
    }
  ];
  await page.route("**/api/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products }) }));
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("opening the app goes straight to the menu, with nothing to click through first", async ({ page }) => {
  // An NFC tap or a scanned table card used to land on a home screen with
  // four things to choose between. The app takes no orders any more, so
  // there is exactly one guest screen, and it is this one.
  await expect(page.locator("#menu.active")).toBeVisible();
  await expect(page.locator(".dish-card").first()).toBeVisible();
  await expect(page.locator("#home")).toHaveCount(0);
  await expect(page.locator(".cartbar")).toHaveCount(0);
});

test("image and video products use the same 3D flip interaction", async ({ page }) => {
  for (const name of ["黑椒牛柳", "火炙三文鱼寿司"]) {
    await page.locator(".dish-card", { hasText: name }).click();
    await expect(page.locator(".detail-front")).toBeVisible();
    await page.locator(".detail-heading").click({ delay: 50 });
    await expect(page.locator(".detail-flip-inner")).toHaveClass(/flipped/);
    await expect(page.getByRole("region", { name: "菜品详细信息" })).toBeVisible();
    if (name === "黑椒牛柳") {
      // Modifiers are read, not picked: there is no cart to attach them to,
      // so the admin's "加面 / 不要香菜 / 加辣椒" configuration shows up as a
      // sentence a guest can ask the waiter about.
      await expect(page.getByText("加面")).toBeVisible();
      await expect(page.getByText("不要香菜")).toBeVisible();
      await expect(page.getByText("加辣椒")).toBeVisible();
    }
    await page.getByRole("button", { name: "返回正面" }).click();
    await page.getByRole("button", { name: "关闭详情" }).click();
  }
});

test("the language button cycles the menu through Chinese, German and English", async ({ page }) => {
  // Three languages, one button: it always shows the language a tap switches
  // to, so "中文" means tapping it goes to Chinese from wherever it is now.
  await expect(page.locator(".dish-card", { hasText: "黑椒牛柳" })).toBeVisible();
  const toggle = page.getByRole("button", { name: "中文" });
  await expect(toggle).toBeVisible();

  await toggle.click();
  await expect(page.getByRole("button", { name: "Deutsch" })).toBeVisible();
  await expect(page.locator(".dish-card", { hasText: "Rinderfilet mit schwarzem Pfeffer" })).toBeVisible();

  await page.getByRole("button", { name: "Deutsch" }).click();
  await expect(page.getByRole("button", { name: "English" })).toBeVisible();
  await expect(page.locator(".dish-card", { hasText: "Black Pepper Beef Fillet" })).toBeVisible();

  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("button", { name: "中文" })).toBeVisible();
  await expect(page.locator(".dish-card", { hasText: "黑椒牛柳" })).toBeVisible();
});

test("the chosen language survives a reload", async ({ page }) => {
  await page.getByRole("button", { name: "中文" }).click();
  await expect(page.getByRole("button", { name: "Deutsch" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Deutsch" })).toBeVisible();
  await expect(page.locator(".dish-card", { hasText: "Rinderfilet mit schwarzem Pfeffer" })).toBeVisible();
});

test("German menu copy replaces the Chinese chrome, all the way into a dish", async ({ page }) => {
  await page.getByRole("button", { name: "中文" }).click();
  await expect(page.getByRole("button", { name: "Deutsch" })).toBeVisible();

  await expect(page.getByRole("button", { name: "Gericht suchen" })).toBeVisible();

  await page.locator(".dish-card", { hasText: "Rinderfilet mit schwarzem Pfeffer" }).click();
  await expect(page.locator(".dish-options-group").first()).toContainText("Extra Nudeln");
  await expect(page.getByRole("button", { name: "Details schließen" })).toBeVisible();

  await page.locator(".detail-heading").click({ delay: 50 });
  await expect(page.getByText("Allergene")).toBeVisible();
});

test("a tablet that has never reached the server shows the menu the app ships with", async ({ page }) => {
  // A freshly installed tablet has no cache and, until someone configures the
  // API address, no server either. It used to invent 15 demo dishes whose ids
  // the server had never issued, so anything ordered from them was rejected for
  // good on reconnect; then it showed nothing at all. It now ships the real
  // seeded catalogue, which is why the SKU below has to be one the server
  // actually serves.
  await page.unroute("**/api/catalog");
  await page.route("**/api/catalog", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "offline" }) }));
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await expect(page.locator(".dish-card").first()).toBeVisible();
  expect(await page.locator(".dish-card").count()).toBeGreaterThan(100);
  await expect(page.locator(".dish-card .number").first()).toHaveText("R1");
  await expect(page.locator(".local-board-note")).toContainText("离线菜单");
});

// The CSS prefers-reduced-motion block cannot reach motion/react's JS-driven
// animations, so the flip has to opt out in JS. The 250ms budget sits well
// inside the 0.42s an animated flip takes, with frames to spare on a slow
// runner. `test.use({ reducedMotion })` does not reach the page under these
// device projects, so the preference is emulated on the page directly.
const flippedTransform = "matrix3d(-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1)";

async function flipDetailCard(page) {
  await page.locator(".dish-card", { hasText: "黑椒牛柳" }).click();
  await expect(page.locator(".detail-front")).toBeVisible();
  await page.locator(".detail-heading").click();
}

test("detail flip settles immediately when the device asks for reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await flipDetailCard(page);
  await expect(page.locator(".detail-flip-inner")).toHaveCSS("transform", flippedTransform, { timeout: 250 });
});

test("detail flip is animated when the device does not ask for reduced motion", async ({ page }) => {
  await flipDetailCard(page);
  // Still in flight at the point the reduced-motion run has already settled.
  await expect(page.locator(".detail-flip-inner")).not.toHaveCSS("transform", flippedTransform, { timeout: 120 });
  await expect(page.locator(".detail-flip-inner")).toHaveCSS("transform", flippedTransform, { timeout: 2000 });
});

test("layout keeps the menu's main controls visible", async ({ page }) => {
  await expect(page.locator(".topbar")).toBeInViewport();
  await expect(page.locator("#chips")).toBeInViewport();
  await expect(page.locator(".dish-card").first()).toBeInViewport();
});

test("the platform class is set, and it is what turns the expensive blur off", async ({ page }) => {
  // `html.plt-android` rules were written and never applied: the class is
  // Ionic's convention and this app is bare Capacitor, so nothing set it. The
  // consequence was a real-time blur(3px) over the whole card stack on every
  // dish tap, on exactly the hardware least able to afford it.
  await expect(page.locator("html")).toHaveClass(/\bplt-/);

  await page.locator(".dish-card").first().click();
  const stack = page.locator("#stack");
  await expect(page.locator(".menu.detail-open")).toBeVisible();

  const onWeb = await stack.evaluate((node) => getComputedStyle(node).filter);
  expect(onWeb, "a browser keeps the blur").toContain("blur");

  // Prove the override the tablet relies on, without a tablet.
  await page.evaluate(() => document.documentElement.classList.add("plt-android"));
  const onAndroid = await stack.evaluate((node) => getComputedStyle(node).filter);
  expect(onAndroid, "the Android rule must drop the blur").toBe("none");
});

test("the list carries a price, so nothing has to be opened to find one", async ({ page }) => {
  const row = page.locator(".dish-card", { hasText: "蔬菜拉面" });
  await expect(row.locator(".row-price")).toHaveText("EUR 12.50");
  // The picture slot is in the row whether or not a photo exists yet, so the
  // layout does not move the day one is uploaded.
  await expect(row.locator(".art, .dish-media")).toHaveCount(1);
});

test("the back of the card takes the dish apart and pins the allergens to its parts", async ({ page }) => {
  await page.locator(".dish-card", { hasText: "蔬菜拉面" }).click();
  await page.locator(".detail-heading").click({ delay: 50 });
  await expect(page.locator(".detail-flip-inner")).toHaveClass(/flipped/);

  const parts = page.locator(".dish-part");
  await expect(parts).toHaveCount(3);
  await expect(parts.nth(0).locator(".part-name b")).toHaveText("拉面");
  await expect(parts.nth(0).locator(".part-allergens")).toHaveText("A");
  await expect(parts.nth(1).locator(".part-allergens")).toHaveCount(0);
  await expect(parts.nth(2).locator(".part-name b")).toHaveText("鸡蛋");
  await expect(parts.nth(2).locator(".part-allergens")).toHaveText("C");

  // Soy is declared but no named ingredient carries it, and saying so is the
  // point: a breakdown that silently dropped it would be shrinking a legal
  // declaration.
  await expect(page.locator(".parts-loose")).toContainText("F");
  await expect(page.locator("dd .allergen-list").first()).toContainText("F 大豆");
});

test("a part never carries an allergen the dish does not declare", async ({ page }) => {
  await page.locator(".dish-card", { hasText: "火炙三文鱼寿司" }).click();
  await page.locator(".detail-heading").click({ delay: 50 });
  // Salmon carries D and the dish declares D; rice carries nothing. Nothing
  // else may appear, whatever the glossary knows about the terms.
  const letters = await page.locator(".dish-part .allergen").allInnerTexts();
  expect(letters).toEqual(["D"]);
});

test("a combo names the dishes it packages, not just its own price", async ({ page }) => {
  await page.locator(".dish-card", { hasText: "双人套餐" }).click();
  const bundle = page.locator(".bundle-items");
  await expect(bundle).toBeVisible();
  await expect(bundle).toContainText("黑椒牛柳");
  // Quantities above one are shown; the singular dish is not prefixed with "1×".
  await expect(bundle).toContainText("2× 蔬菜拉面");
  await expect(bundle.getByText("黑椒牛柳", { exact: true })).toBeVisible();
});

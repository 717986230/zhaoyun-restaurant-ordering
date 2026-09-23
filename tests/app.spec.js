import { expect, test } from "@playwright/test";

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

// Most of this file reads the menu in Chinese, so it is a Chinese phone at a
// restaurant that has switched all three languages on. What happens by default
// — English and German only, following the phone — is its own group below.
test.use({ locale: "zh-CN" });

test.beforeEach(async ({ page }) => {
  await page.route("**/api/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products, theme: "jade", languages: ["zh", "en", "de"] }) }));
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

test("seven quick taps on the title open the admin console, which asks for the password", async ({ page }) => {
  await page.route("**/api/admin/gate", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ configured: true }) }));
  const title = page.locator(".topbar .title");
  // Six is a guest fiddling with the header, not a way in.
  for (let tap = 0; tap < 6; tap += 1) await title.click();
  await expect(page.locator("#menu.active")).toBeVisible();
  await expect(page).not.toHaveURL(/admin\.html/);

  await title.click();
  await expect(page).toHaveURL(/admin\.html/);
  // The taps are not the lock; the password page behind them is.
  await expect(page.getByRole("heading", { name: "管理台" })).toBeVisible();
  await expect(page.locator("input[name='admin-password']")).toBeVisible();
});

test("taps spread out over more than four seconds do not add up", async ({ page }) => {
  // The fake clock has to be in place before the app's own timers exist.
  await page.clock.install();
  await page.reload();
  const title = page.locator(".topbar .title");
  for (let tap = 0; tap < 4; tap += 1) await title.click();
  await page.clock.fastForward(4500);
  for (let tap = 0; tap < 4; tap += 1) await title.click();
  await expect(page.locator("#menu.active")).toBeVisible();
  await expect(page).not.toHaveURL(/admin\.html/);
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

test("the flags in the top right switch the menu between the languages the restaurant offers", async ({ page }) => {
  // Located by class, not by its label: the label is in the menu's language,
  // which is the thing this test changes.
  const flags = page.locator(".topbar-end .flags");
  await expect(flags).toHaveAttribute("aria-label", "语言");
  await expect(flags.getByRole("button")).toHaveCount(3);
  // A Chinese phone, and Chinese is on: that is where it starts.
  await expect(flags.getByRole("button", { name: "中文" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".dish-card", { hasText: "黑椒牛柳" })).toBeVisible();

  await flags.getByRole("button", { name: "Deutsch" }).click();
  await expect(page.locator(".dish-card", { hasText: "Rinderfilet mit schwarzem Pfeffer" })).toBeVisible();
  await expect(flags.getByRole("button", { name: "Deutsch" })).toHaveAttribute("aria-pressed", "true");

  await flags.getByRole("button", { name: "English" }).click();
  await expect(page.locator(".dish-card", { hasText: "Black Pepper Beef Fillet" })).toBeVisible();

  await flags.getByRole("button", { name: "中文" }).click();
  await expect(page.locator(".dish-card", { hasText: "黑椒牛柳" })).toBeVisible();
});

test("the chosen language survives a reload", async ({ page }) => {
  await page.getByRole("button", { name: "Deutsch" }).click();
  await expect(page.locator(".dish-card", { hasText: "Rinderfilet mit schwarzem Pfeffer" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Deutsch" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".dish-card", { hasText: "Rinderfilet mit schwarzem Pfeffer" })).toBeVisible();
});

test("German menu copy replaces the Chinese chrome, all the way into a dish", async ({ page }) => {
  await page.getByRole("button", { name: "Deutsch" }).click();
  await expect(page.getByRole("button", { name: "Deutsch" })).toHaveAttribute("aria-pressed", "true");

  await expect(page.getByRole("button", { name: "Gericht suchen" })).toBeVisible();

  await page.locator(".dish-card", { hasText: "Rinderfilet mit schwarzem Pfeffer" }).click();
  await expect(page.locator(".dish-options-group").first()).toContainText("Extra Nudeln");
  await expect(page.getByRole("button", { name: "Details schließen" })).toBeVisible();

  await page.locator(".detail-heading").click({ delay: 50 });
  await expect(page.getByText("Allergene")).toBeVisible();
});

test.describe("on a 360px phone, the width of most Android phones", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  /** Two boxes that share no pixel. */
  const apart = (a, b) => a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 || a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5;

  async function rowParts(page, name) {
    const row = page.locator(".dish-card", { hasText: name }).locator(".summary");
    await expect(row).toBeVisible();
    const box = async (selector) => row.locator(selector).first().boundingBox();
    return { picture: await box(".art, .dish-media"), number: await box(".number"), name: await box("h3"), price: await box(".row-price") };
  }

  test("every row shows its picture, then its number over its name, then its price", async ({ page }) => {
    // The narrow-screen rule once declared two columns for a four-part row,
    // so the name wrapped under the picture and was hidden behind it.
    const { picture, number, name, price } = await rowParts(page, "黑椒牛柳");
    expect(picture.x + picture.width).toBeLessThanOrEqual(number.x);
    expect(picture.x + picture.width).toBeLessThanOrEqual(name.x);
    expect(number.y + number.height).toBeLessThanOrEqual(name.y + 1);
    expect(name.x + name.width).toBeLessThanOrEqual(price.x);
  });

  test("a long drink code and a long German name overlap nothing", async ({ page }) => {
    // The codes of the drinks — BEER-NONALC, WINE-WHITE, APEROL-PROSECCO —
    // used to sit in a column sized for R1 and ran through the name.
    const drink = {
      id: "wine-white", sku: "APEROL-PROSECCO", kind: "drink", category: "WINE",
      names: { zh: "白葡萄酒", de: "Weißwein Grüner Veltliner 1/8 aus der Wachau", en: "White Wine Grüner Veltliner 1/8" },
      description: "", price: 4.5, allergens: [], details: { time: "", people: "", level: "", ingredients: "" },
      appearance: { art: "#333", pattern: "dots" }, media: []
    };
    await page.unroute("**/api/catalog");
    await page.route("**/api/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [...products, drink], theme: "jade", languages: ["zh", "en", "de"] }) }));
    await page.reload();
    await page.getByRole("button", { name: "Deutsch" }).click();
    const parts = await rowParts(page, "APEROL-PROSECCO");
    const names = Object.keys(parts);
    for (const [index, one] of names.entries()) {
      for (const other of names.slice(index + 1)) expect(apart(parts[one], parts[other]), `${one} overlaps ${other}`).toBe(true);
    }
  });

  test("a long restaurant title shrinks to fit between the search button and the flags", async ({ page }) => {
    await page.unroute("**/api/catalog");
    await page.route("**/api/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      products, theme: "jade", languages: ["zh", "en", "de"], menu: { title: "Chiri Kitchen Mariahilf", restaurantName: "Chiri", defaultScheme: "dark", showTableNumber: true }
    }) }));
    await page.reload();
    const title = page.locator(".topbar .title strong");
    await expect(title).toHaveText("Chiri Kitchen Mariahilf");
    await expect.poll(() => title.evaluate((node) => node.scrollWidth <= node.parentElement.clientWidth)).toBe(true);
    const [search, text, flags, bar] = [await page.locator("#searchBtn").boundingBox(), await title.boundingBox(), await page.locator(".topbar-end").boundingBox(), await page.locator(".topbar").boundingBox()];
    expect(search.x + search.width).toBeLessThanOrEqual(text.x + 0.5);
    expect(text.x + text.width).toBeLessThanOrEqual(flags.x + 0.5);
    // At most two lines, inside the header.
    expect(text.y).toBeGreaterThanOrEqual(bar.y);
    expect(text.y + text.height).toBeLessThanOrEqual(bar.y + bar.height);
    // Still a title, not a footnote.
    expect(Number.parseFloat(await title.evaluate((node) => getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
  });

  test("the title stays on one line beside three flags", async ({ page }) => {
    const title = await page.locator(".topbar .title strong").boundingBox();
    const flags = await page.locator(".topbar-end").boundingBox();
    expect(title.height).toBeLessThan(40);
    expect(title.x + title.width).toBeLessThanOrEqual(flags.x);
  });
});

test("the sun and moon switch the menu between dark and light, and it stays switched", async ({ page }) => {
  const root = (name) => page.evaluate((token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim(), name);
  // Dark is the menu as designed, so that is where a guest starts.
  await expect(page.locator(".dish-card").first()).toBeVisible();
  expect(await root("--bg")).toBe("#0f1113");
  expect(await root("--accent")).toBe("#8fb0a3");

  await page.getByRole("button", { name: "切换到浅色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await root("--bg")).toBe("#f3f5f6");
  // The accent darkens with it: the dark menu's pale celadon is unreadable on white.
  expect(await root("--accent")).toBe("#2f6b56");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "切换到深色" }).click();
  expect(await root("--bg")).toBe("#0f1113");
  expect(await root("--accent")).toBe("#8fb0a3");
});

test("the menu style the server picked changes only the accent, at load", async ({ page }) => {
  await page.unroute("**/api/catalog");
  await page.route("**/api/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products, theme: "terracotta" }) }));
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await expect(page.locator(".dish-card").first()).toBeVisible();
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
  expect(accent).toBe("#c98868");
  // The rest of the palette — background, ink — is untouched by a style pick.
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());
  expect(bg).toBe("#0f1113");
});

test("the owner's title, table-number choice and default look reach the guest", async ({ page }) => {
  await page.unroute("**/api/catalog");
  await page.route("**/api/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    products, theme: "jade", languages: ["zh", "en", "de"],
    menu: { title: "Speisekarte", restaurantName: "Goldener Drache", defaultScheme: "light", showTableNumber: false }
  }) }));
  await page.goto("/?table=12");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  await expect(page.locator(".topbar .title strong")).toHaveText("Speisekarte");
  await expect(page).toHaveTitle("Goldener Drache · Speisekarte");
  // Switched off: the card still carries the table, the header just keeps quiet.
  await expect(page.locator(".topbar .title small")).toHaveCount(0);
  // A guest who never chose sees the restaurant's default …
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  // … and a guest who did keeps their own choice over it.
  await page.getByRole("button", { name: "切换到深色" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
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
  // Having never reached the server, it has not heard that this restaurant
  // switched Chinese on either, so it offers the default two — and a Chinese
  // phone falls back to German, the language of the house.
  await expect(page.getByRole("button", { name: "Deutsch" })).toHaveAttribute("aria-pressed", "true");
  // And no banner about it: the guest cannot do anything with "offline", and
  // the prices shown are the menu's own.
  await expect(page.getByText(/offline/i)).toHaveCount(0);
  await expect(page.getByText("离线菜单")).toHaveCount(0);
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

test("the platform class is set, and nothing blurs the list behind an open dish", async ({ page }) => {
  // `html.plt-android` rules were written and never applied: the class is
  // Ionic's convention and this app is bare Capacitor, so nothing set it.
  await expect(page.locator("html")).toHaveClass(/\bplt-/);

  await page.locator(".dish-card").first().click();
  const stack = page.locator("#stack");
  await expect(page.locator(".menu.detail-open")).toBeVisible();

  // A blur over the whole list was re-rendered on every frame of the card
  // opening — the stutter on a dish tap, on phones as much as on tablets. The
  // list now only fades and steps back, which the GPU does for free.
  expect(await stack.evaluate((node) => getComputedStyle(node).filter)).toBe("none");
  await page.evaluate(() => document.documentElement.classList.add("plt-android"));
  expect(await stack.evaluate((node) => getComputedStyle(node).filter)).toBe("none");
});

/** A finger on the list, from one height to another, the way a phone reports it. */
async function drag(page, fromY, toY) {
  await page.evaluate(([from, to]) => {
    const list = document.querySelector("#stack");
    const point = (y) => new Touch({ identifier: 1, target: list, clientX: 180, clientY: y });
    const send = (type, y, touches) => list.dispatchEvent(new TouchEvent(type, { touches, changedTouches: [point(y)], bubbles: true, cancelable: true }));
    send("touchstart", from, [point(from)]);
    for (let step = 1; step <= 10; step += 1) {
      const y = from + ((to - from) * step) / 10;
      send("touchmove", y, [point(y)]);
    }
    send("touchend", to, []);
  }, [fromY, toY]);
}

test("a photo that failed from the cached menu still shows once the server names a new one", async ({ page }) => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  await page.route("**/media/old.jpg", (route) => route.fulfill({ status: 404, body: "" }));
  await page.route("**/media/new.png", (route) => route.fulfill({ status: 200, contentType: "image/png", body: png }));
  const withPhoto = (url) => products.map((product) => (product.id === "80" ? { ...product, media: [{ type: "image", url, credit: "Jane Doe · CC BY 4.0 · Wikimedia Commons" }] } : product));
  // Yesterday's menu, kept on the device, pointing at a photo since replaced.
  await page.evaluate((catalog) => localStorage.setItem("zy_catalog_cache_v3", JSON.stringify(catalog)), {
    products: withPhoto("/media/old.jpg").map((product) => ({ ...product, priceCents: Math.round(product.price * 100) })), theme: "jade", languages: ["zh", "en", "de"]
  });
  await page.unroute("**/api/catalog");
  let answer;
  const served = new Promise((resolve) => { answer = resolve; });
  await page.route("**/api/catalog", async (route) => {
    await served;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: withPhoto("/media/new.png"), theme: "jade", languages: ["zh", "en", "de"] }) });
  });
  await page.reload();
  const row = page.locator(".dish-card", { hasText: "黑椒牛柳" });
  // The old one fails first and the row falls back to its artwork …
  await expect(row.locator(".art")).toBeVisible();
  answer();
  // … and the new one is not held to that failure.
  await expect(row.locator("img.dish-media.loaded")).toHaveAttribute("src", /\/media\/new\.png$/);
  await row.click();
  await expect(page.locator(".photo-credit")).toContainText("Jane Doe · CC BY 4.0");
});

test.describe("the promotions page", () => {
  const withFeatured = (featured) => async ({ page }) => {
    await page.unroute("**/api/catalog");
    await page.route("**/api/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      products, theme: "jade", languages: ["zh", "en", "de"],
      menu: { title: "La Carte", restaurantName: "赵云", defaultScheme: "dark", showTableNumber: true, featured }
    }) }));
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
  };

  test.describe("switched on", () => {
    test.beforeEach(withFeatured({ title: "", productIds: ["combo-1", "80", "gone-from-the-menu"] }));

    test("is the first page a guest sees, in its own design", async ({ page }) => {
      await expect(page.locator(".chip").first()).toHaveText("✦ 精选推荐");
      await expect(page.locator(".chip.on")).toHaveText("✦ 精选推荐");
      await expect(page.locator(".menu.on-featured")).toBeVisible();
      await expect(page.locator(".featured-hero h2")).toHaveText("精选推荐");
      // In the owner's order; a dish no longer on the menu is simply skipped.
      const cards = page.locator(".featured-card");
      await expect(cards).toHaveCount(2);
      await expect(cards.nth(0)).toContainText("双人套餐");
      await expect(cards.nth(0).locator(".featured-caption .featured-number")).toHaveText("01");
      // A set spells out what it holds.
      await expect(cards.nth(0).locator(".featured-contents")).toContainText("黑椒牛柳");
      await expect(cards.nth(0).locator(".featured-contents")).toContainText("2× 蔬菜拉面");
      await expect(cards.nth(1)).toContainText("黑椒牛柳");
    });

    test("opens a dish like any other page, and turns on to everything", async ({ page }) => {
      await page.locator(".featured-card").nth(1).click();
      await expect(page.locator(".dish-detail-card")).toContainText("黑椒牛柳");
      await page.getByRole("button", { name: "关闭详情" }).click();
      await page.locator(".page-next").click();
      await expect(page.locator(".chip.on")).toHaveText("全部");
      await expect(page.locator(".menu.on-featured")).toHaveCount(0);
    });

    test("a guest who moved on is not sent back to it on every reload", async ({ page }) => {
      await page.getByRole("button", { name: "RAMEN", exact: true }).click();
      await page.reload();
      await expect(page.locator(".chip.on")).not.toHaveText("✦ 精选推荐");
    });
  });

  test("takes the owner's title when there is one", async ({ page }) => {
    await withFeatured({ title: "Chef's Table", productIds: ["80"] })({ page });
    await expect(page.locator(".featured-hero h2")).toHaveText("Chef's Table");
    await expect(page.locator(".chip").first()).toHaveText("✦ Chef's Table");
  });

  test("is not there when switched off, or when none of its dishes are on the menu", async ({ page }) => {
    await withFeatured(null)({ page });
    await expect(page.locator(".chip").first()).toHaveText("全部");
    await withFeatured({ title: "", productIds: ["gone-from-the-menu"] })({ page });
    await expect(page.locator(".chip").first()).toHaveText("全部");
    await expect(page.locator(".featured-page")).toHaveCount(0);
  });
});

test.describe("the menu turns its pages", () => {
  const onChip = (page) => page.locator(".chip.on");

  test("the foot of each page names the next one, and a tap turns to it", async ({ page }) => {
    await expect(onChip(page)).toHaveText("全部");
    const next = page.locator(".page-next");
    await expect(next).toContainText("下一页 · MAIN");
    await next.click();
    await expect(onChip(page)).toHaveText("MAIN");
    await expect(page.locator(".dish-card")).toHaveCount(1);
    await expect(page.locator(".dish-card")).toContainText("黑椒牛柳");
    // A new page starts at its top.
    expect(await page.locator("#stack").evaluate((node) => node.scrollTop)).toBe(0);
  });

  test("pulling up past the last dish turns to the next page, pulling down past the first goes back", async ({ page }) => {
    await page.getByRole("button", { name: "MAIN", exact: true }).click();
    // Only a pull that starts at the end turns the page; on a landscape phone
    // even one dish and the next-page bar are taller than the screen.
    await page.locator("#stack").evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await drag(page, 300, 60);
    await expect(onChip(page)).toHaveText("SUSHI");
    await drag(page, 60, 300);
    await expect(onChip(page)).toHaveText("MAIN");
  });

  test("a short pull springs back without turning", async ({ page }) => {
    await page.getByRole("button", { name: "MAIN", exact: true }).click();
    await drag(page, 600, 560);
    await page.waitForTimeout(400);
    await expect(onChip(page)).toHaveText("MAIN");
    // Nothing is left dragged out of place.
    expect(await page.locator(".page-sheet").evaluate((node) => node.style.transform)).toBe("");
  });

  test("the first page cannot be pulled back past, and the last says it is the end", async ({ page }) => {
    // The set menus come before everything else; pulling back from "all" reaches them.
    await drag(page, 300, 600);
    await expect(onChip(page)).toHaveText("套餐");
    await drag(page, 300, 600);
    await expect(onChip(page)).toHaveText("套餐");
    await page.getByRole("button", { name: "RAMEN", exact: true }).click();
    await expect(page.locator(".page-next")).toHaveCount(0);
    await expect(page.locator(".page-end")).toHaveText("菜单到底了");
    await drag(page, 600, 300);
    await expect(onChip(page)).toHaveText("RAMEN");
  });

  test("a search is one page, with nothing to turn to", async ({ page }) => {
    await page.locator("#searchBtn").click();
    await page.locator("#searchInput").fill("拉面");
    await expect(page.locator(".dish-card")).toHaveCount(1);
    await expect(page.locator(".page-next")).toHaveCount(0);
    await drag(page, 600, 300);
    await expect(onChip(page)).toHaveText("全部");
  });

  test("the next page's name follows the guest's language", async ({ page }) => {
    await page.getByRole("button", { name: "English" }).click();
    await expect(page.locator(".page-next")).toContainText("Next · MAIN");
  });
});

test("the header shows no table number the guest was never given, and nothing in the wrong language", async ({ page }) => {
  // This phone opened the menu without a table card, so there is no table to
  // show; the placeholder "08" used to appear as if it were real.
  await expect(page.locator(".topbar .title small")).toHaveCount(0);
  await expect(page.getByText(/TISCH/)).toHaveCount(0);
  // The "all" chip speaks the guest's language.
  await expect(page.locator(".chip").first()).toHaveText("全部");
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.locator(".chip").first()).toHaveText("All");
  await page.locator("#searchBtn").click();
  await expect(page.locator("#searchInput")).toHaveAttribute("placeholder", "Search dish or number");
});

test("a card's table number shows, in the guest's language", async ({ page }) => {
  await page.goto("/?table=12");
  await expect(page.locator(".topbar .title small")).toHaveText("桌 12");
  await page.getByRole("button", { name: "Deutsch" }).click();
  await expect(page.locator(".topbar .title small")).toHaveText("Tisch 12");
});

test("a dish's second line is its name in another language, never the same name twice", async ({ page }) => {
  await page.getByRole("button", { name: "Deutsch" }).click();
  const row = page.locator(".dish-card", { hasText: "Ramen mit Gemüse" });
  // German on top, English below — not German twice.
  await expect(row.locator("h3")).toHaveText("Ramen mit Gemüse");
  await expect(row.locator("p")).toHaveText("Ramen with Vegetables");
  await page.getByRole("button", { name: "English" }).click();
  const english = page.locator(".dish-card", { hasText: "Ramen with Vegetables" });
  await expect(english.locator("p")).toHaveText("Ramen mit Gemüse");
});

test("the list carries a price, so nothing has to be opened to find one", async ({ page }) => {
  const row = page.locator(".dish-card", { hasText: "蔬菜拉面" });
  // Written the way each language writes a price, not "EUR 12.50".
  await expect(row.locator(".row-price")).toHaveText("€12.50");
  await page.getByRole("button", { name: "Deutsch" }).click();
  // Austrian German: the euro sign first, a decimal comma.
  await expect(page.locator(".dish-card", { hasText: "Ramen mit Gemüse" }).locator(".row-price")).toHaveText(/^€\s12,50$/);
  await page.getByRole("button", { name: "中文" }).click();
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

test("set menus have a page of their own, apart from the dishes", async ({ page }) => {
  // "All" is the dishes; a set is not one of them.
  await expect(page.locator(".chip.on")).toHaveText("全部");
  await expect(page.locator(".dish-card", { hasText: "双人套餐" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "SET", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "套餐", exact: true }).click();
  const set = page.locator(".featured-card", { hasText: "双人套餐" });
  await expect(set).toBeVisible();
  await expect(page.locator(".featured-page")).toHaveAttribute("data-template", "framed");
  await expect(set.locator(".featured-contents")).toContainText("2× 蔬菜拉面");
  await expect(page.locator(".featured-card")).toHaveCount(1);
  // A search still looks through everything.
  await page.locator("#searchBtn").click();
  await page.locator("#searchInput").fill("套餐");
  await expect(page.locator(".dish-card", { hasText: "双人套餐" })).toBeVisible();
});

test("a combo names the dishes it packages, not just its own price", async ({ page }) => {
  await page.getByRole("button", { name: "套餐", exact: true }).click();
  await page.locator(".featured-card", { hasText: "双人套餐" }).click();
  const bundle = page.locator(".bundle-items");
  await expect(bundle).toBeVisible();
  await expect(bundle).toContainText("黑椒牛柳");
  // Quantities above one are shown; the singular dish is not prefixed with "1×".
  await expect(bundle).toContainText("2× 蔬菜拉面");
  await expect(bundle.getByText("黑椒牛柳", { exact: true })).toBeVisible();
});

test.describe("a restaurant that has not switched Chinese on", () => {
  // The default: the catalogue says nothing about languages, which is what a
  // restaurant that never opened 菜单语言 serves.
  const catalogWithout = (extra = {}) => async ({ page }) => {
    await page.unroute("**/api/catalog");
    await page.route("**/api/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products, theme: "jade", ...extra }) }));
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  };

  test.describe("on an Austrian phone", () => {
    test.use({ locale: "de-AT" });
    test.beforeEach(catalogWithout());

    test("offers English and German only, and starts in German", async ({ page }) => {
      const flags = page.locator(".topbar-end").getByRole("group");
      await expect(flags.getByRole("button")).toHaveCount(2);
      await expect(flags.getByRole("button", { name: "中文" })).toHaveCount(0);
      await expect(flags.getByRole("button", { name: "Deutsch" })).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".dish-card", { hasText: "Rinderfilet mit schwarzem Pfeffer" })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", "de");
    });

    test("a guest who once picked Chinese reads German now that it is off", async ({ page }) => {
      await page.evaluate(() => localStorage.setItem("zy_customer_state_v4", JSON.stringify({ language: "zh", languageChosen: true })));
      await page.reload();
      await expect(page.getByRole("button", { name: "Deutsch" })).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".dish-card", { hasText: "黑椒牛柳" })).toHaveCount(0);
    });
  });

  test.describe("on an English phone", () => {
    test.use({ locale: "en-GB" });
    test.beforeEach(catalogWithout());

    test("starts in English", async ({ page }) => {
      await expect(page.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".dish-card", { hasText: "Black Pepper Beef Fillet" })).toBeVisible();
    });
  });

  test.describe("on a French phone", () => {
    test.use({ locale: "fr-FR" });
    test.beforeEach(catalogWithout());

    test("falls back to German, the language of the house", async ({ page }) => {
      await expect(page.getByRole("button", { name: "Deutsch" })).toHaveAttribute("aria-pressed", "true");
    });
  });

  test.describe("with one language only", () => {
    test.use({ locale: "en-GB" });
    test.beforeEach(catalogWithout({ languages: ["de"] }));

    test("shows no flags, since there is nothing to switch to", async ({ page }) => {
      await expect(page.locator(".dish-card", { hasText: "Rinderfilet mit schwarzem Pfeffer" })).toBeVisible();
      await expect(page.locator(".flags")).toHaveCount(0);
      // The light/dark switch is still there on its own.
      await expect(page.getByRole("button", { name: "Helles Design" })).toBeVisible();
    });
  });
});

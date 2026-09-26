import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { isolateLive } from "./support/live.js";

/**
 * Nothing on the menu covers anything else — on every device, in every
 * language, for every dish the restaurant actually serves.
 *
 * The other specs use a handful of fixtures; overlaps come from the real data:
 * a drink code twice the width anyone planned for, a German name three words
 * long, a title the owner typed. So this loads the menu the app ships with,
 * all 111 dishes and 7 set menus, and measures every row. It is the one spec the iPhone
 * projects run as well (WebKit, the engine of every browser on iOS), so a
 * page that lays out differently on an iPhone fails here.
 */
const catalog = JSON.parse(readFileSync(new URL("../apps/customer-app/src/app/bundled-catalog.json", import.meta.url), "utf8"));

test.use({ locale: "zh-CN" });

test.beforeEach(async ({ page }) => {
  await isolateLive(page);
  // An iPhone is offered the install steps on a first visit; measured here is the menu.
  await page.addInitScript(() => { try { localStorage.setItem("zy_install_offer", "1"); } catch { /* none */ } });
  await page.route("**/api/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    products: catalog, theme: "jade", languages: ["zh", "en", "de"],
    menu: { title: "Chiri Kitchen", restaurantName: "赵云", defaultScheme: "dark", showTableNumber: true }
  }) }));
  // Photos are not what is measured here; a blank answer keeps it fast.
  await page.route("**/media/**", (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/?table=12");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  // "All" is the dishes; the set menus have their own page.
  await expect(page.locator(".dish-card")).toHaveCount(catalog.filter((product) => !product.bundleItems?.length).length);
});

/** Every pair of the given parts of every row that share a pixel, as text. */
function overlapsInRows() {
  const box = (node) => node && node.getBoundingClientRect();
  const hit = (a, b) => a && b && a.width && b.width && !(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5);
  const problems = [];
  for (const card of document.querySelectorAll(".dish-card")) {
    const row = box(card);
    const parts = {
      picture: box(card.querySelector(".art, .dish-media")),
      code: box(card.querySelector(".number")),
      name: box(card.querySelector("h3")),
      second: box(card.querySelector(".row-text p")),
      price: box(card.querySelector(".row-price"))
    };
    const names = Object.keys(parts);
    for (const [index, one] of names.entries()) {
      for (const other of names.slice(index + 1)) {
        if (hit(parts[one], parts[other])) problems.push(`${card.dataset.id}: ${one} overlaps ${other}`);
      }
      const part = parts[one];
      if (part && part.width && (part.left < row.left - 0.5 || part.right > row.right + 0.5)) problems.push(`${card.dataset.id}: ${one} sticks out of its row`);
    }
  }
  return problems;
}

for (const [flag, language] of [["中文", "zh"], ["English", "en"], ["Deutsch", "de"]]) {
  test(`no row of the real menu overlaps itself, in ${language}`, async ({ page }) => {
    await page.getByRole("button", { name: flag }).click();
    expect(await page.evaluate(overlapsInRows)).toEqual([]);
    // Nothing is wider than the screen.
    // Against the configured width: a mobile browser widens innerWidth to fit overflow.
    expect(await page.evaluate((limit) => document.scrollingElement.scrollWidth <= limit + 1, page.viewportSize().width)).toBe(true);
  });
}

test("the header's search, title and switches never touch", async ({ page }) => {
  for (const flag of ["中文", "English", "Deutsch"]) {
    await page.getByRole("button", { name: flag }).click();
    const [search, title, table, end] = await Promise.all([
      page.locator("#searchBtn").boundingBox(),
      page.locator(".topbar .title strong").boundingBox(),
      page.locator(".topbar .title small").boundingBox(),
      page.locator(".topbar-end").boundingBox()
    ]);
    expect(search.x + search.width).toBeLessThanOrEqual(title.x + 0.5);
    expect(title.x + title.width).toBeLessThanOrEqual(end.x + 0.5);
    expect(title.y + title.height).toBeLessThanOrEqual(table.y + 0.5);
    expect(end.x + end.width).toBeLessThanOrEqual(page.viewportSize().width);
  }
});

test("the longest names open into a detail card whose heading clears the close button", async ({ page }) => {
  await page.getByRole("button", { name: "Deutsch" }).click();
  const longest = [...catalog].sort((a, b) => b.names.de.length - a.names.de.length).slice(0, 3);
  for (const dish of longest) {
    await page.locator(`.dish-card[data-id="${dish.id}"]`).click();
    const card = page.locator(".dish-detail-card");
    await expect(card).toBeVisible();
    const [heading, close, cardBox] = await Promise.all([
      card.locator(".detail-front h3").boundingBox(), card.locator(".detail-close").boundingBox(), card.boundingBox()
    ]);
    const clear = heading.x + heading.width <= close.x + 0.5 || heading.y >= close.y + close.height - 0.5;
    expect(clear, `${dish.id}: heading runs under the close button`).toBe(true);
    expect(heading.x + heading.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 0.5);
    await card.locator(".detail-close").click();
    await expect(card).toHaveCount(0);
  }
});

test("a page picked from the chips opens at its top, whichever side of it the guest was on", async ({ page }) => {
  // The owner's promotions, so that page and the set menus both sit to the left of "all".
  await page.unroute("**/api/catalog");
  await page.route("**/api/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    products: catalog, theme: "jade", languages: ["zh", "en", "de"],
    menu: { title: "Chiri Kitchen", restaurantName: "赵云", defaultScheme: "dark", showTableNumber: true,
      featured: { title: "今日套餐", productIds: catalog.slice(0, 6).map((dish) => dish.id), template: "gallery" } }
  }) }));
  await page.reload();
  const stack = page.locator("#stack");
  const allChip = page.locator(".chip:not(.chip-sets):not(.chip-featured)").first();
  for (const chip of [page.locator(".chip-sets"), page.locator(".chip-featured")]) {
    await allChip.click();
    await expect(allChip).toHaveClass(/\bon\b/);
    // Deep into the list, the way a guest who has been reading is.
    await stack.evaluate((node) => { node.scrollTop = node.scrollHeight / 2; });
    await chip.click();
    await expect(chip).toHaveClass(/\bon\b/);
    await expect(page.locator(".featured-hero")).toBeInViewport();
    expect(await stack.evaluate((node) => node.scrollTop)).toBe(0);
    // Back to "all" from there: its top as well.
    await stack.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await allChip.click();
    await expect(allChip).toHaveClass(/\bon\b/);
    expect(await stack.evaluate((node) => node.scrollTop)).toBe(0);
  }
});

test("far down a long page, one tap goes back to the top; the header and categories never scroll away", async ({ page }) => {
  const stack = page.locator("#stack");
  const toTop = page.getByRole("button", { name: "回到顶部" });
  const header = async () => Promise.all([page.locator(".topbar").boundingBox(), page.locator("#chips").boundingBox()]);
  const [topbarBefore, chipsBefore] = await header();
  // Not at the top of the page: there is nowhere to go back to.
  await expect(page.locator(".to-top")).not.toHaveClass(/\bon\b/);

  await stack.evaluate((node) => { node.scrollTop = node.scrollHeight / 2; });
  await expect(toTop).toBeVisible();
  const [topbarAfter, chipsAfter] = await header();
  // Within a pixel: WebKit lands a box on hundredths of one.
  expect(Math.abs(topbarAfter.y - topbarBefore.y)).toBeLessThan(1);
  expect(Math.abs(chipsAfter.y - chipsBefore.y)).toBeLessThan(1);
  // In the corner, inside the screen, clear of the header.
  const button = await page.locator(".to-top").boundingBox();
  const viewport = page.viewportSize();
  expect(button.x + button.width).toBeLessThanOrEqual(viewport.width);
  expect(button.y + button.height).toBeLessThanOrEqual(viewport.height);
  expect(button.y).toBeGreaterThan(chipsAfter.y + chipsAfter.height);

  await toTop.click();
  await expect.poll(() => stack.evaluate((node) => node.scrollTop)).toBe(0);
  await expect(page.locator(".to-top")).not.toHaveClass(/\bon\b/);
});

test("opening and closing a dish leaves the header where it was, on every phone and in every direction", async ({ page }) => {
  const top = () => page.locator(".topbar").boundingBox().then((box) => box.y);
  const before = await top();
  await page.locator(".dish-card").nth(2).click();
  await expect(page.locator(".dish-detail-card")).toBeVisible();
  // The card sits inside the screen, its price included.
  const [card, price] = await Promise.all([page.locator(".dish-detail-card").boundingBox(), page.locator(".detail-buy").boundingBox()]);
  expect(card.y + card.height).toBeLessThanOrEqual(page.viewportSize().height + 1);
  expect(price.y + price.height).toBeLessThanOrEqual(card.y + card.height + 1);
  await page.getByRole("button", { name: "关闭详情" }).click();
  await expect(page.locator(".dish-detail-card")).toHaveCount(0);
  expect(Math.abs((await top()) - before)).toBeLessThan(1);
  // Nothing outside the list scrolls, whatever was tapped.
  expect(await page.evaluate(() => document.querySelector(".app-shell").scrollTop)).toBe(0);
});

test("at the end of a page the back-to-top button keeps its corner, clear of the next-page bar", async ({ page }) => {
  const stack = page.locator("#stack");
  await expect(page.locator(".page-next")).toBeVisible();
  await stack.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await expect(page.locator(".page-next")).toBeInViewport();
  await expect(page.locator(".to-top")).toHaveClass(/\bon\b/);
  const [button, bar] = await Promise.all([page.locator(".to-top").boundingBox(), page.locator(".page-next").boundingBox()]);
  const viewport = page.viewportSize();
  // Bottom right, and not on the bar.
  expect(button.x + button.width).toBeGreaterThan(viewport.width - 80);
  expect(button.y + button.height).toBeGreaterThan(viewport.height - 110);
  expect(button.y >= bar.y + bar.height || button.y + button.height <= bar.y || button.x >= bar.x + bar.width).toBe(true);
});

const TEMPLATES = ["gallery", "spotlight", "editorial", "tasting", "framed", "poster", "carousel", "bento", "minimal", "monochrome"];

/** In one card: every visible piece of text inside the card, and none on another. */
function featuredProblems() {
  const visible = (node) => node && getComputedStyle(node).display !== "none" && node.getClientRects().length > 0;
  const hit = (a, b) => !(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5);
  const problems = [];
  for (const card of document.querySelectorAll(".featured-card")) {
    const frame = card.getBoundingClientRect();
    const texts = [...card.querySelectorAll(".featured-caption h3, .featured-caption-price, .featured-name, .featured-second, .featured-description, .set-list li, .featured-price, .featured-view")]
      .filter(visible).map((node) => ({ node, box: node.getBoundingClientRect() }));
    for (const [index, one] of texts.entries()) {
      if (one.box.left < frame.left - 0.5 || one.box.right > frame.right + 0.5) problems.push(`${card.dataset.id}: ${one.node.className} leaves its card`);
      for (const other of texts.slice(index + 1)) {
        if (hit(one.box, other.box)) problems.push(`${card.dataset.id}: ${one.node.className} overlaps ${other.node.className}`);
      }
    }
  }
  return problems;
}

test.describe("every promotions design", () => {
  // A set menu among real dishes, with the longest German names on the menu.
  const longest = [...catalog].sort((a, b) => b.names.de.length - a.names.de.length).slice(0, 4);
  const set = {
    ...catalog[0], id: "set-for-two", sku: "SET-2", category: "SET", media: [],
    names: { zh: "双人主厨套餐", de: "Chef-Menü für zwei Personen mit Dessert", en: "Chef's Menu for Two with Dessert" },
    description: "Zwei Vorspeisen, zwei Hauptgerichte und ein Dessert nach Wahl.",
    bundleItems: longest.map((dish) => ({ productId: dish.id, quantity: 2 }))
  };

  for (const template of TEMPLATES) {
    test(`${template}: nothing overlaps or leaves its card`, async ({ page }) => {
      await page.unroute("**/api/catalog");
      await page.route("**/api/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        products: [...catalog, set], theme: "jade", languages: ["zh", "en", "de"],
        menu: { title: "Chiri Kitchen", restaurantName: "赵云", defaultScheme: "dark", showTableNumber: true,
          featured: { title: "Signature Menus of the Season", productIds: [set.id, ...longest.map((dish) => dish.id)], template } }
      }) }));
      await page.evaluate(() => sessionStorage.clear());
      await page.reload();
      await expect(page.locator(`.featured-page[data-template="${template}"]`)).toBeVisible();
      await expect(page.locator(".featured-card")).toHaveCount(5);
      for (const flag of ["中文", "Deutsch"]) {
        await page.getByRole("button", { name: flag }).click();
        expect(await page.evaluate(featuredProblems)).toEqual([]);
        expect(await page.evaluate((limit) => document.scrollingElement.scrollWidth <= limit + 1, page.viewportSize().width)).toBe(true);
      }
    });
  }
});

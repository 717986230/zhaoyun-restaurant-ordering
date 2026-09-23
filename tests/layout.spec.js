import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/**
 * Nothing on the menu covers anything else — on every device, in every
 * language, for every dish the restaurant actually serves.
 *
 * The other specs use a handful of fixtures; overlaps come from the real data:
 * a drink code twice the width anyone planned for, a German name three words
 * long, a title the owner typed. So this loads the menu the app ships with,
 * all 111 dishes, and measures every row. It is the one spec the iPhone
 * projects run as well (WebKit, the engine of every browser on iOS), so a
 * page that lays out differently on an iPhone fails here.
 */
const catalog = JSON.parse(readFileSync(new URL("../apps/customer-app/src/app/bundled-catalog.json", import.meta.url), "utf8"));

test.use({ locale: "zh-CN" });

test.beforeEach(async ({ page }) => {
  await page.route("**/api/catalog", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    products: catalog, theme: "jade", languages: ["zh", "en", "de"],
    menu: { title: "Chiri Kitchen", restaurantName: "赵云", defaultScheme: "dark", showTableNumber: true }
  }) }));
  // Photos are not what is measured here; a blank answer keeps it fast.
  await page.route("**/media/**", (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/?table=12");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator(".dish-card")).toHaveCount(catalog.length);
  // Rows off screen are skipped by the browser until scrolled to; measure them all.
  await page.addStyleTag({ content: ".stack-page .dish-card { content-visibility: visible !important; }" });
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
    expect(await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
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

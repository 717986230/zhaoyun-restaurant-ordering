import { expect, test } from "./support/test.js";

/**
 * The menu without a signal (public/sw.js): once a phone has opened it, the
 * page, its scripts and the last catalogue come back with the network gone,
 * with a note saying so, which leaves when the network returns. Only this
 * spec lets the service worker run; the others mock the API under it.
 */
test.use({ serviceWorkers: "allow", locale: "en-GB" });

test("a menu opened once opens again with no network, and says so", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "android-phone-portrait", "one phone is enough");
  test.skip(!process.env.CI, "the service worker is registered in the production build only");
  await page.goto("/");
  await expect(page.locator(".dish-card").first()).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Under the worker now: the page and its scripts are kept as they load.
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect(page.locator(".dish-card").first()).toBeVisible();
  await expect(page.locator(".offline-bar")).toHaveCount(0);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".dish-card").first()).toBeVisible();
  await expect(page.locator(".offline-bar")).toHaveText("Offline · showing the menu as last loaded");

  await context.setOffline(false);
  await page.reload();
  await expect(page.locator(".dish-card").first()).toBeVisible();
  await expect(page.locator(".offline-bar")).toHaveCount(0);
});

test("the console, the POS and the API are left to the network", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "android-phone-portrait", "one phone is enough");
  test.skip(!process.env.CI, "the service worker is registered in the production build only");
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await page.goto("/admin.html");
  await context.setOffline(true);
  // Not kept: with no network the console fails as it always has.
  await expect(page.goto("/admin.html")).rejects.toThrow();
  await context.setOffline(false);
});

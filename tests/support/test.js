import { expect, test as base } from "@playwright/test";

/**
 * Playwright's `test`, with every page's Content-Security-Policy watched.
 *
 * On CI the pages are served by `vite preview` with the production headers
 * (shared/web-headers.mjs). A script, a picture or a connection the policy
 * refuses shows up as a console message; any of them fails the test that
 * caused it, so a policy that breaks a page never ships. The dev server
 * sends no policy, so locally there is nothing to catch.
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    const refused = [];
    context.on("console", (message) => {
      if (/Content Security Policy|Content-Security-Policy/i.test(message.text())) refused.push(message.text());
    });
    await use(context);
    expect(refused, "nothing a page needs may be refused by its Content-Security-Policy").toEqual([]);
  }
});

export { expect };

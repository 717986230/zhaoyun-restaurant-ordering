import { expect, test } from "./support/test.js";

/**
 * The production build is served with the app's security headers
 * (shared/web-headers.mjs). Only the build is: the dev server runs inline
 * scripts for hot reload, so without CI (vite preview) there is nothing to check.
 */
for (const page of ["/", "/admin.html", "/pos.html"]) {
  test(`${page} is served with its security headers`, async ({ request }) => {
    test.skip(!process.env.CI, "the dev server sends no policy; CI serves the build");
    const response = await request.get(page);
    expect(response.ok()).toBe(true);
    const headers = response.headers();
    expect(headers["content-security-policy"]).toContain("script-src 'self'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["permissions-policy"]).toContain("camera=()");
  });
}

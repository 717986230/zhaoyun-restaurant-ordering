import { expect, test } from "@playwright/test";

/**
 * The door of the admin console.
 *
 * Nothing here is seeded into sessionStorage, which is the point: these are the
 * two states a person actually meets — a console that has never had a password,
 * and one that has.
 */

const OK = { status: 200, contentType: "application/json" };

/** The console loads its catalogue, printers and settings the moment it is
 *  through the door; these keep that from erroring past the assertion. */
async function stubConsole(page) {
  await page.route("**/api/health", (route) => route.fulfill({ ...OK, body: JSON.stringify({ ok: true }) }));
  await page.route("**/api/admin/session", (route) => route.fulfill({ ...OK, body: JSON.stringify({ role: "manager" }) }));
  await page.route("**/api/admin/products", (route) => route.fulfill({ ...OK, body: JSON.stringify({ products: [] }) }));
  await page.route("**/api/admin/printers", (route) => route.fulfill({ ...OK, body: JSON.stringify({ printers: [] }) }));
  await page.route("**/api/admin/settings", (route) => route.fulfill({ ...OK, body: JSON.stringify({ menuTheme: "jade" }) }));
}

test("the first person through the door sets the password", async ({ page }) => {
  let configured = false;
  let submitted = null;
  await stubConsole(page);
  await page.route("**/api/admin/gate", (route) => route.fulfill({ ...OK, body: JSON.stringify({ configured }) }));
  await page.route("**/api/admin/gate/password", (route) => {
    submitted = route.request().postDataJSON();
    configured = true;
    return route.fulfill({ ...OK, body: JSON.stringify({ configured: true }) });
  });
  await page.route("**/api/admin/gate/sign-in", (route) =>
    route.fulfill({ ...OK, body: JSON.stringify({ token: "session-token", expiresInMs: 43200000 }) }));

  await page.goto("/admin.html");
  await expect(page.getByRole("heading", { name: "设置管理密码" })).toBeVisible();

  // The button stays shut until the password is long enough and typed twice
  // the same way — the second field never reaches the server, so a typo in it
  // would otherwise set a password nobody knows.
  const submit = page.getByRole("button", { name: "设置密码并进入" });
  await page.locator("input[name='admin-password']").fill("kueche-2026");
  await expect(submit).toBeDisabled();
  await page.locator("input[name='admin-password-repeat']").fill("kueche-2025");
  await expect(page.getByText("两次输入不一致")).toBeVisible();
  await expect(submit).toBeDisabled();

  await page.locator("input[name='admin-password-repeat']").fill("kueche-2026");
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect.poll(() => submitted?.password).toBe("kueche-2026");
  // Setting it is not signing in, so the console spends it on a session at
  // once rather than asking for the same password twice in a row.
  await expect(page.getByRole("button", { name: "商品与媒体" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("zy_admin_token"))).toBe("session-token");
});

test("everyone after types it, and a wrong one says so", async ({ page }) => {
  await stubConsole(page);
  await page.route("**/api/admin/gate", (route) => route.fulfill({ ...OK, body: JSON.stringify({ configured: true }) }));
  await page.route("**/api/admin/gate/sign-in", (route) => {
    const { password } = route.request().postDataJSON();
    return password === "kueche-passwort"
      ? route.fulfill({ ...OK, body: JSON.stringify({ token: "session-token", expiresInMs: 43200000 }) })
      : route.fulfill({ ...OK, status: 401, body: JSON.stringify({ error: "Wrong password" }) });
  });

  await page.goto("/admin.html");
  await expect(page.getByRole("heading", { name: "管理台" })).toBeVisible();
  // Nothing behind the door is drawn, not even the tabs: a tab that 403s is
  // not access control, and a tab that is merely hidden is not either.
  await expect(page.getByRole("button", { name: "商品与媒体" })).toHaveCount(0);
  await expect(page.locator("input[name='admin-password-repeat']")).toHaveCount(0);

  await page.locator("input[name='admin-password']").fill("falsches-passwort");
  await page.getByRole("button", { name: "进入管理台" }).click();
  await expect(page.getByRole("alert")).toContainText("Wrong password");

  await page.locator("input[name='admin-password']").fill("kueche-passwort");
  await page.getByRole("button", { name: "进入管理台" }).click();
  await expect(page.getByRole("button", { name: "商品与媒体" })).toBeVisible();
});

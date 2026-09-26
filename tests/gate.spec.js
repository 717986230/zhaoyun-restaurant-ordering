import { expect, test } from "@playwright/test";

/**
 * The door of the admin console: the restaurant's account.
 *
 * Nothing here is seeded into sessionStorage, which is the point: these are the
 * two states a person actually meets — a restaurant with no account yet, and
 * one that has registered.
 */

const OK = { status: 200, contentType: "application/json" };
const ACCOUNT = { id: "a-1", login: "wirt@zhaoyun.at", name: "Frau Li", createdAt: "2026-09-26T00:00:00.000Z" };

// The admin follows the browser's language; these tests read the Chinese copy.
test.use({ locale: "zh-CN" });

/** The console loads its catalogue, printers and settings the moment it is
 *  through the door; these keep that from erroring past the assertion. */
async function stubConsole(page) {
  await page.route("**/api/health", (route) => route.fulfill({ ...OK, body: JSON.stringify({ ok: true }) }));
  await page.route("**/api/admin/session", (route) => route.fulfill({ ...OK, body: JSON.stringify({ role: "manager", account: ACCOUNT }) }));
  await page.route("**/api/admin/products", (route) => route.fulfill({ ...OK, body: JSON.stringify({ products: [] }) }));
  await page.route("**/api/admin/printers", (route) => route.fulfill({ ...OK, body: JSON.stringify({ printers: [] }) }));
  await page.route("**/api/admin/settings", (route) => route.fulfill({ ...OK, body: JSON.stringify({ menuTheme: "jade" }) }));
}

test("the first person through the door registers the restaurant's account", async ({ page }) => {
  let submitted = null;
  await stubConsole(page);
  await page.route("**/api/account", (route) => route.fulfill({ ...OK, body: JSON.stringify({ registered: false }) }));
  await page.route("**/api/account/register", (route) => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ ...OK, status: 201, body: JSON.stringify({ token: "session-token", expiresInMs: 43200000, account: ACCOUNT }) });
  });

  await page.goto("/admin.html");
  await expect(page.getByRole("heading", { name: "注册餐厅账户" })).toBeVisible();

  // The button stays shut until the account name is valid and the password is
  // long enough and typed twice the same way — the second field never reaches
  // the server, so a typo in it would otherwise set a password nobody knows.
  const submit = page.getByRole("button", { name: "注册并进入" });
  await page.locator("input[name='login']").fill(" Wirt@Zhaoyun.at ");
  await page.locator("input[name='name']").fill("Frau Li");
  await page.locator("input[name='password']").fill("kueche-2026");
  await expect(submit).toBeDisabled();
  await page.locator("input[name='password-repeat']").fill("kueche-2025");
  await expect(page.getByText("两次输入不一致")).toBeVisible();
  await expect(submit).toBeDisabled();

  await page.locator("input[name='password-repeat']").fill("kueche-2026");
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect.poll(() => submitted).toEqual({ login: "wirt@zhaoyun.at", name: "Frau Li", password: "kueche-2026" });
  // Registering signs in: straight into the console, the account's name in its head.
  await expect(page.getByRole("button", { name: "菜品", exact: true })).toBeVisible();
  await expect(page.locator(".admin-role")).toHaveText("Frau Li");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("zy_admin_token"))).toBe("session-token");
});

test("everyone after signs in with the account name and password, and a wrong one says so", async ({ page }) => {
  await stubConsole(page);
  await page.route("**/api/account", (route) => route.fulfill({ ...OK, body: JSON.stringify({ registered: true }) }));
  await page.route("**/api/account/sign-in", (route) => {
    const { login, password } = route.request().postDataJSON();
    return login === "wirt@zhaoyun.at" && password === "kueche-passwort"
      ? route.fulfill({ ...OK, body: JSON.stringify({ token: "session-token", expiresInMs: 43200000, account: ACCOUNT }) })
      : route.fulfill({ ...OK, status: 401, body: JSON.stringify({ error: "Wrong account name or password" }) });
  });

  await page.goto("/admin.html");
  await expect(page.getByRole("heading", { name: "登录管理台" })).toBeVisible();
  // Nothing behind the door is drawn, not even the tabs: a tab that 403s is
  // not access control, and a tab that is merely hidden is not either.
  await expect(page.getByRole("button", { name: "菜品", exact: true })).toHaveCount(0);
  await expect(page.locator("input[name='password-repeat']")).toHaveCount(0);

  await page.locator("input[name='login']").fill("wirt@zhaoyun.at");
  await page.locator("input[name='password']").fill("falsches-passwort");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Wrong account name or password");

  await page.locator("input[name='password']").fill("kueche-passwort");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "菜品", exact: true })).toBeVisible();
});

test("the account's name and password are changed in the settings, against the password in force", async ({ page }) => {
  let sent = null;
  await stubConsole(page);
  await page.addInitScript(() => sessionStorage.setItem("zy_admin_token", "session-token"));
  await page.route("**/api/account", (route) => {
    if (route.request().method() !== "PUT") return route.fulfill({ ...OK, body: JSON.stringify({ registered: true }) });
    sent = route.request().postDataJSON();
    return route.fulfill({ ...OK, body: JSON.stringify({ account: { ...ACCOUNT, login: sent.login, name: sent.name }, token: "fresh-token", expiresInMs: 43200000 }) });
  });
  await page.route("**/api/admin/staff", (route) => route.fulfill({ ...OK, body: JSON.stringify({ staff: [] }) }));
  await page.route("**/api/admin/pos-devices", (route) => route.fulfill({ ...OK, body: JSON.stringify({ devices: [] }) }));
  await page.goto("/admin.html");
  await page.getByRole("navigation", { name: "管理模块" }).getByRole("button", { name: "设置", exact: true }).click();

  const card = page.locator(".account-form");
  await expect(card.locator("input[name='login']")).toHaveValue("wirt@zhaoyun.at");
  await card.locator("input[name='login']").fill("chef");
  await card.locator("input[name='accountName']").fill("Chef Li");
  await card.locator("input[name='nextPassword']").fill("neues-passwort");
  await card.locator("input[name='repeatPassword']").fill("neues-passwort");
  await card.locator("input[name='currentPassword']").fill("kueche-passwort");
  await card.getByRole("button", { name: "保存账户" }).click();

  await expect.poll(() => sent).toEqual({ currentPassword: "kueche-passwort", login: "chef", name: "Chef Li", password: "neues-passwort" });
  await expect(page.locator("#adminToast")).toHaveText("密码已修改，其他设备需要重新登录");
  await expect(page.locator(".admin-role")).toHaveText("Chef Li");
  // The server ended every session and handed this one a fresh token.
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("zy_admin_token"))).toBe("fresh-token");
  await expect(card.locator("input[name='currentPassword']")).toHaveValue("");
});

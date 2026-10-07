import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { APP_MANIFESTS, builtIcons, ICON_APPS, iconRequest, isPng, manifestWithIcon } from "../../shared/app-icons.mjs";

test("the manifests the server fills in are the ones public/ ships, icons aside", () => {
  for (const app of ICON_APPS) {
    const shipped = JSON.parse(readFileSync(new URL(`../../public/${app}.webmanifest`, import.meta.url), "utf8"));
    assert.deepEqual({ ...APP_MANIFESTS[app], icons: builtIcons(app) }, shipped, app);
    assert.deepEqual(Object.keys(manifestWithIcon(app, "v1")).sort(), Object.keys(shipped).sort(), `${app}: nothing left out`);
  }
});

test("only the icons' own addresses are the server's to answer", () => {
  assert.deepEqual(iconRequest("/menu.webmanifest"), { app: "menu", kind: "manifest" });
  assert.deepEqual(iconRequest("/icons/pos-maskable-512.png"), { app: "pos", kind: "png", file: "maskable-512" });
  assert.deepEqual(iconRequest("/icons/admin.svg"), { app: "admin", kind: "svg" });
  for (const other of ["/icons/menu-64.png", "/icons/kitchen-192.png", "/kitchen.webmanifest", "/icons/../menu.svg", "/api/menu.webmanifest"]) {
    assert.equal(iconRequest(other), null, other);
  }
});

test("a PNG is told by its signature", () => {
  assert.equal(isPng(readFileSync(new URL("../../public/icons/menu-192.png", import.meta.url))), true);
  assert.equal(isPng(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")), false);
});

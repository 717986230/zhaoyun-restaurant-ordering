/**
 * The icons an installed app wears (on a phone's home screen, a computer's
 * desktop): the guests' menu, the POS and the console each have their own,
 * shipped in public/icons/ and named in public/*.webmanifest.
 *
 * The owner can put the restaurant's own in their place from the console.
 * The console makes every size from the one picture (in the browser, on a
 * canvas) and the server keeps them with the other pictures (media_files),
 * then answers at the same addresses the built ones live at: the manifests
 * and the HTML pages need no change, and taking the icon off again brings the
 * built one back. Shared by the Node server and the Worker (shared/http.mjs).
 */

export const ICON_APPS = ["menu", "pos", "admin"];

/** The name a restaurant has before it sets its own (shared/settings.mjs): the menu then keeps "Menu". */
const DEFAULT_RESTAURANT_NAME = "赵云";

/** The sizes a manifest and the iPhone's home screen ask for: the form field, the file name, its pixels. */
export const ICON_SIZES = [
  { field: "icon180", file: "180", pixels: 180 },
  { field: "icon192", file: "192", pixels: 192 },
  { field: "icon512", file: "512", pixels: 512 },
  { field: "maskable512", file: "maskable-512", pixels: 512 }
];

/** Small, as icons are: a 512 × 512 photo as a PNG stays below this. */
export const MAX_ICON_BYTES = 1024 * 1024;

/**
 * The manifests as public/*.webmanifest ships them (server/tests/app-icons.test.mjs
 * keeps the two the same), the icons left out: those are filled in per app.
 */
export const APP_MANIFESTS = {
  menu: {
    id: "./",
    name: "Speisekarte · Menu · 菜单",
    short_name: "Menu",
    description: "Die Speisekarte des Restaurants — the restaurant's menu — 餐厅菜单",
    scope: "./",
    display: "standalone",
    background_color: "#0f1113",
    theme_color: "#0f1113"
  },
  pos: {
    id: "./pos.html",
    name: "POS · 点餐收银 · Kassa",
    short_name: "POS",
    description: "点餐、送厨、结账 — Bestellen, Küche, Kassa — ordering, kitchen, payment",
    start_url: "./pos.html",
    scope: "./pos.html",
    display: "standalone",
    background_color: "#14201b",
    theme_color: "#14201b"
  },
  admin: {
    id: "./admin.html",
    name: "管理台 · Verwaltung · Admin",
    short_name: "Admin",
    description: "菜品、跑堂、打印机和设置 — Speisen, Kellner, Drucker — dishes, waiters, printers",
    start_url: "./admin.html",
    scope: "./admin.html",
    display: "standalone",
    background_color: "#18221e",
    theme_color: "#18221e"
  }
};

/** The icons as built: the ones public/*.webmanifest lists. */
export function builtIcons(app) {
  return [
    { src: `icons/${app}-192.png`, sizes: "192x192", type: "image/png" },
    { src: `icons/${app}-512.png`, sizes: "512x512", type: "image/png" },
    { src: `icons/${app}-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    { src: `icons/${app}.svg`, sizes: "any", type: "image/svg+xml" }
  ];
}

/**
 * The manifest as served: the owner's icon when there is one (`version`; each
 * address carries it, so a phone that installed the app sees a new picture as
 * a change and takes it), and the guests' menu under the restaurant's own
 * name (`name`) rather than "Menu". Null when neither changes anything: the
 * built file then answers.
 */
export function servedManifest(app, { version = "", name = "" } = {}) {
  const ownName = app === "menu" && name && name !== DEFAULT_RESTAURANT_NAME ? name : "";
  if (!version && !ownName) return null;
  const v = encodeURIComponent(version);
  return {
    ...APP_MANIFESTS[app],
    ...(ownName ? { name: ownName, short_name: ownName } : {}),
    icons: version ? [
      { src: `icons/${app}-192.png?v=${v}`, sizes: "192x192", type: "image/png" },
      { src: `icons/${app}-512.png?v=${v}`, sizes: "512x512", type: "image/png" },
      { src: `icons/${app}-maskable-512.png?v=${v}`, sizes: "512x512", type: "image/png", purpose: "maskable" }
    ] : builtIcons(app)
  };
}

/**
 * What a path asks for, when it is one of the icons' addresses:
 * { app, kind: "manifest" | "png" | "svg", file? }, otherwise null.
 */
export function iconRequest(pathname) {
  const manifest = /^\/(menu|pos|admin)\.webmanifest$/.exec(pathname);
  if (manifest) return { app: manifest[1], kind: "manifest" };
  const png = /^\/icons\/(menu|pos|admin)-(180|192|512|maskable-512)\.png$/.exec(pathname);
  if (png) return { app: png[1], kind: "png", file: png[2] };
  const svg = /^\/icons\/(menu|pos|admin)\.svg$/.exec(pathname);
  if (svg) return { app: svg[1], kind: "svg" };
  return null;
}

/** Whether these bytes are a PNG: it is what the console makes, and all a manifest's icon may be here. */
export function isPng(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length > signature.length && signature.every((byte, index) => bytes[index] === byte);
}

/**
 * The tab's icon (the pages link an SVG one) as an SVG that holds the PNG:
 * the address and its type stay as the pages name them.
 */
export function svgHoldingPng(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" width="192" height="192"><image href="data:image/png;base64,${btoa(binary)}" width="192" height="192"/></svg>`;
}

/** What the console is told about one app's icon: its version, or null for the built one. */
export function appIconsView(stored) {
  return Object.fromEntries(ICON_APPS.map((app) => [app, stored[app] ? { version: stored[app].version, updatedAt: stored[app].updatedAt } : null]));
}

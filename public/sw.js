/**
 * The menu, offline. A guest whose phone loses the signal at the table, or a
 * menu added to the home screen and opened in a basement, still gets the menu
 * and its photos — the catalogue itself is kept by the app (localStorage);
 * this keeps the page that shows it:
 *
 *  - the menu page: from the network, and the last copy when there is none;
 *  - the built scripts and styles (hashed names, so never stale): from here
 *    once fetched;
 *  - the dishes' photos: shown from here at once, refreshed behind.
 *
 * Nothing else is touched — the API, the console, the POS and the booking
 * page go straight to the network as if this file did not exist.
 */
const SHELL = "zy-shell-v1";
const ASSETS = "zy-assets-v1";
const MEDIA = "zy-media-v1";
const KEEP = [SHELL, ASSETS, MEDIA];
const scope = new URL(self.registration.scope);
const menuPage = new URL("index.html", scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.add(new Request(menuPage, { cache: "reload" }))).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys()
    .then((names) => Promise.all(names.filter((name) => name.startsWith("zy-") && !KEEP.includes(name)).map((name) => caches.delete(name))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === scope.origin;

  if (request.mode === "navigate") {
    // The menu only: "/", "/index.html", with or without ?table=…
    if (sameOrigin && (url.pathname === scope.pathname || url.href.split(/[?#]/)[0] === menuPage)) event.respondWith(menu(request));
    return;
  }
  if (sameOrigin && url.pathname.startsWith(`${scope.pathname}assets/`)) {
    event.respondWith(kept(request, ASSETS, 120));
    return;
  }
  if (request.destination === "image" && /\/media\//.test(url.pathname)) event.respondWith(photo(request, event));
});

async function menu(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL);
      await cache.put(menuPage, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(menuPage);
    if (cached) return cached;
    throw error;
  }
}

async function kept(request, name, limit) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await store(name, request, response.clone(), limit);
  return response;
}

async function photo(request, event) {
  const cached = await caches.match(request);
  const fresh = fetch(request).then(async (response) => {
    if (response.ok) await store(MEDIA, request, response.clone(), 300);
    return response;
  });
  if (cached) {
    event.waitUntil(fresh.catch(() => {}));
    return cached;
  }
  return fresh;
}

/** Keeps the newest `limit` entries; the oldest go first. */
async function store(name, request, response, limit) {
  const cache = await caches.open(name);
  await cache.put(request, response);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - limit)).map((key) => cache.delete(key)));
}

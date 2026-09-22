# GitHub Pages

The menu is a static site. The data is not.

`.github/workflows/ci.yml` has a `pages` job: every commit on `main` that
passes `checks` builds `dist/web` and publishes it to GitHub Pages. What it
publishes is the two apps — `index.html` is the guest menu, `admin.html` is the
console — and nothing else. Neither holds a dish, a price or an allergen
declaration: those come from D1 over the Worker API at `/api/catalog`, at the
moment a guest opens the page, so editing the menu in the console changes what
the next guest reads without rebuilding or redeploying anything.

```
guest phone ──▶ 717986230.github.io/zhaoyun-restaurant-ordering/   the pages, from Pages
                            │
                            └── fetch /api/catalog ──▶ Worker ──▶ D1   the menu, from the database
```

## What has to be set, once

1. **Pages turned on, built from Actions.** Settings → Pages → Build and
   deployment → Source: **GitHub Actions**. Without this the job fails at
   `deploy-pages` with a 404 — the site has to exist before something can be
   published to it.
2. **`API_BASE_URL`**, a repository *variable* (Settings → Secrets and
   variables → Actions → Variables), set to the deployed Worker, e.g.
   `https://zhaoyun-ordering.<subdomain>.workers.dev`. The same variable the
   Android job already uses to point the APK at a backend.
3. **The Worker deployed**, so there is something to point at — `docs/D1.md`.
   `CORS_ORIGIN` in `wrangler.toml` already lists the Pages origin, because
   Pages and the Worker are two different origins and the browser asks
   permission before reading across them.

Leave `API_BASE_URL` unset and the site still publishes and still renders: the
guest app falls back to the catalogue bundled into the build and says
«离线菜单，价格以店内为准» on screen. The console, which has no equivalent
fallback, will simply not connect. That is the honest failure — a published
menu nobody can edit — rather than a blank page.

## The base path

A project site serves from `/<repo>/`, while the Worker and the Capacitor shell
both serve from `/`. One build output cannot assume both, so `vite.config.js`
reads `VITE_BASE_PATH` and defaults to `/`; only the `pages` job passes
anything else, and it passes what `actions/configure-pages` reports rather than
a hard-coded path — so adding a custom domain later moves the site to the root
without a code change.

## What Pages cannot do

It serves files. It does not run code, so the API, the database, the printer
queue and the admin's writes all still need the Worker (or the Node server in
the restaurant). Pages is the front half; `docs/D1.md` is the back half.

The tablets in the restaurant do not need this at all — they install the APK,
which carries the same two apps and talks to the same Worker. Pages is for the
phone of a guest who scanned a card, and for an owner editing the menu from
somewhere that is not the restaurant.

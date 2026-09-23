import { defineConfig, devices } from "@playwright/test";

// On CI the tests run against the production build the job has just made
// (`vite preview` serves dist/web), not the dev server: the dev server hands
// the browser hundreds of untransformed modules on every page load, which
// across some four hundred tests was most of an eleven-minute run. And every
// core the runner has — Playwright otherwise uses half of them.
const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  workers: ci ? 4 : undefined,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: ci ? "npx vite preview --host 127.0.0.1 --port 5173 --strictPort" : "npm run start -- --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120000
  },
  projects: [
    { name: "android-phone-portrait", use: { ...devices["Pixel 7"] } },
    { name: "android-phone-landscape", use: { ...devices["Pixel 7 landscape"] } },
    { name: "android-tablet-portrait", use: { viewport: { width: 800, height: 1280 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: "android-tablet-landscape", use: { viewport: { width: 1280, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    // iPhones, in WebKit — the engine every browser on iOS uses, so what a
    // guest scanning the table card with an iPhone gets. They run the layout
    // spec: the promise that nothing on the menu overlaps, whatever the phone.
    // CI installs WebKit; a machine without it sets NO_WEBKIT=1.
    ...(process.env.NO_WEBKIT ? [] : [
      { name: "iphone-15", testMatch: /layout\.spec\.js/, use: { ...devices["iPhone 15"] } },
      { name: "iphone-se", testMatch: /layout\.spec\.js/, use: { ...devices["iPhone SE"] } },
      { name: "iphone-15-pro-max-landscape", testMatch: /layout\.spec\.js/, use: { ...devices["iPhone 15 Pro Max landscape"] } }
    ])
  ]
});

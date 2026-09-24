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
  // Tests, not whole files, are shared out between workers and between CI's
  // shards: by file, every iPhone project landed on the same shard.
  fullyParallel: true,
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
  // Each iPhone follows an Android project, so each of CI's shards — which
  // take the list in order — gets one iPhone rather than the last one all three.
  projects: [
    { name: "android-phone-portrait", use: { ...devices["Pixel 7"] } },
    iphone("iphone-15", devices["iPhone 15"]),
    { name: "android-phone-landscape", use: { ...devices["Pixel 7 landscape"] } },
    iphone("iphone-se", devices["iPhone SE"]),
    { name: "android-tablet-portrait", use: { viewport: { width: 800, height: 1280 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    iphone("iphone-15-pro-max-landscape", devices["iPhone 15 Pro Max landscape"]),
    { name: "android-tablet-landscape", use: { viewport: { width: 1280, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } }
  ].filter(Boolean)
});

// iPhones, in WebKit — the engine every browser on iOS uses, so what a guest
// scanning the table card with an iPhone gets. They run the layout spec: the
// promise that nothing on the menu overlaps, whatever the phone. CI installs
// WebKit; a machine without it sets NO_WEBKIT=1.
function iphone(name, device) {
  if (process.env.NO_WEBKIT) return null;
  // CI's WebKit draws in software, several times slower than Chromium: a
  // test that opens and closes three 3D dish cards takes 8s in Chromium and
  // ran past 30s there. So twice the time, and at most two WebKits at once
  // on a four-core runner.
  return { name, testMatch: /layout\.spec\.js/, workers: ci ? 2 : undefined, timeout: 60000, use: { ...device } };
}

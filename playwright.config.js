import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "npm run start -- --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120000
  },
  projects: [
    { name: "android-phone-portrait", use: { ...devices["Pixel 7"] } },
    { name: "android-phone-landscape", use: { ...devices["Pixel 7 landscape"] } },
    { name: "android-tablet-portrait", use: { viewport: { width: 800, height: 1280 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: "android-tablet-landscape", use: { viewport: { width: 1280, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } }
  ]
});

import { defineConfig } from "vite";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { headersFile, WEB_HEADERS } from "./shared/web-headers.mjs";

// Three things serve these files and they disagree about where the root is:
// the Worker and the Capacitor shell both serve them from `/`, while a GitHub
// Pages project site serves them from `/<repo>/`. So the base is a build input
// with the root as its default, and only the Pages job passes anything else.
const basePath = process.env.VITE_BASE_PATH || "/";

export default defineConfig({
  base: basePath.endsWith("/") ? basePath : `${basePath}/`,
  plugins: [react(), {
    // dist/web/_headers: the Worker's static assets are served with the app's security headers.
    name: "zhaoyun-web-headers",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "_headers", source: headersFile() });
    }
  }],
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: resolve(import.meta.dirname, "index.html"),
        admin: resolve(import.meta.dirname, "admin.html"),
        pos: resolve(import.meta.dirname, "pos.html")
      }
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5173
  },
  // The browser tests on CI run against the build under the same policy as
  // production. The dev server goes without: its hot reload runs inline scripts.
  preview: {
    headers: WEB_HEADERS
  }
});

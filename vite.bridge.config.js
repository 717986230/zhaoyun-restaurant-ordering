import { defineConfig } from "vite";

/**
 * The print bridge as one file (dist/web/print-bridge.mjs), served next to the
 * web app for the restaurant to download: Node.js and this file are all a
 * computer in the shop needs, no checkout of the project and no npm install.
 * Built after the web app, into the same folder, so it is deployed with it.
 */
export default defineConfig({
  build: {
    ssr: "server/print-agent.mjs",
    outDir: process.env.BRIDGE_OUT_DIR || "dist/web",
    emptyOutDir: false,
    target: "node22",
    minify: false,
    rolldownOptions: {
      output: { entryFileNames: "print-bridge.mjs", format: "es", codeSplitting: false }
    }
  },
  ssr: { noExternal: true, target: "node" },
  logLevel: "warn"
});

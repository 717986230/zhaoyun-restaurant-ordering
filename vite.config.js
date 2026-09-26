import { defineConfig } from "vite";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";

// Three things serve these files and they disagree about where the root is:
// the Worker and the Capacitor shell both serve them from `/`, while a GitHub
// Pages project site serves them from `/<repo>/`. So the base is a build input
// with the root as its default, and only the Pages job passes anything else.
const basePath = process.env.VITE_BASE_PATH || "/";

export default defineConfig({
  base: basePath.endsWith("/") ? basePath : `${basePath}/`,
  plugins: [react()],
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
  }
});

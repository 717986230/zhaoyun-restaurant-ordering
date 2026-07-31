import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    outDir: "dist/web",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: resolve(import.meta.dirname, "index.html"),
        admin: resolve(import.meta.dirname, "admin.html")
      }
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5173
  }
});

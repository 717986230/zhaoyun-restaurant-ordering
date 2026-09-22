import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // @testing-library/react needs a DOM; the pure domain tests are happy in one too.
    environment: "jsdom",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "apps/**/*.test.tsx"],
    exclude: ["node_modules/**", "dist/**"]
  }
});

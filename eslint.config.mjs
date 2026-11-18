// Flat config (ESLint 10). Only @eslint/js `recommended`: no stylistic rules,
// so this checks for real mistakes (undefined names, unused bindings,
// unreachable code) and never fights the repo's hand-packed line style.
//
// Scope: JavaScript only. TypeScript (.ts/.tsx) is checked by `tsc -b`
// (`npm run typecheck`); there is no @typescript-eslint parser in this repo
// and adding one is out of scope for this change.
import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "**/dist/**",
      "android/**",
      ".wrangler/**",
      "test-results/**",
      "playwright-report/**",
      "server/data/**",
      "server/uploads/**",
      "server/dish-photos/**",
      "migrations/**",
      "sources/**",
      "*.tsbuildinfo",
    ],
  },
  {
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2024,
        // Cloudflare Workers runtime: workers/live.mjs pairs sockets with it.
        WebSocketPair: "readonly",
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      // The repo strips a field with rest destructuring (`const { table: _table, ...account } = value`)
      // in a dozen places; the stripped name is intentionally unread. Everything else stays as recommended.
      "no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
];

import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

/**
 * Lint config for OpenCharts.
 *
 * The rule set is deliberately correctness-first: hook dependency and
 * rules-of-hooks violations, floating promises in event handlers, and unused
 * code are errors, while stylistic opinions are left to the formatter. Run it
 * with `npm run lint`.
 */
export default tseslint.config(
  { ignores: ["dist", "node_modules", "coverage", "src/services/demo/data"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.es2022 },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      // rules-of-hooks and exhaustive-deps stay errors (above) — they catch real
      // defects. The React Compiler rule set below flags idiomatic patterns this
      // codebase uses deliberately: "latest value" refs assigned during render,
      // freshness checks like `Date.now() - tick.timestamp`, and effects that
      // sync derived state. They are advisory here, not blocking.
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",

      // Unused code is a bug signal, not a style preference — but leading
      // underscores mark the intentionally-ignored parameters of stub APIs.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],

      // `any` defeats the typecheck gate; warn rather than error so it shows up
      // in review without blocking work on the legacy PropSim modules.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",

      // Real defect classes in this codebase.
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-var": "error",
      "prefer-const": "error",
    },
  },
  {
    // Tests may reach for looser types when building fixtures.
    files: ["src/__tests__/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.node } },
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);

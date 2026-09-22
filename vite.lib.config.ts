import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import path from "node:path";
import dts from "vite-plugin-dts";
import { defineConfig } from "vite";

/**
 * Library build — what ships to npm.
 *
 * Three entry points, kept separate so an application only pays for what it
 * imports:
 *   index        providers, panels, the adapter contract
 *   demo         the bundled demo backend and its candle data
 *   conformance  the adapter test suite (needs vitest)
 *
 * Every dependency is external: the host's bundler resolves and dedupes them,
 * so an app already using React Query or Radix does not get a second copy.
 * Styles are built separately by scripts/build-lib-css.mjs.
 */

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const externalPackages = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  "vitest",
];

/** A package and any of its deep imports (react/jsx-runtime, lucide-react/icons/x). */
const isExternal = (id: string) =>
  externalPackages.some((name) => id === name || id.startsWith(`${name}/`));

export default defineConfig({
  plugins: [
    react(),
    dts({
      tsconfigPath: "./tsconfig.lib.json",
      entryRoot: "src",
      outDir: "dist-lib",
      include: ["src"],
      exclude: ["src/__tests__", "src/main.tsx", "src/Root.tsx"],
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@propsim/types": path.resolve(__dirname, "./src/vendor/types.ts"),
    },
  },
  build: {
    outDir: "dist-lib",
    emptyOutDir: true,
    sourcemap: true,
    // Consumers minify with their own toolchain; readable output makes stack
    // traces from production issues actually debuggable.
    minify: false,
    lib: {
      entry: {
        index: path.resolve(__dirname, "src/index.ts"),
        demo: path.resolve(__dirname, "src/demo.ts"),
        conformance: path.resolve(__dirname, "src/adapter/conformance.ts"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      external: isExternal,
      output: {
        // Stable, readable chunk names for the lazily loaded candle data.
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
  },
});

#!/usr/bin/env node
/**
 * Builds dist-lib/style.css — the stylesheet integrators import.
 *
 * Runs the project's own PostCSS pipeline (Tailwind, then the `.opencharts`
 * scoping prefixer, then autoprefixer), so the shipped CSS is compiled: hosts
 * do not need Tailwind installed or configured, and nothing in it can reach
 * outside the terminal's root element.
 *
 * It then fails the build if anything escaped the scope, because a single
 * global rule is enough to restyle — or freeze the scrolling of — a host page.
 */
import { transform } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import postcssConfig from "../postcss.config.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "src/styles/global.css");
const OUT_DIR = join(ROOT, "dist-lib");
const OUT = join(OUT_DIR, "style.css");

const input = readFileSync(SOURCE, "utf8");
const result = await postcss(postcssConfig.plugins).process(input, { from: SOURCE, to: OUT });

for (const warning of result.warnings()) console.warn(`[css] ${warning.toString()}`);

// Every selector must sit under .opencharts. Keyframe steps and at-rule
// headers are not selectors, so they are skipped.
const leaks = [];
result.root.walkRules((rule) => {
  if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
  for (const selector of rule.selectors) {
    if (!selector.includes(".opencharts")) leaks.push(selector);
  }
});

if (leaks.length > 0) {
  console.error("style.css has selectors outside the .opencharts scope:");
  for (const leak of [...new Set(leaks)].slice(0, 20)) console.error(`  ${leak}`);
  process.exit(1);
}

const minified = await transform(result.css, { loader: "css", minify: true });
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, minified.code);

console.log(`dist-lib/style.css  ${(minified.code.length / 1024).toFixed(1)} KB, fully scoped`);

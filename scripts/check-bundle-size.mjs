#!/usr/bin/env node
/**
 * First-load payload budget.
 *
 * Measures every asset `dist/index.html` pulls in before the app can render —
 * the entry chunk, its module preloads and the stylesheet — and fails when the
 * total exceeds the budget below. Lazy chunks (per-symbol candle data, route
 * splits) are deliberately excluded: they are fetched on demand.
 *
 * The budget exists because this payload was 4.94 MB before the candle JSON was
 * made lazy. Without a gate, that regresses the first time someone adds an
 * eager import.
 *
 * Usage: node scripts/check-bundle-size.mjs [--update]
 */
import { gzipSync } from "node:zlib";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

/** Raise these deliberately, in a commit that explains why. */
const BUDGET = {
  rawKB: 1250,
  gzipKB: 380,
};

const KB = 1024;
const fmt = (bytes) => `${(bytes / KB).toFixed(1)} KB`;

if (!existsSync(join(DIST, "index.html"))) {
  console.error("No dist/index.html — run `npm run build` first.");
  process.exit(1);
}

const html = readFileSync(join(DIST, "index.html"), "utf8");

// Entry script, modulepreloads and stylesheets all block first render.
const refs = [...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)]
  .map((m) => m[1].replace(/^.*\/assets\//, "assets/"))
  .filter((ref, i, all) => all.indexOf(ref) === i);

if (refs.length === 0) {
  console.error("Parsed no asset references out of dist/index.html — check the build output.");
  process.exit(1);
}

let raw = 0;
let gzip = 0;
const rows = [];

for (const ref of refs) {
  const file = join(DIST, ref);
  if (!existsSync(file)) {
    console.error(`Referenced asset is missing from dist: ${ref}`);
    process.exit(1);
  }
  const bytes = readFileSync(file);
  const gz = gzipSync(bytes).length;
  raw += bytes.length;
  gzip += gz;
  rows.push({ ref, raw: bytes.length, gzip: gz });
}

rows.sort((a, b) => b.raw - a.raw);
console.log("First-load payload:");
for (const row of rows) {
  console.log(`  ${fmt(row.raw).padStart(10)}  ${fmt(row.gzip).padStart(9)} gz  ${row.ref}`);
}
console.log(`  ${"─".repeat(40)}`);
console.log(`  ${fmt(raw).padStart(10)}  ${fmt(gzip).padStart(9)} gz  total`);
console.log(
  `Budget: ${BUDGET.rawKB} KB raw / ${BUDGET.gzipKB} KB gzip ` +
    `(using ${((raw / KB / BUDGET.rawKB) * 100).toFixed(0)}% / ` +
    `${((gzip / KB / BUDGET.gzipKB) * 100).toFixed(0)}%)`,
);

const failures = [];
if (raw / KB > BUDGET.rawKB) failures.push(`raw ${fmt(raw)} exceeds ${BUDGET.rawKB} KB`);
if (gzip / KB > BUDGET.gzipKB) failures.push(`gzip ${fmt(gzip)} exceeds ${BUDGET.gzipKB} KB`);

if (failures.length > 0) {
  console.error("\nFirst-load payload over budget:");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    "\nEither trim the payload (prefer a lazy import) or raise BUDGET in\n" +
      "scripts/check-bundle-size.mjs in the same commit, with the reason.",
  );
  process.exit(1);
}

console.log("\nWithin budget.");

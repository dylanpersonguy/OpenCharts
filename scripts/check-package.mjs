#!/usr/bin/env node
/**
 * Verifies the npm package is shaped the way `package.json` promises.
 *
 * Checks every `exports` target exists after `npm run build:lib`, that the
 * stylesheet is present, that the core entry carries none of the bundled demo
 * data, and that dependencies stayed external instead of being bundled in. It
 * runs in CI so a packaging regression fails a pull request rather than an
 * integrator's install.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const failures = [];

for (const [subpath, target] of Object.entries(pkg.exports)) {
  const files = typeof target === "string" ? [target] : Object.values(target);
  for (const file of files) {
    if (!existsSync(join(ROOT, file))) failures.push(`export "${subpath}" points at missing ${file}`);
  }
}

const core = readFileSync(join(ROOT, "dist-lib/index.js"), "utf8");
if (/USD_(1m|5m|15m|30m|1h|4h|1d|1w)/.test(core)) {
  failures.push("dist-lib/index.js references bundled candle data; it belongs in the demo entry");
}

// A dependency bundled into the library ships a second copy into every host.
for (const dep of [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]) {
  if (dep === "vitest") continue;
  const imported = new RegExp(`from ["']${dep.replace("/", "\/")}(["']|/)`).test(core);
  const bundledMarker = new RegExp(`node_modules[\\/]${dep.replace("/", "[\\/]")}[\\/]`).test(core);
  if (bundledMarker) failures.push(`${dep} appears to be bundled into dist-lib/index.js`);
  if (!imported && ["react", "lightweight-charts", "@tanstack/react-query", "zustand"].includes(dep)) {
    failures.push(`${dep} is not imported externally from dist-lib/index.js`);
  }
}

if (failures.length > 0) {
  console.error("Package check failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`Package check passed: ${Object.keys(pkg.exports).length} exports, deps external, core free of demo data.`);

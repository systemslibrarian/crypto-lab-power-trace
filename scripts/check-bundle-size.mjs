// Deterministic bundle-size budget. Fails if the gzipped production assets drift
// past generous ceilings (~1.5x current), so slow bloat is caught in CI, not later.
// Run after `npm run build`.
import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";

const ASSET_DIR = "dist/assets";
const BUDGET = { js: 26 * 1024, css: 6 * 1024 }; // gzipped bytes

let files;
try {
  files = readdirSync(ASSET_DIR);
} catch {
  console.error(`No build found at ${ASSET_DIR}. Run "npm run build" first.`);
  process.exit(1);
}

const sizes = { js: 0, css: 0 };
for (const f of files) {
  const ext = f.endsWith(".js") ? "js" : f.endsWith(".css") ? "css" : null;
  if (!ext) continue;
  sizes[ext] += gzipSync(readFileSync(join(ASSET_DIR, f))).length;
}

let failed = false;
for (const kind of ["js", "css"]) {
  const used = sizes[kind];
  const budget = BUDGET[kind];
  const pct = ((used / budget) * 100).toFixed(0);
  const status = used <= budget ? "OK " : "OVER";
  if (used > budget) failed = true;
  console.log(`${status} ${kind.toUpperCase().padEnd(3)} ${(used / 1024).toFixed(2)} KiB gzip / ${(budget / 1024).toFixed(0)} KiB budget (${pct}%)`);
}

if (failed) {
  console.error("\nBundle-size budget exceeded. Trim the bundle or, if intentional, raise the budget in scripts/check-bundle-size.mjs.");
  process.exit(1);
}
console.log("\nBundle within budget.");

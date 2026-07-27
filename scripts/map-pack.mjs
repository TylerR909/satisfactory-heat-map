#!/usr/bin/env node
/**
 * Pack generated WebPs into map-tiles/v1.tar.gz for commit.
 * Cloudflare Git / plain `npm run build` unpack this (see map-ensure-tiles.mjs).
 *
 * Prerequisites: npm run map:generate (or Docker tiles stage output on disk)
 *
 * Usage: npm run map:pack
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const v1 = path.join(root, "public", "map", "v1");
const sentinel = path.join(v1, "0", "0", "0.webp");
const outDir = path.join(root, "map-tiles");
const outFile = path.join(outDir, "v1.tar.gz");

if (!existsSync(sentinel)) {
  console.error("[map:pack] No tiles at public/map/v1/. Run npm run map:generate first.");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

// Archive zoom dirs only — keep README as the sole committed file under public/map/v1/
const members = readdirSync(v1).filter((name) => {
  if (name === "README.md") return false;
  try {
    return statSync(path.join(v1, name)).isDirectory();
  } catch {
    return false;
  }
});

if (members.length === 0) {
  console.error("[map:pack] No zoom-level directories under public/map/v1/");
  process.exit(1);
}

console.log(`[map:pack] packing ${members.join(", ")} → map-tiles/v1.tar.gz`);
execFileSync(
  "tar",
  ["-czf", outFile, "-C", v1, ...members],
  { stdio: "inherit" },
);

const kb = Math.round(statSync(outFile).size / 1024);
console.log(`[map:pack] wrote map-tiles/v1.tar.gz (${kb} KiB)`);
console.log("[map:pack] commit map-tiles/v1.tar.gz so Cloudflare Git builds include basemap tiles");

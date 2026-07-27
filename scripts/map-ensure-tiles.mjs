#!/usr/bin/env node
/**
 * Ensure public/map/v1 WebP tiles exist before Vite build.
 *
 * Order:
 * 1. Already present (local map:generate or Docker tiles stage) → no-op
 * 2. Committed pack map-tiles/v1.tar.gz → extract (Cloudflare Git / CI without GDAL)
 * 3. Else fail with a clear message
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sentinel = path.join(root, "public", "map", "v1", "0", "0", "0.webp");
const pack = path.join(root, "map-tiles", "v1.tar.gz");
const v1Dir = path.join(root, "public", "map", "v1");

if (existsSync(sentinel)) {
  console.log("[map:ensure] tiles already present");
  process.exit(0);
}

if (!existsSync(pack)) {
  console.error(
    "[map:ensure] No basemap tiles and no pack at map-tiles/v1.tar.gz.\n" +
      "  Local/Docker with GDAL:  npm run map:generate\n" +
      "  Then refresh the committed pack:  npm run map:pack\n" +
      "  (Cloudflare Git builds rely on the committed pack — no Docker on CF VMs.)",
  );
  process.exit(1);
}

// Pack contains zoom dirs (0/, 1/, …) only — extract into public/map/v1/
mkdirSync(v1Dir, { recursive: true });
console.log(`[map:ensure] extracting ${path.relative(root, pack)} → public/map/v1/`);
execFileSync("tar", ["-xzf", pack, "-C", v1Dir], { stdio: "inherit" });

if (!existsSync(sentinel)) {
  console.error("[map:ensure] extract finished but public/map/v1/0/0/0.webp is still missing");
  process.exit(1);
}
console.log("[map:ensure] ok");

#!/usr/bin/env node
/**
 * Docker basemap pipeline: input map → tiles + open-water data.
 *
 * 1) GDAL (osgeo/gdal): wiki Map.jpg → public/map/v1/ WebP pyramid
 *    + map-source/Map-{SIZE}.png intermediate
 * 2) Node + sharp: blue-pixel open-water bodies → public/data/water/open-water.json
 *
 * Usage:
 *   npm run map:generate
 *   MAP_INPUT=map-source/custom.png npm run map:generate
 *   MAP_TARGET_SIZE=8192 MAP_MAX_ZOOM=5 npm run map:generate
 *   MAP_SKIP_TILES=1 npm run map:generate   # PNG + water only (re-extract)
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GDAL_IMAGE = process.env.MAP_GDAL_IMAGE || "osgeo/gdal:ubuntu-small-3.6.3";
const NODE_IMAGE = process.env.MAP_NODE_IMAGE || "node:24-bookworm-slim";
const inner = "scripts/map-generate-inner.sh";
const waterScript = "scripts/map-extract-water.mjs";

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.error) die(`Failed to run ${cmd}: ${r.error.message}`);
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// Ensure Docker is available
{
  const r = spawnSync("docker", ["info"], { stdio: "ignore" });
  if (r.status !== 0) {
    die(
      "Docker is required for npm run map:generate (no host GDAL/sharp).\n" +
        "Start Docker Desktop / the daemon, then retry.",
    );
  }
}

mkdirSync(path.join(root, "public", "map", "v1"), { recursive: true });
mkdirSync(path.join(root, "map-source"), { recursive: true });
mkdirSync(path.join(root, "public", "data", "water"), { recursive: true });

if (!existsSync(path.join(root, inner))) {
  die(`Missing ${inner}`);
}
if (!existsSync(path.join(root, waterScript))) {
  die(`Missing ${waterScript}`);
}

// Pass through optional env knobs
const passEnv = [
  "MAP_SOURCE_URL",
  "MAP_TARGET_SIZE",
  "MAP_MAX_ZOOM",
  "MAP_WEBP_QUALITY",
  "MAP_OUT_DIR",
  "MAP_WORK_DIR",
  "MAP_TILES_TMP",
  "MAP_INPUT",
  "MAP_PROCESSES",
  "MAP_SKIP_TILES",
  "MAP_WATER_OUT",
  "MAP_WATER_INPUT",
  "MAP_WATER_MIN_AREA",
  "MAP_WATER_OPEN_RADIUS",
  "MAP_WATER_MAX_SAMPLES",
  "MAP_WATER_MAX_SLOTS",
  "MAP_WATER_DEBUG_MASK",
];

const dockerEnv = [];
for (const key of passEnv) {
  if (process.env[key]) {
    dockerEnv.push("-e", `${key}=${process.env[key]}`);
  }
}

const skipTiles = process.env.MAP_SKIP_TILES === "1";
console.log(`Using GDAL image ${GDAL_IMAGE}`);
console.log(
  skipTiles
    ? "Step 1/2: ensuring source map PNG (tiles skipped)…"
    : "Step 1/2: generating basemap tiles (this can take a few minutes)…",
);

run("docker", [
  "run",
  "--rm",
  "-v",
  `${root}:/work`,
  "-w",
  "/work",
  ...dockerEnv,
  GDAL_IMAGE,
  "bash",
  inner,
]);

const targetSize = process.env.MAP_TARGET_SIZE || "4096";
const workDir = process.env.MAP_WORK_DIR || "map-source";
const sourcePng = path.join(root, workDir, `Map-${targetSize}.png`);
if (!existsSync(sourcePng)) {
  die(`Expected source PNG after GDAL step: ${sourcePng}`);
}

console.log(`Using Node image ${NODE_IMAGE}`);
console.log("Step 2/2: extracting open-water bodies from map pixels…");

// Ephemeral sharp install inside the container — not an app runtime dependency.
run("docker", [
  "run",
  "--rm",
  "-v",
  `${root}:/work`,
  "-w",
  "/work",
  ...dockerEnv,
  NODE_IMAGE,
  "bash",
  "-lc",
  [
    "set -euo pipefail",
    "npm install --no-save --no-fund --no-audit sharp@0.33.5 >/tmp/sharp-install.log 2>&1 || {",
    "  tail -50 /tmp/sharp-install.log; exit 1;",
    "}",
    `node ${waterScript}`,
  ].join("\n"),
]);

const waterOut =
  process.env.MAP_WATER_OUT || path.join(root, "public", "data", "water", "open-water.json");
if (!existsSync(waterOut)) {
  die(`Water extract finished but missing ${waterOut}`);
}

console.log("map:generate complete (tiles + open-water)");
if (!skipTiles) {
  console.log("Refresh the committed tile pack when basemap art changes: npm run map:pack");
}
console.log("Commit public/data/water/open-water.json when water thresholds change");

#!/usr/bin/env node
/**
 * Docker-only basemap tile generator.
 * Pulls wiki Map.jpg (or MAP_INPUT), builds XYZ WebP pyramid into public/map/v1/.
 *
 * Usage:
 *   npm run map:generate
 *   MAP_INPUT=map-source/custom.png npm run map:generate
 *   MAP_TARGET_SIZE=8192 MAP_MAX_ZOOM=5 npm run map:generate
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GDAL_IMAGE = process.env.MAP_GDAL_IMAGE || "osgeo/gdal:ubuntu-small-3.6.3";
const inner = "scripts/map-generate-inner.sh";

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
      "Docker is required for npm run map:generate (no host GDAL).\n" +
        "Start Docker Desktop / the daemon, then retry.",
    );
  }
}

mkdirSync(path.join(root, "public", "map", "v1"), { recursive: true });
mkdirSync(path.join(root, "map-source"), { recursive: true });

if (!existsSync(path.join(root, inner))) {
  die(`Missing ${inner}`);
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
];

const dockerEnv = [];
for (const key of passEnv) {
  if (process.env[key]) {
    dockerEnv.push("-e", `${key}=${process.env[key]}`);
  }
}

console.log(`Using image ${GDAL_IMAGE}`);
console.log("Generating basemap tiles (this can take a few minutes)…");

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

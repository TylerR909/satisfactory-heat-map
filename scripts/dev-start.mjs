#!/usr/bin/env node
/**
 * npm start — compile WASM (Dev Container wasm-pack or Docker), basemap tiles, Vite HMR.
 * Never installs Rust on the host.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cratesDir = path.join(root, "crates");
/** Production pyramid — used only when local WebPs cannot be ensured. */
const LIVE_TILES_BASE = "https://satisfactory-heatmap.com/map/v1";

async function ensureWasm() {
  if (!existsSync(path.join(cratesDir, "engine"))) {
    console.log("[start] No crates/engine — TypeScript engine only.");
    return;
  }
  console.log("[start] Building WASM engine (wasm-pack or Docker)…");
  await new Promise((resolve) => {
    const child = spawn("node", ["scripts/wasm-build.mjs"], {
      cwd: root,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code !== 0) {
        console.warn(
          "[start] wasm:build failed — continuing with TypeScript engine fallback if pkg missing.",
        );
      }
      resolve();
    });
  });
}

/**
 * Local Vite serves `public/map/v1/*.webp` same-origin. WebPs are gitignored, so
 * fresh worktrees only have README.md — missing paths fall through to SPA
 * `index.html` (Content-Type: text/html), which looks like a broken basemap.
 *
 * Prefer unpacking the committed pack (same as `npm run build`). If that fails
 * and the user did not set VITE_MAP_TILES_BASE_URL, fall back to production tiles.
 */
function ensureBasemapTiles() {
  const mapTile = path.join(root, "public", "map", "v1", "0", "0", "0.webp");
  if (existsSync(mapTile)) {
    return { localTiles: true };
  }

  console.log("[start] Basemap WebPs missing — running map:ensure (unpack map-tiles/v1.tar.gz)…");
  const ensure = spawnSync("npm", ["run", "map:ensure"], {
    cwd: root,
    stdio: "inherit",
    shell: true,
  });
  if (ensure.status === 0 && existsSync(mapTile)) {
    return { localTiles: true };
  }

  if (process.env.VITE_MAP_TILES_BASE_URL?.trim()) {
    console.warn(
      "[start] Local tiles still missing; using existing VITE_MAP_TILES_BASE_URL=" +
        process.env.VITE_MAP_TILES_BASE_URL.trim(),
    );
    return { localTiles: false };
  }

  console.warn(
    "[start] Local tiles still missing — pointing TileLayer at live site:\n" +
      `        ${LIVE_TILES_BASE}/{z}/{x}/{y}.webp\n` +
      "        (Override with VITE_MAP_TILES_BASE_URL; or npm run map:generate for a local pyramid.)",
  );
  return { localTiles: false, useLiveTiles: true };
}

await ensureWasm();
const basemap = ensureBasemapTiles();

// Conductor (and other hosts) may inject CONDUCTOR_PORT / PORT for multi-worktree previews.
const port = process.env.CONDUCTOR_PORT || process.env.PORT || process.env.VITE_PORT;
const viteArgs = ["vite"];
if (port) {
  viteArgs.push("--port", String(port), "--strictPort");
}

const env = { ...process.env };
if (basemap.useLiveTiles && !env.VITE_MAP_TILES_BASE_URL?.trim()) {
  env.VITE_MAP_TILES_BASE_URL = LIVE_TILES_BASE;
}

const vite = spawn("npx", viteArgs, {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env,
});

vite.on("exit", (code) => process.exit(code ?? 0));

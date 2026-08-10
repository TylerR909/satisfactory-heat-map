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
  // wasm-build skips Docker entirely when pkg is newer than crates/ sources.
  console.log("[start] Ensuring WASM engine (skip if pkg up to date)…");
  await new Promise((resolve) => {
    const child = spawn("node", ["scripts/wasm-build.mjs"], {
      cwd: root,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code !== 0) {
        console.warn(
          "[start] wasm:build failed — app will fail to boot without crates/engine/pkg (run wasm:build).",
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

/**
 * Port policy: keep a **stable origin** so browser localStorage survives restarts.
 *
 * Conductor injects CONDUCTOR_PORT into integrated terminals (new high port per
 * workspace/session). Binding that every `npm start` made localhost:55xxx jump
 * around and wiped app state for no local conflict.
 *
 * Prefer:
 *   1. Explicit VITE_PORT / PORT (you opted in)
 *   2. CONDUCTOR_PORT only if USE_CONDUCTOR_PORT=1 (preview / multi-instance opt-in)
 *   3. Else Vite default 5173 — no --strictPort, so a second concurrent start
 *      can auto-bump (5174…) instead of failing
 */
const explicit = process.env.VITE_PORT || process.env.PORT;
const useConductorPort =
  process.env.USE_CONDUCTOR_PORT === "1" || process.env.USE_CONDUCTOR_PORT === "true";
const conductorPort = process.env.CONDUCTOR_PORT;

const port = explicit || (useConductorPort ? conductorPort : null) || "5173";
const viteArgs = ["vite", "--port", String(port)];

if (explicit || useConductorPort) {
  // Caller asked for a specific port — fail if taken rather than silently moving.
  viteArgs.push("--strictPort");
} else if (conductorPort && conductorPort !== String(port)) {
  console.log(
    `[start] Using port ${port} (stable). Ignoring CONDUCTOR_PORT=${conductorPort} — ` +
      `set USE_CONDUCTOR_PORT=1 to bind Conductor's port.`,
  );
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

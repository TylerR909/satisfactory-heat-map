#!/usr/bin/env node
/**
 * npm start — ensure WASM artifacts (Docker, when present), then Vite HMR.
 * Until a Rust crate exists, this is effectively `vite`.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cratesDir = path.join(root, "crates");

async function maybeBuildWasm() {
  if (!existsSync(cratesDir)) {
    console.log("[start] No crates/ yet — using TypeScript heatmap engine.");
    return;
  }
  console.log("[start] crates/ found — attempting Docker wasm build…");
  await new Promise((resolve) => {
    const child = spawn("npm", ["run", "wasm:build"], {
      cwd: root,
      stdio: "inherit",
      shell: true,
    });
    child.on("exit", (code) => {
      if (code !== 0) {
        console.warn(
          "[start] wasm:build failed or Docker unavailable — continuing with committed/TS engine.",
        );
      }
      resolve();
    });
  });
}

await maybeBuildWasm();

const mapTile = path.join(root, "public", "map", "v1", "0", "0", "0.webp");
if (!existsSync(mapTile)) {
  console.warn(
    "[start] Basemap tiles missing (public/map/v1/0/0/0.webp).\n" +
      "        Run:  npm run map:generate\n" +
      "        Then: npm start\n" +
      "        (Once per worktree; tiles are gitignored.)",
  );
}

// Conductor (and other hosts) may inject CONDUCTOR_PORT / PORT for multi-worktree previews.
const port = process.env.CONDUCTOR_PORT || process.env.PORT || process.env.VITE_PORT;
const viteArgs = ["vite"];
if (port) {
  viteArgs.push("--port", String(port), "--strictPort");
}

const vite = spawn("npx", viteArgs, {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env: process.env,
});

vite.on("exit", (code) => process.exit(code ?? 0));

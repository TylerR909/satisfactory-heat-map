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

const vite = spawn("npx", ["vite"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});

vite.on("exit", (code) => process.exit(code ?? 0));

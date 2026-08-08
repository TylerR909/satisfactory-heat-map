/**
 * Ensure crates/engine/pkg exists before Vitest imports WASM.
 * Hosts without wasm-pack use Docker (same as npm run wasm:build).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export default function setup() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const wasmFile = path.join(root, "crates/engine/pkg/sf_engine_bg.wasm");
  if (existsSync(wasmFile)) return;

  console.log("[vitest] WASM pkg missing — running wasm:build…");
  const r = spawnSync("node", ["scripts/wasm-build.mjs"], {
    cwd: root,
    stdio: "inherit",
  });
  if (r.status !== 0) {
    throw new Error("wasm:build failed — cannot run WASM-backed tests");
  }
}

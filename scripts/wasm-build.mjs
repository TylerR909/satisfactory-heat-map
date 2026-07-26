#!/usr/bin/env node
/**
 * Builds WASM crates via Docker only — never requires host Rust.
 * No-op until crates/ and docker-compose wasm-builder service exist.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!existsSync(path.join(root, "crates"))) {
  console.log("[wasm:build] No crates/ directory — skipping.");
  process.exit(0);
}

const result = spawnSync("docker", ["compose", "run", "--rm", "wasm-builder"], {
  cwd: root,
  stdio: "inherit",
});

process.exit(result.status ?? 1);

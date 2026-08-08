#!/usr/bin/env node
/**
 * Compile crates/engine → wasm-bindgen package (compile-on-build).
 *
 * - Dev Container / CI image with wasm-pack on PATH: runs wasm-pack locally.
 * - Host without Rust: runs wasm-pack inside Docker (rust image). Never installs
 *   rustc/cargo/wasm-pack on the host.
 *
 * Output:
 * - crates/engine/pkg/ (gitignored binaries + glue)
 * - src/lib/wasm/generated/sf_engine.d.ts (typed API for TypeScript; committed)
 *
 * Invoked from npm start / npm run build / Conductor setup.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engineDir = path.join(root, "crates", "engine");
const pkgDts = path.join(engineDir, "pkg", "sf_engine.d.ts");
const generatedDir = path.join(root, "src", "lib", "wasm", "generated");
const generatedDts = path.join(generatedDir, "sf_engine.d.ts");

if (process.env.SKIP_WASM_BUILD === "1") {
  const wasmFile = path.join(engineDir, "pkg", "sf_engine_bg.wasm");
  if (existsSync(wasmFile)) {
    console.log("[wasm] SKIP_WASM_BUILD=1 and pkg present — skipping compile.");
    // Still refresh committed .d.ts if pkg has a newer one
    publishTypes();
    process.exit(0);
  }
  console.error("[wasm] SKIP_WASM_BUILD=1 but crates/engine/pkg is missing.");
  process.exit(1);
}

if (!existsSync(engineDir)) {
  console.error("[wasm] crates/engine missing — cannot build WASM.");
  process.exit(1);
}

function hasCmd(cmd) {
  const r = spawnSync(cmd, ["--version"], { encoding: "utf8" });
  return r.status === 0;
}

/** Copy wasm-pack TypeScript definitions into src/ for typecheck (no `any` stubs). */
function publishTypes() {
  if (!existsSync(pkgDts)) {
    console.warn("[wasm] sf_engine.d.ts missing after build — skip type publish");
    return;
  }
  mkdirSync(generatedDir, { recursive: true });
  copyFileSync(pkgDts, generatedDts);
  // Module shim: runtime still loads crates/engine/pkg; types resolve via this path.
  writeFileSync(
    path.join(generatedDir, "README.md"),
    [
      "# Generated WASM TypeScript types",
      "",
      "`sf_engine.d.ts` is copied from `crates/engine/pkg/` by `npm run wasm:build`.",
      "Do not edit by hand — rebuild WASM after changing Rust wire types (`tsify`).",
      "",
    ].join("\n"),
  );
  console.log("[wasm] published TypeScript types → src/lib/wasm/generated/sf_engine.d.ts");
}

// Always prefer --release: unoptimized wasm can be ~5–20× slower on the coarse grid.
// Opt into --dev only when debugging Rust (WASM_DEV=1).
const dev = process.env.WASM_DEV === "1" || process.argv.includes("--dev");
const profileFlag = dev ? "--dev" : "--release";
const wasmPackArgs = [
  "build",
  "crates/engine",
  "--target",
  "bundler",
  "--out-dir",
  "pkg",
  profileFlag,
];
console.log(`[wasm] profile: ${dev ? "dev (slow)" : "release"}`);

mkdirSync(path.join(engineDir, "pkg"), { recursive: true });

if (hasCmd("wasm-pack")) {
  console.log(`[wasm] wasm-pack ${wasmPackArgs.join(" ")}`);
  const r = spawnSync("wasm-pack", wasmPackArgs, {
    cwd: root,
    stdio: "inherit",
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
  publishTypes();
  process.exit(0);
}

if (!hasCmd("docker")) {
  console.error(
    "[wasm] No wasm-pack on PATH and no Docker.\n" +
      "        Use the Dev Container (Rust toolchain), or Docker to compile without host Rust.",
  );
  process.exit(1);
}

console.log("[wasm] Host has no wasm-pack — compiling via Docker (Rust stays off host)…");
const shell = [
  "set -euo pipefail",
  "export CARGO_HOME=/usr/local/cargo RUSTUP_HOME=/usr/local/rustup PATH=/usr/local/cargo/bin:$PATH",
  "if ! command -v rustup >/dev/null 2>&1; then curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable; fi",
  ". /usr/local/cargo/env 2>/dev/null || true",
  "rustup target add wasm32-unknown-unknown",
  "if ! command -v wasm-pack >/dev/null 2>&1; then curl -fsSL https://rustwasm.github.io/wasm-pack/installer/init.sh | sh; fi",
  `wasm-pack ${wasmPackArgs.join(" ")}`,
].join(" && ");

const r = spawnSync(
  "docker",
  [
    "run",
    "--rm",
    "-v",
    `${root}:/workspace`,
    "-w",
    "/workspace",
    "-e",
    "CARGO_HOME=/usr/local/cargo",
    "-e",
    "RUSTUP_HOME=/usr/local/rustup",
    "rust:1-bookworm",
    "bash",
    "-lc",
    shell,
  ],
  { cwd: root, stdio: "inherit" },
);
if (r.status !== 0) process.exit(r.status ?? 1);
publishTypes();
process.exit(0);

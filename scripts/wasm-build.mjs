#!/usr/bin/env node
/**
 * Compile crates/engine → wasm-bindgen package (compile-on-build).
 *
 * Order:
 * 1. Skip if crates/engine/pkg is newer than all Rust sources (unless --force)
 * 2. wasm-pack already on PATH (Dev Container / GHA / prior bootstrap)
 * 3. CI / Cloudflare: install rustup + wasm-pack into $HOME (no Docker)
 * 4. Local laptop: Docker one-shot with **named volumes** for cargo/rustup cache
 *
 * Output:
 * - crates/engine/pkg/ (gitignored binaries + glue)
 * - src/lib/wasm/generated/sf_engine.d.ts (typed API for TypeScript; committed)
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const engineDir = path.join(root, "crates", "engine");
const cratesDir = path.join(root, "crates");
const wasmFile = path.join(engineDir, "pkg", "sf_engine_bg.wasm");
const pkgDts = path.join(engineDir, "pkg", "sf_engine.d.ts");
const generatedDir = path.join(root, "src", "lib", "wasm", "generated");
const generatedDts = path.join(generatedDir, "sf_engine.d.ts");

/** Persist toolchain + registry across `docker run --rm` (not Dockerfile layers). */
const DOCKER_CARGO_VOL = "sf-heatmap-cargo-cache";
const DOCKER_RUSTUP_VOL = "sf-heatmap-rustup-cache";

if (process.env.SKIP_WASM_BUILD === "1") {
  if (existsSync(wasmFile)) {
    console.log("[wasm] SKIP_WASM_BUILD=1 and pkg present — skipping compile.");
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
  const r = spawnSync(cmd, ["--version"], {
    encoding: "utf8",
    env: process.env,
    shell: false,
  });
  return r.status === 0;
}

function isCiLike() {
  return Boolean(
    process.env.CI ||
      process.env.CF_PAGES ||
      process.env.CLOUDFLARE_ACCOUNT_ID ||
      process.env.WORKERS_CI ||
      process.env.CF_PAGES_BRANCH ||
      process.env.CF_PAGES_COMMIT_SHA ||
      process.env.GITHUB_ACTIONS,
  );
}

const force =
  process.env.FORCE_WASM_BUILD === "1" ||
  process.argv.includes("--force") ||
  process.argv.includes("-f");

/**
 * Walk crates/ for sources that affect the wasm binary.
 * If pkg wasm is newer than all of them, skip compile (npm start becomes instant).
 */
function collectSourceFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.name === "target" || name.name === "pkg" || name.name === "node_modules") continue;
    const p = path.join(dir, name.name);
    if (name.isDirectory()) collectSourceFiles(p, out);
    else if (/\.(rs|toml|lock)$/.test(name.name)) out.push(p);
  }
  return out;
}

function wasmUpToDate() {
  if (force) return false;
  if (!existsSync(wasmFile) || !existsSync(pkgDts)) return false;
  const wasmMtime = statSync(wasmFile).mtimeMs;
  const sources = collectSourceFiles(cratesDir);
  if (sources.length === 0) return false;
  for (const f of sources) {
    if (statSync(f).mtimeMs > wasmMtime) return false;
  }
  return true;
}

function prependCargoBinToPath() {
  const home = process.env.HOME || process.env.USERPROFILE || "/tmp";
  const cargoBin = path.join(home, ".cargo", "bin");
  process.env.CARGO_HOME = process.env.CARGO_HOME || path.join(home, ".cargo");
  process.env.RUSTUP_HOME = process.env.RUSTUP_HOME || path.join(home, ".rustup");
  process.env.PATH = `${cargoBin}${path.delimiter}${process.env.PATH || ""}`;
}

function bootstrapRustToolchain() {
  prependCargoBinToPath();
  if (hasCmd("wasm-pack") && hasCmd("rustc")) {
    console.log("[wasm] toolchain already present after PATH fix");
    return true;
  }

  console.log("[wasm] Installing rustup + wasm-pack on this machine (CI/native path)…");

  if (!hasCmd("rustup") && !hasCmd("rustc")) {
    const install = spawnSync(
      "bash",
      [
        "-lc",
        'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable',
      ],
      { cwd: root, stdio: "inherit", env: process.env },
    );
    if (install.status !== 0) {
      console.error("[wasm] rustup install failed");
      return false;
    }
    prependCargoBinToPath();
  }

  const target = spawnSync("rustup", ["target", "add", "wasm32-unknown-unknown"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (target.status !== 0) {
    console.error("[wasm] rustup target add wasm32-unknown-unknown failed");
    return false;
  }

  if (!hasCmd("wasm-pack")) {
    const wp = spawnSync(
      "bash",
      ["-lc", "curl -fsSL https://rustwasm.github.io/wasm-pack/installer/init.sh | sh"],
      { cwd: root, stdio: "inherit", env: process.env },
    );
    if (wp.status !== 0) {
      console.error("[wasm] wasm-pack install failed");
      return false;
    }
    prependCargoBinToPath();
  }

  if (!hasCmd("wasm-pack")) {
    console.error("[wasm] wasm-pack still not on PATH after install");
    return false;
  }
  return true;
}

function runWasmPack() {
  console.log(`[wasm] wasm-pack ${wasmPackArgs.join(" ")}`);
  const r = spawnSync("wasm-pack", wasmPackArgs, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  return r.status ?? 1;
}

/**
 * Local Docker compile. Named volumes keep cargo registry + rustup/wasm-pack
 * across runs so we do NOT re-download/install every `npm start`.
 *
 * Note: `docker run --rm` never uses Dockerfile layer cache for the *commands*
 * we run; only the base image pull is cached. Persistence = volume mounts.
 */
function runDockerWasmPack() {
  console.log(
    `[wasm] Compiling via Docker (volumes ${DOCKER_CARGO_VOL}, ${DOCKER_RUSTUP_VOL} for cache)…`,
  );
  // Image already has rustc; we only ensure wasm target + wasm-pack in the volume.
  const shell = [
    "set -euo pipefail",
    'export PATH="$CARGO_HOME/bin:$PATH"',
    "if ! command -v rustup >/dev/null 2>&1; then",
    "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable",
    "fi",
    '. "$CARGO_HOME/env" 2>/dev/null || true',
    "rustup target add wasm32-unknown-unknown 2>/dev/null || true",
    "if ! command -v wasm-pack >/dev/null 2>&1; then",
    "  curl -fsSL https://rustwasm.github.io/wasm-pack/installer/init.sh | sh",
    "fi",
    `wasm-pack ${wasmPackArgs.join(" ")}`,
  ].join("\n");

  const r = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${root}:/workspace`,
      "-v",
      `${DOCKER_CARGO_VOL}:/usr/local/cargo`,
      "-v",
      `${DOCKER_RUSTUP_VOL}:/usr/local/rustup`,
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
  return r.status ?? 1;
}

function publishTypes() {
  if (!existsSync(pkgDts)) {
    console.warn("[wasm] sf_engine.d.ts missing after build — skip type publish");
    return;
  }
  mkdirSync(generatedDir, { recursive: true });
  copyFileSync(pkgDts, generatedDts);
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

if (wasmUpToDate()) {
  console.log(
    "[wasm] pkg is up to date vs crates/ sources — skip compile (FORCE_WASM_BUILD=1 or --force to rebuild).",
  );
  publishTypes();
  process.exit(0);
}

mkdirSync(path.join(engineDir, "pkg"), { recursive: true });

// 1) wasm-pack on PATH
if (hasCmd("wasm-pack")) {
  const code = runWasmPack();
  if (code !== 0) process.exit(code);
  publishTypes();
  process.exit(0);
}

// 2) CI / Cloudflare: native rustup (Docker often broken)
if (isCiLike() || process.env.WASM_NATIVE === "1") {
  console.log("[wasm] CI/native environment — bootstrapping rustup (not Docker)…");
  if (!bootstrapRustToolchain()) process.exit(1);
  const code = runWasmPack();
  if (code !== 0) process.exit(code);
  publishTypes();
  process.exit(0);
}

// 3) Local: Docker + persistent cargo volumes
if (hasCmd("docker")) {
  const code = runDockerWasmPack();
  if (code === 0) {
    publishTypes();
    process.exit(0);
  }
  console.warn(
    "[wasm] Docker compile failed — falling back to native rustup install on this machine…",
  );
  if (!bootstrapRustToolchain()) process.exit(1);
  const code2 = runWasmPack();
  if (code2 !== 0) process.exit(code2);
  publishTypes();
  process.exit(0);
}

// 4) Last resort
console.log("[wasm] No wasm-pack and no Docker — attempting native rustup install…");
if (!bootstrapRustToolchain()) {
  console.error(
    "[wasm] Cannot build: install Docker (local) or open the Dev Container, or set CI/WASM_NATIVE=1.",
  );
  process.exit(1);
}
const code = runWasmPack();
if (code !== 0) process.exit(code);
publishTypes();
process.exit(0);

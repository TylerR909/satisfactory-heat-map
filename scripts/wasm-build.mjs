#!/usr/bin/env node
/**
 * Compile crates/engine → wasm-bindgen package (compile-on-build).
 *
 * Order:
 * 1. wasm-pack already on PATH (Dev Container / GHA with rustup / prior bootstrap)
 * 2. CI / Cloudflare: install rustup + wasm-pack into $HOME (no Docker)
 * 3. Local laptop: Docker one-shot rust image (never installs rustc on the host)
 *
 * Cloudflare Workers Builds often has a broken/partial Docker (cgroup errors).
 * Never rely on `docker run` there — use native rustup instead.
 *
 * Output:
 * - crates/engine/pkg/ (gitignored binaries + glue)
 * - src/lib/wasm/generated/sf_engine.d.ts (typed API for TypeScript; committed)
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

/** CF Workers Builds / GHA / generic CI — install Rust on the build VM. */
function isCiLike() {
  return Boolean(
    process.env.CI ||
      process.env.CF_PAGES ||
      process.env.CLOUDFLARE_ACCOUNT_ID ||
      process.env.WORKERS_CI ||
      process.env.CF_PAGES_BRANCH ||
      // Workers Builds often sets this when using Git integration
      process.env.CF_PAGES_COMMIT_SHA ||
      process.env.GITHUB_ACTIONS,
  );
}

function prependCargoBinToPath() {
  const home = process.env.HOME || process.env.USERPROFILE || "/tmp";
  const cargoBin = path.join(home, ".cargo", "bin");
  process.env.CARGO_HOME = process.env.CARGO_HOME || path.join(home, ".cargo");
  process.env.RUSTUP_HOME = process.env.RUSTUP_HOME || path.join(home, ".rustup");
  process.env.PATH = `${cargoBin}${path.delimiter}${process.env.PATH || ""}`;
}

/**
 * Install rustup (stable) + wasm32 target + wasm-pack into the current user home.
 * Used on Cloudflare / CI where Docker cannot run containers.
 */
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

function runDockerWasmPack() {
  console.log("[wasm] Compiling via Docker (local host; Rust stays off host)…");
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
  return r.status ?? 1;
}

/** Copy wasm-pack TypeScript definitions into src/ for typecheck. */
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

mkdirSync(path.join(engineDir, "pkg"), { recursive: true });

// 1) Already have wasm-pack (Dev Container, GHA rust-toolchain, prior bootstrap)
if (hasCmd("wasm-pack")) {
  const code = runWasmPack();
  if (code !== 0) process.exit(code);
  publishTypes();
  process.exit(0);
}

// 2) CI / Cloudflare: install toolchain on the VM (Docker often broken there)
if (isCiLike() || process.env.WASM_NATIVE === "1") {
  console.log("[wasm] CI/native environment — bootstrapping rustup (not Docker)…");
  if (!bootstrapRustToolchain()) process.exit(1);
  const code = runWasmPack();
  if (code !== 0) process.exit(code);
  publishTypes();
  process.exit(0);
}

// 3) Local laptop: one-shot Docker so host never needs rustc
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

// 4) Last resort: native install even on non-CI host
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

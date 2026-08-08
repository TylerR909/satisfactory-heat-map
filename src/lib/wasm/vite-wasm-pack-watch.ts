/**
 * Vite plugin: when wasm-pack is on PATH (Dev Container), rebuild crates/engine
 * on Rust changes and trigger a full reload. Host without wasm-pack: no-op
 * (use `npm run wasm:build` / Docker instead).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import type { Plugin } from "vite";

function hasWasmPack(): boolean {
  const r = spawnSync("wasm-pack", ["--version"], { encoding: "utf8" });
  return r.status === 0;
}

export function wasmPackWatch(crateRel = "crates/engine"): Plugin {
  const enabled = hasWasmPack();
  let root = process.cwd();

  return {
    name: "sf-wasm-pack-watch",
    configResolved(config) {
      root = config.root;
    },
    buildStart() {
      if (!enabled) return;
      // Release profile: debug wasm is dramatically slower than the TS scorer.
      const r = spawnSync(
        "wasm-pack",
        ["build", crateRel, "--target", "bundler", "--out-dir", "pkg", "--release"],
        { cwd: root, stdio: "inherit" },
      );
      if (r.status !== 0) {
        this.error(`wasm-pack build failed for ${crateRel}`);
      }
    },
    configureServer(server) {
      if (!enabled) {
        server.config.logger.warn(
          "[wasm] wasm-pack not on PATH — Rust HMR disabled. Use Dev Container or npm run wasm:build (Docker).",
        );
        return;
      }
      const crateAbs = path.resolve(root, crateRel);
      server.watcher.add(path.join(crateAbs, "src/**/*.rs"));
      server.watcher.add(path.join(crateAbs, "Cargo.toml"));
      server.watcher.add(path.join(root, "crates/Cargo.toml"));
      server.watcher.add(path.join(root, "crates/vendored/**/*.rs"));

      let building = false;
      const rebuild = (file: string) => {
        if (!file.includes(`${path.sep}crates${path.sep}`) || building) return;
        if (!file.endsWith(".rs") && !file.endsWith("Cargo.toml")) return;
        building = true;
        server.config.logger.info(`[wasm] change in ${file} — rebuilding…`);
        const r = spawnSync(
          "wasm-pack",
          ["build", crateRel, "--target", "bundler", "--out-dir", "pkg", "--release"],
          { cwd: root, stdio: "inherit" },
        );
        building = false;
        if (r.status === 0) {
          server.ws.send({ type: "full-reload" });
        } else {
          server.config.logger.error("[wasm] rebuild failed");
        }
      };
      server.watcher.on("change", rebuild);
    },
  };
}

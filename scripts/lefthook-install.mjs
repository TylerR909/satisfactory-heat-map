#!/usr/bin/env node
/**
 * npm prepare: install git hooks when a git repo is available.
 * Skip in Docker/CI images without git (lefthook install would fail).
 */
import { spawnSync } from "node:child_process";

const git = spawnSync("git", ["rev-parse", "--git-dir"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
});

if (git.status !== 0) {
  console.log("[prepare] skip lefthook install (git not available)");
  process.exit(0);
}

const install = spawnSync("npx", ["lefthook", "install"], {
  stdio: "inherit",
  shell: true,
});
process.exit(install.status ?? 1);

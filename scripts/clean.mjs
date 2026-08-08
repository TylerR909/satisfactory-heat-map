#!/usr/bin/env node
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
  "dist",
  "coverage",
  "node_modules/.tmp",
  "node_modules/.vite",
  "dev-dist",
  "crates/target",
  "crates/engine/pkg",
  "crates/engine/target",
];

for (const rel of targets) {
  const full = path.join(root, rel);
  try {
    rmSync(full, { recursive: true, force: true });
    console.log(`removed ${rel}`);
  } catch {
    // ignore
  }
}

console.log("clean done");

#!/usr/bin/env node
/**
 * Remove generated basemap artifacts. Keeps public/map/v1/README.md.
 *
 * Usage: npm run map:clean
 */
import { existsSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const scratchDirs = ["map-source", "dist-map-tiles"];

for (const rel of scratchDirs) {
  const full = path.join(root, rel);
  if (!existsSync(full)) continue;
  rmSync(full, { recursive: true, force: true });
  console.log(`removed ${rel}/`);
}

const v1 = path.join(root, "public", "map", "v1");
if (existsSync(v1)) {
  /** @param {string} dir */
  function cleanDir(dir) {
    for (const name of readdirSync(dir)) {
      if (name === "README.md" && dir === v1) continue;
      const full = path.join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        cleanDir(full);
        // remove empty dirs (except v1 itself)
        try {
          if (readdirSync(full).length === 0 && full !== v1) {
            rmSync(full, { recursive: true, force: true });
          }
        } catch {
          // ignore
        }
      } else {
        unlinkSync(full);
      }
    }
  }
  cleanDir(v1);
  // prune empty zoom dirs left behind
  for (const name of readdirSync(v1)) {
    if (name === "README.md") continue;
    const full = path.join(v1, name);
    try {
      rmSync(full, { recursive: true, force: true });
      console.log(`removed public/map/v1/${name}/`);
    } catch {
      // ignore
    }
  }
  console.log("kept public/map/v1/README.md");
}

console.log("map:clean done");

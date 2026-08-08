/**
 * WASM hierarchical scorer — production engine path.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEngine } from "@/lib/engine";
import type { ResourceNode } from "@/types";
import { DEFAULT_MINER_SETTINGS, DEFAULT_SCORING_OPTIONS } from "@/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function ore(
  id: string,
  resource: string,
  purity: "impure" | "normal" | "pure",
  x: number,
  y: number,
): ResourceNode {
  return { id, resource, purity, nodeType: "node", x, y, z: 0 };
}

describe("createEngine (WASM score_grid)", () => {
  it("returns grid + top sites + timings", () => {
    const engine = createEngine();
    const result = engine.scoreGrid({
      nodes: [
        ore("i1", "Desc_OreIron_C", "pure", 0, 0),
        ore("i2", "Desc_OreIron_C", "pure", 2000, 0),
        ore("c1", "Desc_OreCopper_C", "pure", 500, 500),
      ],
      demand: [
        { resource: "Desc_OreIron_C", itemsPerMinute: 200 },
        { resource: "Desc_OreCopper_C", itemsPerMinute: 100 },
      ],
      miner: { ...DEFAULT_MINER_SETTINGS, minerMk: 3 },
      scoringMode: "centered",
      options: { ...DEFAULT_SCORING_OPTIONS, topN: 3 },
      bounds: { minX: -5000, maxX: 5000, minY: -5000, maxY: 5000 },
      coarseCols: 8,
      coarseRows: 8,
      refineTopK: 4,
      refineSubdiv: 4,
      caveDeltaZCm: 4000,
    });

    expect(result.grid.scores).toHaveLength(64);
    expect(result.topSites.length).toBeGreaterThan(0);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.timings).toBeDefined();
    const sum =
      result.timings.prepareMs +
      result.timings.coarseMs +
      result.timings.refineMs +
      result.timings.topSitesMs;
    expect(Math.abs(sum - result.elapsedMs)).toBeLessThan(2);
  });

  it("scores real default-nodes water + iron plan under 5s", () => {
    const nodes = JSON.parse(
      readFileSync(join(root, "public/data/nodes/default-nodes.json"), "utf8"),
    ) as ResourceNode[];
    const meta = JSON.parse(readFileSync(join(root, "public/data/meta.json"), "utf8")) as {
      worldBounds: { minX: number; maxX: number; minY: number; maxY: number };
      heatmapDefaults: {
        coarseCols: number;
        coarseRows: number;
        refineTopK: number;
        refineSubdiv: number;
        caveDeltaZCm: number;
      };
    };
    const engine = createEngine();
    const result = engine.scoreGrid({
      nodes,
      demand: [
        { resource: "Desc_OreIron_C", itemsPerMinute: 480 },
        { resource: "Desc_Water_C", itemsPerMinute: 300 },
      ],
      miner: { ...DEFAULT_MINER_SETTINGS },
      scoringMode: "centered",
      options: { ...DEFAULT_SCORING_OPTIONS },
      bounds: meta.worldBounds,
      coarseCols: meta.heatmapDefaults.coarseCols,
      coarseRows: meta.heatmapDefaults.coarseRows,
      refineTopK: meta.heatmapDefaults.refineTopK,
      refineSubdiv: meta.heatmapDefaults.refineSubdiv,
      caveDeltaZCm: meta.heatmapDefaults.caveDeltaZCm,
    });
    expect(result.grid.scores.length).toBe(
      meta.heatmapDefaults.coarseCols * meta.heatmapDefaults.coarseRows,
    );
    expect(result.elapsedMs).toBeLessThan(5000);
    expect(result.topSites.length).toBeGreaterThan(0);
  });
});

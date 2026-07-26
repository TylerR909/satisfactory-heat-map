import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createEngine } from "@/lib/engine";
import { solveProductToRaw } from "@/lib/production/solve";
import type { ItemDef, MapMeta, Recipe, ResourceNode } from "@/types";
import { DEFAULT_SCORING_OPTIONS } from "@/types";

const root = resolve(import.meta.dirname, "../../..");

function loadJson<T>(rel: string): T {
  return JSON.parse(readFileSync(resolve(root, rel), "utf8")) as T;
}

describe("integration with shipped data", () => {
  const nodes = loadJson<ResourceNode[]>("public/data/nodes/default-nodes.json");
  const items = loadJson<Record<string, ItemDef>>("public/data/recipes/items.json");
  const recipes = loadJson<Recipe[]>("public/data/recipes/recipes.json");
  const meta = loadJson<MapMeta>("public/data/meta.json");
  const engine = createEngine();

  it("loads hundreds of nodes", () => {
    expect(nodes.length).toBeGreaterThan(500);
  });

  it("scores Mode A oil/coal/sulfur under Mk2@250% and returns topN sites", () => {
    const result = engine.scoreGrid({
      nodes,
      demand: [
        { resource: "Desc_LiquidOil_C", itemsPerMinute: 600 },
        { resource: "Desc_Coal_C", itemsPerMinute: 300 },
        { resource: "Desc_Sulfur_C", itemsPerMinute: 200 },
      ],
      miner: { minerMk: 2, clockPercent: 250 },
      scoringMode: "centered",
      options: { ...DEFAULT_SCORING_OPTIONS, topN: 5, heatContrast: 1.75 },
      bounds: meta.worldBounds,
      coarseCols: 32,
      coarseRows: 32,
      refineTopK: 8,
      refineSubdiv: 4,
      caveDeltaZCm: meta.heatmapDefaults.caveDeltaZCm,
    });
    expect(result.grid.scores).toHaveLength(32 * 32);
    expect(result.topSites.length).toBe(5);
    expect(result.elapsedMs).toBeLessThan(5000);
    expect(result.topSites.every((s) => s.capacityTag != null)).toBe(true);
    const mid = result.grid.scores.filter((s) => s > 0.15).length;
    expect(mid).toBeGreaterThan(5);
  });

  it("expands HMF and scores Mode B", () => {
    const { demand } = solveProductToRaw("Desc_ModularFrameHeavy_C", 10, recipes, items);
    expect(demand.some((d) => d.resource === "Desc_OreIron_C")).toBe(true);

    const result = engine.scoreGrid({
      nodes,
      demand,
      miner: { minerMk: 3, clockPercent: 100 },
      scoringMode: "weighted",
      options: { ...DEFAULT_SCORING_OPTIONS, topN: 5 },
      bounds: meta.worldBounds,
      coarseCols: 32,
      coarseRows: 32,
      refineTopK: 6,
      refineSubdiv: 4,
      caveDeltaZCm: meta.heatmapDefaults.caveDeltaZCm,
    });
    expect(result.topSites.length).toBeGreaterThanOrEqual(3);
    expect(result.scoredDemand).toEqual(demand);
  });

  it("annotates capacity tags on real-map small limestone demand", () => {
    const result = engine.scoreGrid({
      nodes,
      demand: [{ resource: "Desc_Stone_C", itemsPerMinute: 60 }],
      miner: { minerMk: 2, clockPercent: 250 },
      scoringMode: "centered",
      options: { ...DEFAULT_SCORING_OPTIONS, topN: 5 },
      bounds: meta.worldBounds,
      coarseCols: 24,
      coarseRows: 24,
      refineTopK: 6,
      refineSubdiv: 3,
      caveDeltaZCm: meta.heatmapDefaults.caveDeltaZCm,
    });
    expect(result.topSites.some((s) => s.capacityTag === "abundant")).toBe(true);
    expect(result.topSites.every((s) => s.capacityByResource?.length)).toBeTruthy();
  });
});

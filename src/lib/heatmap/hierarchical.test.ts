import { describe, expect, it } from "vitest";
import { computeHierarchicalHeatmap, pickDiverseSites } from "@/lib/heatmap/hierarchical";
import type { ResourceNode, SiteScore } from "@/types";
import { DEFAULT_SCORING_OPTIONS } from "@/types";

function ore(
  id: string,
  resource: string,
  purity: "impure" | "normal" | "pure",
  x: number,
  y: number,
): ResourceNode {
  return { id, resource, purity, nodeType: "node", x, y, z: 0 };
}

describe("computeHierarchicalHeatmap", () => {
  it("returns a grid and top sites for multi-resource demand", () => {
    const nodes: ResourceNode[] = [
      ore("i1", "Desc_OreIron_C", "pure", 0, 0),
      ore("i2", "Desc_OreIron_C", "pure", 2000, 0),
      ore("i3", "Desc_OreIron_C", "normal", 0, 2000),
      ore("c1", "Desc_OreCopper_C", "pure", 500, 500),
      ore("c2", "Desc_OreCopper_C", "normal", 1500, 500),
      ore("far", "Desc_OreIron_C", "pure", 200000, 200000),
    ];

    const result = computeHierarchicalHeatmap({
      nodes,
      demand: [
        { resource: "Desc_OreIron_C", itemsPerMinute: 400 },
        { resource: "Desc_OreCopper_C", itemsPerMinute: 200 },
      ],
      miner: { minerMk: 3, clockPercent: 100 },
      scoringMode: "centered",
      options: { ...DEFAULT_SCORING_OPTIONS, topN: 5 },
      bounds: { minX: -5000, maxX: 5000, minY: -5000, maxY: 5000 },
      coarseCols: 8,
      coarseRows: 8,
      refineTopK: 4,
      refineSubdiv: 4,
      caveDeltaZCm: 4000,
    });

    expect(result.grid.scores).toHaveLength(64);
    expect(result.topSites.length).toBeGreaterThan(0);
    expect(result.topSites[0].satisfiable).toBe(true);
    expect(result.topSites[0].capacityTag).toBeDefined();
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(Math.hypot(result.topSites[0].x, result.topSites[0].y)).toBeLessThan(50_000);
  });

  it("annotates capacity tags on top sites for small limestone demand", () => {
    const nodes: ResourceNode[] = [
      ore("a-stone", "Desc_Stone_C", "impure", 0, 0),
      ore("b-s1", "Desc_Stone_C", "pure", 100_000, 0),
      ore("b-s2", "Desc_Stone_C", "pure", 100_500, 0),
      ore("b-s3", "Desc_Stone_C", "pure", 101_000, 0),
      ore("b-s4", "Desc_Stone_C", "pure", 101_500, 0),
    ];
    const result = computeHierarchicalHeatmap({
      nodes,
      demand: [{ resource: "Desc_Stone_C", itemsPerMinute: 120 }],
      miner: { minerMk: 2, clockPercent: 250 },
      scoringMode: "centered",
      options: { ...DEFAULT_SCORING_OPTIONS, topN: 5, siteSepFraction: 0.08 },
      bounds: { minX: -5_000, maxX: 120_000, minY: -20_000, maxY: 20_000 },
      coarseCols: 24,
      coarseRows: 8,
      refineTopK: 8,
      refineSubdiv: 3,
      caveDeltaZCm: 4000,
    });

    expect(result.topSites.every((s) => s.capacityTag != null)).toBe(true);
    expect(result.topSites.every((s) => (s.capacityByResource?.length ?? 0) > 0)).toBe(true);
    // Dense hub should dominate ranking for 120/min; expect Abundant there
    expect(result.topSites.some((s) => s.capacityTag === "abundant")).toBe(true);
  });
});

describe("pickDiverseSites", () => {
  const mk = (x: number, y: number, score: number): SiteScore => ({
    x,
    y,
    score,
    satisfiable: true,
    totalHaul: 1,
    byResource: [],
    caveRiskNotes: [],
  });

  it("keeps requested separation instead of stacking to fill topN", () => {
    // Five candidates in a 40-unit line; minSep 25 can only fit ~2
    const candidates = [mk(0, 0, 5), mk(10, 0, 4), mk(20, 0, 3), mk(30, 0, 2), mk(40, 0, 1)];
    const picked = pickDiverseSites(candidates, 5, 25);
    expect(picked.length).toBeLessThan(5);
    expect(picked.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < picked.length; i++) {
      for (let j = i + 1; j < picked.length; j++) {
        const a = picked[i];
        const b = picked[j];
        if (!a || !b) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        // Strict: full requested sep (no relax-to-fill)
        expect(d).toBeGreaterThanOrEqual(25 - 1e-6);
      }
    }
  });

  it("wider minSep returns fewer pins", () => {
    const candidates = [mk(0, 0, 5), mk(30, 0, 4), mk(60, 0, 3), mk(90, 0, 2), mk(120, 0, 1)];
    const tight = pickDiverseSites(candidates, 5, 20);
    const wide = pickDiverseSites(candidates, 5, 70);
    expect(wide.length).toBeLessThan(tight.length);
    expect(tight.length).toBeGreaterThanOrEqual(4);
    expect(wide.length).toBeLessThanOrEqual(2);
  });

  it("fills topN when candidates are already well spaced", () => {
    const candidates = [mk(0, 0, 5), mk(100, 0, 4), mk(200, 0, 3), mk(300, 0, 2), mk(400, 0, 1)];
    const picked = pickDiverseSites(candidates, 5, 50);
    expect(picked).toHaveLength(5);
  });
});

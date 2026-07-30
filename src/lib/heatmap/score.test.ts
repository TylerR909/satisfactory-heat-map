import { describe, expect, it } from "vitest";
import {
  annotateSiteCapacity,
  assignmentCentroid,
  combineHaulCost,
  inferCapacityTag,
  normalizeScoresForDisplay,
  prepareNodes,
  pureNodeExtractRate,
  relocateSiteToAssignment,
  scoreSite,
} from "@/lib/heatmap/score";
import type { ResourceAssignment, ResourceCapacityInfo, ResourceNode } from "@/types";

const miner = { minerMk: 2 as const, clockPercent: 100 };

function node(
  id: string,
  resource: string,
  purity: "impure" | "normal" | "pure",
  x: number,
  y: number,
): ResourceNode {
  return {
    id,
    resource,
    purity,
    nodeType: "node",
    x,
    y,
    z: 0,
  };
}

describe("capacity-aware scoreSite", () => {
  it("marks shortfall when demand exceeds regional capacity", () => {
    const nodes = [node("a", "Desc_OreCopper_C", "impure", 0, 0)];
    const byRes = prepareNodes(nodes, miner, new Set(["Desc_OreCopper_C"]));
    const site = scoreSite(
      100,
      100,
      [{ resource: "Desc_OreCopper_C", itemsPerMinute: 600 }],
      byRes,
      4000,
    );
    expect(site.satisfiable).toBe(false);
    expect(site.byResource[0].shortfall).toBeGreaterThan(500);
  });

  it("is satisfiable when enough nodes nearby under Mk3", () => {
    const mk3 = { minerMk: 3 as const, clockPercent: 100 };
    const nodes = [
      node("a", "Desc_OreCopper_C", "pure", 0, 0),
      node("b", "Desc_OreCopper_C", "pure", 500, 0),
    ];
    const byRes = prepareNodes(nodes, mk3, new Set(["Desc_OreCopper_C"]));
    const site = scoreSite(
      250,
      0,
      [{ resource: "Desc_OreCopper_C", itemsPerMinute: 600 }],
      byRes,
      4000,
    );
    expect(site.satisfiable).toBe(true);
    expect(site.score).toBeGreaterThan(0);
  });

  it("prefers closer nodes for lower haul", () => {
    const mk3 = { minerMk: 3 as const, clockPercent: 100 };
    const nodes = [
      node("far", "Desc_OreIron_C", "pure", 100000, 0),
      node("near", "Desc_OreIron_C", "pure", 1000, 0),
    ];
    const byRes = prepareNodes(nodes, mk3, new Set(["Desc_OreIron_C"]));
    const nearSite = scoreSite(
      0,
      0,
      [{ resource: "Desc_OreIron_C", itemsPerMinute: 200 }],
      byRes,
      4000,
      "centered",
      1.35,
    );
    const farSite = scoreSite(
      200000,
      0,
      [{ resource: "Desc_OreIron_C", itemsPerMinute: 200 }],
      byRes,
      4000,
      "centered",
      1.35,
    );
    expect(nearSite.satisfiable && farSite.satisfiable).toBe(true);
    expect(nearSite.score).toBeGreaterThan(farSite.score);
  });

  it("3D haul penalizes cliffs; flat plateau does not vs same XY", () => {
    const flat = [
      node("a", "Desc_OreIron_C", "pure", 0, 0),
      node("b", "Desc_OreCopper_C", "pure", 10_000, 0),
    ];
    const cliff = [
      node("a", "Desc_OreIron_C", "pure", 0, 0),
      { ...node("b", "Desc_OreCopper_C", "pure", 10_000, 0), z: 20_000 },
    ];
    const demand = [
      { resource: "Desc_OreIron_C", itemsPerMinute: 100 },
      { resource: "Desc_OreCopper_C", itemsPerMinute: 100 },
    ];
    const flatBy = prepareNodes(flat, miner, new Set(demand.map((d) => d.resource)));
    const cliffBy = prepareNodes(cliff, miner, new Set(demand.map((d) => d.resource)));
    const midFlat = scoreSite(5_000, 0, demand, flatBy, 4000, "centered", 1.35, true);
    const midCliff = scoreSite(5_000, 0, demand, cliffBy, 4000, "centered", 1.35, true);
    const midCliff2d = scoreSite(5_000, 0, demand, cliffBy, 4000, "centered", 1.35, false);
    expect(midFlat.score).toBeGreaterThan(midCliff.score);
    // Horizontal-only mode matches flat 3D score on the cliff layout
    expect(midCliff2d.score).toBeCloseTo(midFlat.score, 5);
    expect(midCliff.totalHaul).toBeGreaterThan(midFlat.totalHaul);
  });

  it("does not apply soft % penalties for high absolute Z", () => {
    const high = { ...node("h", "Desc_OreIron_C", "pure", 0, 0), z: 40_000 };
    const low = node("l", "Desc_OreIron_C", "pure", 0, 0);
    const demand = [{ resource: "Desc_OreIron_C", itemsPerMinute: 100 }];
    const highBy = prepareNodes([high], miner, new Set(["Desc_OreIron_C"]));
    const lowBy = prepareNodes([low], miner, new Set(["Desc_OreIron_C"]));
    // Single node at site: median Z = node Z → 3D dist is 0 either way
    const sHigh = scoreSite(0, 0, demand, highBy, 4000, "centered", 1.35, true);
    const sLow = scoreSite(0, 0, demand, lowBy, 4000, "centered", 1.35, true);
    expect(sHigh.score).toBeCloseTo(sLow.score, 5);
    expect(sHigh.caveRiskNotes).toHaveLength(0);
  });

  it("centered sits more between resources than weighted", () => {
    const mk3 = { minerMk: 3 as const, clockPercent: 100 };
    const nodes = [
      node("iron", "Desc_OreIron_C", "pure", 0, 0),
      node("sulfur", "Desc_Sulfur_C", "pure", 100_000, 0),
    ];
    const demand = [
      { resource: "Desc_OreIron_C", itemsPerMinute: 400 },
      { resource: "Desc_Sulfur_C", itemsPerMinute: 100 },
    ];
    const byRes = prepareNodes(nodes, mk3, new Set(["Desc_OreIron_C", "Desc_Sulfur_C"]));

    const nearIron = (mode: "centered" | "weighted", power = 1.35) =>
      scoreSite(10_000, 0, demand, byRes, 4000, mode, power);
    const midpoint = (mode: "centered" | "weighted", power = 1.35) =>
      scoreSite(50_000, 0, demand, byRes, 4000, mode, power);

    expect(nearIron("weighted").score).toBeGreaterThan(midpoint("weighted").score);
    expect(midpoint("centered", 1.5).score).toBeGreaterThan(nearIron("centered", 1.5).score);
  });

  it("softer centerPower reduces cost of uneven mean distances", () => {
    const byResource: ResourceAssignment[] = [
      {
        resource: "a",
        demanded: 100,
        supplied: 100,
        shortfall: 0,
        nodes: [
          {
            nodeId: "1",
            rateUsed: 100,
            dist: 10_000,
            x: 0,
            y: 0,
            z: 0,
            purity: "normal",
            caveRisk: false,
          },
        ],
      },
      {
        resource: "b",
        demanded: 100,
        supplied: 100,
        shortfall: 0,
        nodes: [
          {
            nodeId: "2",
            rateUsed: 100,
            dist: 90_000,
            x: 0,
            y: 0,
            z: 0,
            purity: "normal",
            caveRisk: false,
          },
        ],
      },
    ];
    const soft = combineHaulCost("centered", byResource, 1.1);
    const harsh = combineHaulCost("centered", byResource, 2);
    expect(harsh).toBeGreaterThan(soft);
  });

  it("scales demand proportionally without changing quality at a fixed site", () => {
    const mk3 = { minerMk: 3 as const, clockPercent: 100 };
    const nodes = [node("iron", "Desc_OreIron_C", "pure", 5_000, 0)];
    const byRes = prepareNodes(nodes, mk3, new Set(["Desc_OreIron_C"]));
    const small = scoreSite(
      0,
      0,
      [{ resource: "Desc_OreIron_C", itemsPerMinute: 60 }],
      byRes,
      4000,
      "centered",
    );
    const large = scoreSite(
      0,
      0,
      [{ resource: "Desc_OreIron_C", itemsPerMinute: 400 }],
      byRes,
      4000,
      "centered",
    );
    expect(small.satisfiable && large.satisfiable).toBe(true);
    expect(small.score).toBeCloseTo(large.score, 5);
  });
});

describe("capacity tags from local utilization", () => {
  const mk2 = { minerMk: 2 as const, clockPercent: 250 };

  it("tags Limited when demand eats most of one nearby impure node", () => {
    // Impure Mk2@250% = 120 * 0.5 * 2.5 = 150/min
    const nodes = [node("limestone", "Desc_Stone_C", "impure", 500, 0)];
    const byRes = prepareNodes(nodes, mk2, new Set(["Desc_Stone_C"]));
    const site = scoreSite(0, 0, [{ resource: "Desc_Stone_C", itemsPerMinute: 120 }], byRes, 4000);
    const tagged = annotateSiteCapacity(site, byRes, mk2);
    expect(tagged.satisfiable).toBe(true);
    expect(tagged.capacityTag).toBe("limited");
    expect(tagged.maxUtilization).toBeGreaterThan(0.75);
  });

  it("tags Abundant when small demand sits on a multi-pure hub", () => {
    const nodes = [
      node("i1", "Desc_OreIron_C", "pure", 0, 0),
      node("i2", "Desc_OreIron_C", "pure", 800, 0),
      node("i3", "Desc_OreIron_C", "pure", 1600, 0),
      node("i4", "Desc_OreIron_C", "pure", 2400, 0),
    ];
    const byRes = prepareNodes(nodes, mk2, new Set(["Desc_OreIron_C"]));
    const site = scoreSite(
      1000,
      0,
      [{ resource: "Desc_OreIron_C", itemsPerMinute: 60 }],
      byRes,
      4000,
    );
    const tagged = annotateSiteCapacity(site, byRes, mk2);
    expect(tagged.satisfiable).toBe(true);
    expect(tagged.capacityTag).toBe("abundant");
  });

  it("does not tag Abundant for already-huge demand even with full local cover", () => {
    // Pure oil @250% = 600/min; 4 pures = 2400 local. Demand 2000 uses ~83% → Limited, not Abundant
    const nodes = [
      node("o1", "Desc_LiquidOil_C", "pure", 0, 0),
      node("o2", "Desc_LiquidOil_C", "pure", 500, 0),
      node("o3", "Desc_LiquidOil_C", "pure", 1000, 0),
      node("o4", "Desc_LiquidOil_C", "pure", 1500, 0),
    ];
    const byRes = prepareNodes(nodes, mk2, new Set(["Desc_LiquidOil_C"]));
    const site = scoreSite(
      750,
      0,
      [{ resource: "Desc_LiquidOil_C", itemsPerMinute: 2000 }],
      byRes,
      4000,
    );
    const tagged = annotateSiteCapacity(site, byRes, mk2);
    expect(tagged.satisfiable).toBe(true);
    expect(tagged.capacityTag).not.toBe("abundant");
  });

  it("inferCapacityTag shortfall when unsatisfiable", () => {
    const rows: ResourceCapacityInfo[] = [
      {
        resource: "Desc_OreIron_C",
        demanded: 500,
        localCapacity: 100,
        utilization: 5,
        spare: 0,
      },
    ];
    expect(inferCapacityTag({ satisfiable: false }, rows, mk2).tag).toBe("shortfall");
  });

  it("pureNodeExtractRate respects clock", () => {
    const r100 = pureNodeExtractRate("Desc_OreIron_C", {
      minerMk: 2,
      clockPercent: 100,
    });
    const r250 = pureNodeExtractRate("Desc_OreIron_C", {
      minerMk: 2,
      clockPercent: 250,
    });
    expect(r250).toBeCloseTo(r100 * 2.5, 5);
  });
});

describe("assignmentCentroid / relocateSiteToAssignment", () => {
  it("centered centroid is the mean of per-resource hubs", () => {
    const byResource: ResourceAssignment[] = [
      {
        resource: "Desc_OreIron_C",
        demanded: 100,
        supplied: 100,
        shortfall: 0,
        nodes: [
          {
            nodeId: "i1",
            rateUsed: 100,
            dist: 0,
            x: 0,
            y: 0,
            z: 0,
            purity: "pure",
            caveRisk: false,
          },
        ],
      },
      {
        resource: "Desc_OreCopper_C",
        demanded: 100,
        supplied: 100,
        shortfall: 0,
        nodes: [
          {
            nodeId: "c1",
            rateUsed: 100,
            dist: 0,
            x: 1000,
            y: 0,
            z: 0,
            purity: "pure",
            caveRisk: false,
          },
        ],
      },
    ];
    const c = assignmentCentroid(byResource, "centered");
    expect(c).not.toBeNull();
    if (!c) return;
    expect(c.x).toBeCloseTo(500, 5);
    expect(c.y).toBeCloseTo(0, 5);
  });

  it("pulls an off-coast sample onto the resource hub and improves score", () => {
    // Hub around origin; sample far "north" still assigns the same nodes
    const nodes = [
      node("i1", "Desc_OreIron_C", "pure", 0, 0),
      node("c1", "Desc_OreCopper_C", "pure", 2000, 0),
      node("s1", "Desc_Sulfur_C", "pure", 1000, 1000),
    ];
    const demand = [
      { resource: "Desc_OreIron_C", itemsPerMinute: 100 },
      { resource: "Desc_OreCopper_C", itemsPerMinute: 100 },
      { resource: "Desc_Sulfur_C", itemsPerMinute: 50 },
    ];
    const byRes = prepareNodes(nodes, miner, new Set(demand.map((d) => d.resource)));
    const far = scoreSite(1000, -80_000, demand, byRes, 4000, "centered", 2);
    const moved = relocateSiteToAssignment(far, demand, byRes, 4000, "centered", 2);
    expect(moved.score).toBeGreaterThan(far.score);
    // Should land near the multi-resource midpoint, not stay in open water
    expect(Math.abs(moved.y)).toBeLessThan(5_000);
    expect(moved.x).toBeGreaterThan(0);
    expect(moved.x).toBeLessThan(2_500);
  });
});

describe("normalizeScoresForDisplay", () => {
  // Flat-ish abundant-resource field: one true peak, many middling cells
  const field = [
    1.0, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2,
    0.15, 0.1, 0.05,
  ];

  it("kills most mid-map at default-ish peak emphasis", () => {
    const out = normalizeScoresForDisplay(field, 2.35);
    const lit = out.filter((v) => v > 0.02).length;
    // Only cells near the peak survive — not half this dense synthetic field
    expect(lit).toBeLessThanOrEqual(7);
    expect(lit).toBeLessThan(field.length / 2);
    expect(out[0]).toBeGreaterThan(0.9);
  });

  it("higher peak emphasis paints fewer cells than lower", () => {
    const sparse = normalizeScoresForDisplay(field, 3.2);
    const dense = normalizeScoresForDisplay(field, 1.2);
    const count = (arr: number[]) => arr.filter((v) => v > 0.02).length;
    expect(count(sparse)).toBeLessThan(count(dense));
  });

  it("does not mid-lift: half-peak is cooler than linear would suggest under high contrast", () => {
    // Peak 1.0, half 0.5 — with floor ~0.74 at max emphasis, 0.5 dies entirely
    const out = normalizeScoresForDisplay([1.0, 0.5, 0.2], 3.2);
    expect(out[0]).toBeGreaterThan(0.9);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
  });

  it("keeps zeros as zeros", () => {
    const out = normalizeScoresForDisplay([0, 1, 0], 2.2);
    expect(out[0]).toBe(0);
    expect(out[2]).toBe(0);
    expect(out[1]).toBeGreaterThan(0.9);
  });
});

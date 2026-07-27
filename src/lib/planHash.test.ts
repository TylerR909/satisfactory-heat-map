import { describe, expect, it } from "vitest";
import {
  decodePlanHash,
  encodePlanHash,
  PLAN_HASH_VERSION,
  type PlanHashSource,
} from "@/lib/planHash";
import { DEFAULT_MINER_SETTINGS, DEFAULT_SCORING_OPTIONS } from "@/types";

function sample(partial: Partial<PlanHashSource> = {}): PlanHashSource {
  return {
    mode: "product",
    rawDemand: [
      { id: "a", resource: "Desc_LiquidOil_C", itemsPerMinute: 600 },
      { id: "b", resource: "Desc_Coal_C", itemsPerMinute: 300 },
    ],
    productTargets: [{ id: "p", productId: "Desc_ModularFrameHeavy_C", itemsPerMinute: 10 }],
    miner: { ...DEFAULT_MINER_SETTINGS },
    scoringMode: "centered",
    scoringOptions: { ...DEFAULT_SCORING_OPTIONS },
    seed: null,
    ...partial,
  };
}

describe("planHash compact v1 (computation only)", () => {
  it(`encodes with v${PLAN_HASH_VERSION}. prefix (inline product ClassNames, no allowlist)`, () => {
    const hmfOnly = encodePlanHash(
      sample({
        mode: "product",
        productTargets: [{ id: "p", productId: "Desc_ModularFrameHeavy_C", itemsPerMinute: 10 }],
      }),
    );
    expect(hmfOnly.startsWith(`v${PLAN_HASH_VERSION}.`)).toBe(true);
    // Product ids are stored by name now — still compact enough for share URLs
    expect(hmfOnly.length).toBeLessThanOrEqual(64);
  });

  it("round-trips product mode (active lines only)", () => {
    const src = sample({
      mode: "product",
      scoringMode: "weighted",
      miner: { minerMk: 3, clockPercent: 150 },
      scoringOptions: {
        centerPower: 1.8,
        heatContrast: 2.1, // display-only; not in hash
        topN: 7,
        siteSepFraction: 0.12,
      },
    });
    const decoded = decodePlanHash(`#${encodePlanHash(src)}`);
    expect(decoded).not.toBeNull();
    if (!decoded) return;
    expect(decoded.mode).toBe("product");
    expect(decoded.scoringMode).toBe("weighted");
    expect(decoded.miner).toEqual({ minerMk: 3, clockPercent: 150 });
    expect(decoded.scoringOptions.topN).toBe(7);
    expect(decoded.scoringOptions.centerPower).toBeCloseTo(1.8, 1);
    expect(decoded.scoringOptions.siteSepFraction).toBeCloseTo(0.12, 2);
    // heatContrast is not hashed — decode fills default scoring options for unused fields
    expect(decoded.productTargets[0]?.productId).toBe("Desc_ModularFrameHeavy_C");
    expect(decoded.productTargets[0]?.itemsPerMinute).toBe(10);
    expect(decoded.rawDemand).toHaveLength(0);
  });

  it("does not change hash when only heatContrast differs", () => {
    const a = encodePlanHash(
      sample({
        scoringOptions: { ...DEFAULT_SCORING_OPTIONS, heatContrast: 1.2 },
      }),
    );
    const b = encodePlanHash(
      sample({
        scoringOptions: { ...DEFAULT_SCORING_OPTIONS, heatContrast: 3.1 },
      }),
    );
    expect(a).toBe(b);
  });

  it("omits seed bytes for Default (null) — short hash", () => {
    const def = encodePlanHash(sample({ seed: null }));
    const seeded = encodePlanHash(sample({ seed: 42 }));
    expect(def.length).toBeLessThan(seeded.length);
    const decoded = decodePlanHash(def);
    expect(decoded?.seed).toBeNull();
  });

  it("round-trips seed 0 as randomized (not Default)", () => {
    const src = sample({ seed: 0 });
    const decoded = decodePlanHash(encodePlanHash(src));
    expect(decoded?.seed).toBe(0);
  });

  it("round-trips negative seeds", () => {
    const src = sample({ seed: -12345 });
    const decoded = decodePlanHash(encodePlanHash(src));
    expect(decoded?.seed).toBe(-12345);
  });

  it("round-trips any product ClassName (no allowlist) — e.g. Biochemical Sculptor", () => {
    const src = sample({
      mode: "product",
      productTargets: [{ id: "p", productId: "Desc_SpaceElevatorPart_10_C", itemsPerMinute: 2 }],
    });
    const decoded = decodePlanHash(encodePlanHash(src));
    expect(decoded?.productTargets).toEqual([
      { productId: "Desc_SpaceElevatorPart_10_C", itemsPerMinute: 2 },
    ]);
  });

  it("round-trips arbitrary Desc_*_C product ids not known at compile time", () => {
    const weird = "Desc_TotallyMadeUpFactoryPart_C";
    const src = sample({
      mode: "product",
      productTargets: [{ id: "p", productId: weird, itemsPerMinute: 42 }],
    });
    const decoded = decodePlanHash(encodePlanHash(src));
    expect(decoded?.productTargets[0]?.productId).toBe(weird);
    expect(decoded?.productTargets[0]?.itemsPerMinute).toBe(42);
  });

  it("round-trips zero-rate iron plate blank builds", () => {
    const src = sample({
      mode: "product",
      productTargets: [{ id: "p", productId: "Desc_IronPlate_C", itemsPerMinute: 0 }],
    });
    const decoded = decodePlanHash(encodePlanHash(src));
    expect(decoded?.productTargets[0]?.productId).toBe("Desc_IronPlate_C");
    expect(decoded?.productTargets[0]?.itemsPerMinute).toBe(0);
  });

  it("round-trips raw mode multi-resource demand", () => {
    const src = sample({
      mode: "raw",
      rawDemand: [
        { id: "a", resource: "Desc_LiquidOil_C", itemsPerMinute: 600 },
        { id: "b", resource: "Desc_Coal_C", itemsPerMinute: 300 },
        { id: "c", resource: "Desc_Sulfur_C", itemsPerMinute: 200 },
      ],
    });
    const h = encodePlanHash(src);
    expect(h.length).toBeLessThanOrEqual(48);
    const decoded = decodePlanHash(h);
    expect(decoded).not.toBeNull();
    if (!decoded) return;
    expect(decoded.mode).toBe("raw");
    expect(decoded.rawDemand.map((r) => [r.resource, r.itemsPerMinute])).toEqual([
      ["Desc_LiquidOil_C", 600],
      ["Desc_Coal_C", 300],
      ["Desc_Sulfur_C", 200],
    ]);
  });

  it("returns null for empty / garbage / wrong version", () => {
    expect(decodePlanHash("")).toBeNull();
    expect(decodePlanHash("#")).toBeNull();
    expect(decodePlanHash("#v1.!!!")).toBeNull();
    expect(decodePlanHash("#v9.AAAA")).toBeNull();
  });

  it("skips unencodable product tokens without desyncing count (valid siblings survive)", () => {
    const huge = `Desc_${"X".repeat(200)}_C`; // compact token >> 120 UTF-8 bytes
    const src = sample({
      mode: "product",
      productTargets: [
        { id: "a", productId: "Desc_IronPlate_C", itemsPerMinute: 30 },
        { id: "b", productId: huge, itemsPerMinute: 99 },
        { id: "c", productId: "Desc_Motor_C", itemsPerMinute: 10 },
      ],
    });
    const decoded = decodePlanHash(encodePlanHash(src));
    expect(decoded).not.toBeNull();
    expect(decoded?.productTargets.map((p) => [p.productId, p.itemsPerMinute])).toEqual([
      ["Desc_IronPlate_C", 30],
      ["Desc_Motor_C", 10],
    ]);
  });
});

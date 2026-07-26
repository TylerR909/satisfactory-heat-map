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
    ...partial,
  };
}

describe("planHash compact v1 (computation only)", () => {
  it(`encodes with v${PLAN_HASH_VERSION}. prefix and stays short`, () => {
    const hmfOnly = encodePlanHash(
      sample({
        mode: "product",
        productTargets: [{ id: "p", productId: "Desc_ModularFrameHeavy_C", itemsPerMinute: 10 }],
      }),
    );
    expect(hmfOnly.startsWith(`v${PLAN_HASH_VERSION}.`)).toBe(true);
    expect(hmfOnly.length).toBeLessThanOrEqual(24);
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
});

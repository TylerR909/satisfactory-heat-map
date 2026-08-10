import { describe, expect, it } from "vitest";
import {
  alternateRecipesToOverrides,
  decodePlanHash,
  encodePlanHash,
  encodeProductPlanHash,
  encodeRawPlanHash,
  ITEM_IDS,
  PLAN_HASH_VERSION,
  type PlanHashSource,
  planHashEquals,
  RECIPE_IDS,
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

describe("planHash v1 (indexed catalogs)", () => {
  it(`encodes with v${PLAN_HASH_VERSION}. prefix and stays short for single product`, () => {
    const hmfOnly = encodePlanHash(
      sample({
        mode: "product",
        productTargets: [{ id: "p", productId: "Desc_ModularFrameHeavy_C", itemsPerMinute: 10 }],
      }),
    );
    expect(hmfOnly.startsWith(`v${PLAN_HASH_VERSION}.`)).toBe(true);
    expect(hmfOnly.length).toBeLessThanOrEqual(28);
  });

  it("round-trips product mode (active lines only)", () => {
    const src = sample({
      mode: "product",
      scoringMode: "weighted",
      miner: {
        ...DEFAULT_MINER_SETTINGS,
        minerMk: 3,
        clockPercent: 150,
        oilClockPercent: 100,
        waterClockPercent: 200,
        resourceWellsEnabled: true,
        wellClockPercent: 250,
      },
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
    expect(decoded.miner).toEqual({
      minerMk: 3,
      clockPercent: 150,
      oilClockPercent: 100,
      waterClockPercent: 200,
      resourceWellsEnabled: true,
      wellClockPercent: 250,
    });
    expect(decoded.scoringOptions.topN).toBe(7);
    expect(decoded.scoringOptions.centerPower).toBeCloseTo(1.8, 1);
    expect(decoded.scoringOptions.siteSepFraction).toBeCloseTo(0.12, 2);
    expect(decoded.scoringOptions.includeElevation).toBe(true);
    expect(decoded.productTargets[0]?.productId).toBe("Desc_ModularFrameHeavy_C");
    expect(decoded.productTargets[0]?.itemsPerMinute).toBe(10);
    expect(decoded.rawDemand).toHaveLength(0);
  });

  it("round-trips off-site Water in externalItems (Mode B)", () => {
    const src = sample({
      mode: "product",
      externalItems: ["Desc_Water_C", "Desc_FluidCanister_C"],
    });
    const decoded = decodePlanHash(encodePlanHash(src));
    expect(decoded?.externalItems).toEqual(
      expect.arrayContaining(["Desc_Water_C", "Desc_FluidCanister_C"]),
    );
    expect(decoded?.externalItems).toHaveLength(2);
  });

  it("round-trips includeElevation=false (flat haul flag)", () => {
    const src = sample({
      scoringOptions: { ...DEFAULT_SCORING_OPTIONS, includeElevation: false },
    });
    const decoded = decodePlanHash(encodePlanHash(src));
    expect(decoded?.scoringOptions.includeElevation).toBe(false);
    const withElev = encodePlanHash(
      sample({ scoringOptions: { ...DEFAULT_SCORING_OPTIONS, includeElevation: true } }),
    );
    expect(encodePlanHash(src)).not.toBe(withElev);
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

  it("round-trips catalog products (e.g. Biochemical Sculptor)", () => {
    const src = sample({
      mode: "product",
      productTargets: [{ id: "p", productId: "Desc_SpaceElevatorPart_10_C", itemsPerMinute: 2 }],
    });
    const decoded = decodePlanHash(encodePlanHash(src));
    expect(decoded?.productTargets).toEqual([
      { productId: "Desc_SpaceElevatorPart_10_C", itemsPerMinute: 2 },
    ]);
  });

  it("skips unknown product ids not in the share catalog", () => {
    const weird = "Desc_TotallyMadeUpFactoryPart_C";
    const src = sample({
      mode: "product",
      productTargets: [
        { id: "a", productId: "Desc_IronPlate_C", itemsPerMinute: 30 },
        { id: "b", productId: weird, itemsPerMinute: 99 },
      ],
    });
    const decoded = decodePlanHash(encodePlanHash(src));
    expect(decoded?.productTargets).toEqual([
      { productId: "Desc_IronPlate_C", itemsPerMinute: 30 },
    ]);
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
    expect(h.length).toBeLessThanOrEqual(40);
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
    expect(decodePlanHash("#v2.AAAA")).toBeNull();
    expect(decodePlanHash("#v9.AAAA")).toBeNull();
  });

  it("round-trips external intermediate items (Mode B off-site prune)", () => {
    const src = sample({
      mode: "product",
      productTargets: [{ id: "p", productId: "Desc_Fuel_C", itemsPerMinute: 60 }],
      externalItems: ["Desc_FluidCanister_C", "Desc_GasTank_C"],
    });
    const decoded = decodePlanHash(encodePlanHash(src));
    expect(decoded?.externalItems).toEqual(["Desc_FluidCanister_C", "Desc_GasTank_C"]);
  });

  it("omits external tail when empty (shorter hash)", () => {
    const bare = encodePlanHash(sample({ externalItems: [] }));
    const withExt = encodePlanHash(sample({ externalItems: ["Desc_FluidCanister_C"] }));
    expect(bare.length).toBeLessThan(withExt.length);
    expect(decodePlanHash(bare)?.externalItems).toEqual([]);
  });

  it("round-trips recipeOverrides (Mode B alternate picks) without name bloat", () => {
    const src = sample({
      mode: "product",
      productTargets: [{ id: "p", productId: "Desc_ModularFrameHeavy_C", itemsPerMinute: 10 }],
      recipeOverrides: {
        Desc_IronIngot_C: "Recipe_Alternate_PureIronIngot_C",
        Desc_IronPlateReinforced_C: "Recipe_Alternate_ReinforcedIronPlate_1_C",
      },
    });
    const h = encodePlanHash(src);
    expect(h.length).toBeLessThanOrEqual(48);
    const decoded = decodePlanHash(h);
    expect(decoded?.recipeOverrides).toEqual({
      Desc_IronIngot_C: "Recipe_Alternate_PureIronIngot_C",
      Desc_IronPlateReinforced_C: "Recipe_Alternate_ReinforcedIronPlate_1_C",
    });
  });

  it("omits recipeOverrides tail when empty (shorter hash)", () => {
    const bare = encodePlanHash(sample({ recipeOverrides: {} }));
    const withOv = encodePlanHash(
      sample({
        recipeOverrides: { Desc_IronIngot_C: "Recipe_Alternate_PureIronIngot_C" },
      }),
    );
    expect(bare.length).toBeLessThan(withOv.length);
    expect(decodePlanHash(bare)?.recipeOverrides).toEqual({});
  });

  it("keeps many overrides compact (indexed, not ClassName tokens)", () => {
    const overrides: Record<string, string> = {
      Desc_IronIngot_C: "Recipe_Alternate_PureIronIngot_C",
      Desc_CopperIngot_C: "Recipe_Alternate_PureCopperIngot_C",
      Desc_IronPlate_C: "Recipe_Alternate_CoatedIronPlate_C",
      Desc_IronPlateReinforced_C: "Recipe_Alternate_ReinforcedIronPlate_1_C",
      Desc_SteelIngot_C: "Recipe_Alternate_CokeSteelIngot_C",
      Desc_Rubber_C: "Recipe_Alternate_RecycledRubber_C",
      Desc_LiquidFuel_C: "Recipe_Alternate_DilutedFuel_C",
    };
    const h = encodePlanHash(
      sample({
        productTargets: [{ id: "p", productId: "Desc_ModularFrameHeavy_C", itemsPerMinute: 10 }],
        recipeOverrides: overrides,
      }),
    );
    expect(h.length).toBeLessThanOrEqual(72);
    const decoded = decodePlanHash(h);
    expect(decoded?.recipeOverrides).toEqual(overrides);
  });

  it("omits default extractor extension (shorter than non-default clocks)", () => {
    const def = encodePlanHash(sample());
    const custom = encodePlanHash(
      sample({
        miner: { ...DEFAULT_MINER_SETTINGS, waterClockPercent: 100 },
      }),
    );
    expect(def.length).toBeLessThan(custom.length);
  });
});

describe("interop builders", () => {
  it("encodeRawPlanHash round-trips Mode A demand", () => {
    const h = encodeRawPlanHash([
      { resource: "Desc_OreIron_C", itemsPerMinute: 1200 },
      { resource: "Desc_OreCopper_C", itemsPerMinute: 600 },
    ]);
    expect(h.startsWith("v1.")).toBe(true);
    const d = decodePlanHash(h);
    expect(d?.mode).toBe("raw");
    expect(d?.rawDemand.map((r) => [r.resource, r.itemsPerMinute])).toEqual([
      ["Desc_OreIron_C", 1200],
      ["Desc_OreCopper_C", 600],
    ]);
  });

  it("encodeRawPlanHash is deterministic (Mode A golden)", () => {
    const a = encodeRawPlanHash([
      { resource: "Desc_OreIron_C", itemsPerMinute: 1200 },
      { resource: "Desc_OreCopper_C", itemsPerMinute: 600 },
    ]);
    const b = encodeRawPlanHash([
      { resource: "Desc_OreIron_C", itemsPerMinute: 1200 },
      { resource: "Desc_OreCopper_C", itemsPerMinute: 600 },
    ]);
    expect(a).toBe(b);
    expect(a).toBe("v1.CPpHAwIAsAQBWAI");
  });

  it("encodeRawPlanHash round-trips optional seed", () => {
    const h = encodeRawPlanHash([{ resource: "Desc_Coal_C", itemsPerMinute: 300 }], {
      seed: 42,
    });
    expect(decodePlanHash(h)?.seed).toBe(42);
  });

  it("encodeProductPlanHash maps alternateRecipes via primary product", () => {
    const h = encodeProductPlanHash([{ item: "Desc_ComputerSuper_C", itemsPerMinute: 4 }], {
      alternateRecipes: ["Recipe_Alternate_OCSupercomputer_C"],
    });
    const d = decodePlanHash(h);
    expect(d?.productTargets[0]?.productId).toBe("Desc_ComputerSuper_C");
    expect(d?.productTargets[0]?.itemsPerMinute).toBe(4);
    expect(d?.recipeOverrides.Desc_ComputerSuper_C).toBe("Recipe_Alternate_OCSupercomputer_C");
  });

  it("encodeProductPlanHash: explicit recipeOverrides win over alternateRecipes", () => {
    const h = encodeProductPlanHash([{ item: "Desc_ComputerSuper_C", itemsPerMinute: 4 }], {
      alternateRecipes: ["Recipe_Alternate_OCSupercomputer_C"],
      recipeOverrides: {
        Desc_ComputerSuper_C: "Recipe_Alternate_SuperStateComputer_C",
      },
    });
    expect(decodePlanHash(h)?.recipeOverrides.Desc_ComputerSuper_C).toBe(
      "Recipe_Alternate_SuperStateComputer_C",
    );
  });

  it("alternateRecipesToOverrides uses primary product mapping", () => {
    expect(alternateRecipesToOverrides(["Recipe_Alternate_OCSupercomputer_C"])).toEqual({
      Desc_ComputerSuper_C: "Recipe_Alternate_OCSupercomputer_C",
    });
    expect(alternateRecipesToOverrides(["Recipe_DoesNotExist_C"])).toEqual({});
  });
});

describe("catalogs + stability", () => {
  it("exposes non-empty append-only catalogs within wire limits", () => {
    expect(ITEM_IDS.length).toBeGreaterThan(100);
    expect(ITEM_IDS.length).toBeLessThanOrEqual(256);
    expect(RECIPE_IDS.length).toBeGreaterThan(200);
    expect(RECIPE_IDS.length).toBeLessThanOrEqual(65_535);
    expect(ITEM_IDS).toContain("Desc_ModularFrameHeavy_C");
    expect(RECIPE_IDS).toContain("Recipe_Alternate_OCSupercomputer_C");
  });

  it("showcase HMF defaults stay a stable short golden hash", () => {
    const h = encodePlanHash(
      sample({
        productTargets: [{ id: "p", productId: "Desc_ModularFrameHeavy_C", itemsPerMinute: 10 }],
      }),
    );
    expect(h).toBe("v1.CfpHAxBKCgA");
    expect(h.length).toBe(14);
  });

  it("planHashEquals compares by encoded form", () => {
    const a = sample({ seed: null });
    const b = sample({
      seed: null,
      scoringOptions: { ...DEFAULT_SCORING_OPTIONS, heatContrast: 9 },
    });
    const c = sample({ seed: 1 });
    expect(planHashEquals(a, b)).toBe(true);
    expect(planHashEquals(a, c)).toBe(false);
  });
});

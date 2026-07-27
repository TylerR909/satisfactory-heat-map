import { describe, expect, it } from "vitest";
import { decodePlanHash } from "@/lib/planHash";
import {
  buildSavedPlan,
  planAbbrev,
  planSnapshotFromSaved,
  primaryPlanLabel,
} from "@/lib/savedPlans";
import { DEFAULT_MINER_SETTINGS, DEFAULT_SCORING_OPTIONS } from "@/types";

describe("planAbbrev", () => {
  it("uses first letters for multi-word names", () => {
    expect(planAbbrev("Reinforced Iron Plate")).toBe("RIP");
    expect(planAbbrev("Heavy Modular Frame")).toBe("HMF");
  });

  it("uses a single letter for one-word names", () => {
    expect(planAbbrev("Motor")).toBe("M");
    expect(planAbbrev("Concrete")).toBe("C");
  });
});

describe("primaryPlanLabel", () => {
  it("prefers first product in product mode", () => {
    const { abbrev, title } = primaryPlanLabel({
      mode: "product",
      rawDemand: [],
      productTargets: [
        { id: "1", productId: "Desc_Motor_C", itemsPerMinute: 30 },
        { id: "2", productId: "Desc_IronPlate_C", itemsPerMinute: 10 },
      ],
      items: {
        Desc_Motor_C: { id: "Desc_Motor_C", name: "Motor", raw: false },
        Desc_IronPlate_C: { id: "Desc_IronPlate_C", name: "Iron Plate", raw: false },
      },
      recipes: [],
    });
    expect(title).toBe("Motor");
    expect(abbrev).toBe("M");
  });

  it("uses first raw resource in raw mode", () => {
    const { abbrev, title } = primaryPlanLabel({
      mode: "raw",
      rawDemand: [
        { id: "1", resource: "Desc_OreIron_C", itemsPerMinute: 120 },
        { id: "2", resource: "Desc_Coal_C", itemsPerMinute: 60 },
      ],
      productTargets: [],
      items: {},
      recipes: [],
    });
    expect(title).toBe("Iron Ore");
    expect(abbrev).toBe("IO");
  });

  it("labels zero-rate product builds from the product, not leftover raw seeds", () => {
    const { abbrev, title } = primaryPlanLabel({
      mode: "product",
      rawDemand: [
        { id: "seed-oil", resource: "Desc_LiquidOil_C", itemsPerMinute: 600 },
        { id: "seed-coal", resource: "Desc_Coal_C", itemsPerMinute: 300 },
      ],
      productTargets: [{ id: "1", productId: "Desc_IronPlate_C", itemsPerMinute: 0 }],
      items: {
        Desc_IronPlate_C: { id: "Desc_IronPlate_C", name: "Iron Plate", raw: false },
      },
      recipes: [],
    });
    expect(title).toBe("Iron Plate");
    expect(abbrev).toBe("IP");
  });
});

describe("buildSavedPlan snapshot", () => {
  it("stores a full snapshot so chip restore is not hash-lossy", () => {
    const plan = buildSavedPlan(
      null,
      {
        mode: "product",
        rawDemand: [],
        productTargets: [{ id: "1", productId: "Desc_SpaceElevatorPart_10_C", itemsPerMinute: 2 }],
        miner: { ...DEFAULT_MINER_SETTINGS },
        scoringMode: "centered",
        scoringOptions: { ...DEFAULT_SCORING_OPTIONS },
        seed: null,
      },
      {
        mode: "product",
        rawDemand: [],
        productTargets: [{ id: "1", productId: "Desc_SpaceElevatorPart_10_C", itemsPerMinute: 2 }],
        items: {
          Desc_SpaceElevatorPart_10_C: {
            id: "Desc_SpaceElevatorPart_10_C",
            name: "Biochemical Sculptor",
            raw: false,
          },
        },
        recipes: [],
      },
    );
    expect(plan.abbrev).toBe("BS");
    expect(plan.snapshot.productTargets[0]?.productId).toBe("Desc_SpaceElevatorPart_10_C");
    expect(plan.snapshot.productTargets[0]?.itemsPerMinute).toBe(2);

    const restored = planSnapshotFromSaved(plan, decodePlanHash);
    expect(restored?.productTargets[0]?.productId).toBe("Desc_SpaceElevatorPart_10_C");
    expect(restored?.productTargets[0]?.itemsPerMinute).toBe(2);
  });
});

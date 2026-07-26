import { describe, expect, it } from "vitest";
import { planAbbrev, primaryPlanLabel } from "@/lib/savedPlans";

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

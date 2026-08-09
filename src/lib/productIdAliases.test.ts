import { describe, expect, it } from "vitest";
import { canonicalizeProductId } from "@/lib/productIdAliases";
import { planAbbrev, primaryPlanLabel } from "@/lib/savedPlans";

describe("canonicalizeProductId", () => {
  it("keeps Packaged Turbofuel (Desc_TurboFuel_C) distinct from liquid Turbofuel", () => {
    // Docs: Desc_TurboFuel_C = Packaged Turbofuel; Desc_LiquidTurboFuel_C = Turbofuel
    expect(canonicalizeProductId("Desc_TurboFuel_C")).toBe("Desc_TurboFuel_C");
    expect(canonicalizeProductId("Desc_LiquidTurboFuel_C")).toBe("Desc_LiquidTurboFuel_C");
  });

  it("still maps the lowercase-f typo to liquid Turbofuel", () => {
    expect(canonicalizeProductId("Desc_Turbofuel_C")).toBe("Desc_LiquidTurboFuel_C");
  });
});

describe("Packaged Turbofuel plan chip label", () => {
  it("abbreviates as PT and stays PT after canonicalize (re-select path)", () => {
    const productId = canonicalizeProductId("Desc_TurboFuel_C");
    const { abbrev, title } = primaryPlanLabel({
      mode: "product",
      rawDemand: [],
      productTargets: [{ id: "1", productId, itemsPerMinute: 60 }],
      items: {
        Desc_TurboFuel_C: { id: "Desc_TurboFuel_C", name: "Packaged Turbofuel", raw: false },
        Desc_LiquidTurboFuel_C: {
          id: "Desc_LiquidTurboFuel_C",
          name: "Turbofuel",
          raw: false,
        },
      },
      recipes: [],
      externalItems: ["Desc_FluidCanister_C"],
    });
    expect(title).toBe("Packaged Turbofuel");
    expect(abbrev).toBe("PT");
    expect(planAbbrev("Turbofuel")).toBe("T");
  });
});

import { describe, expect, it } from "vitest";
import { classifyExpansionLink, ingredientInflowPerMin } from "@/lib/production/expansionLinks";
import type { Recipe } from "@/types";

function recipe(
  id: string,
  productId: string,
  productAmt: number,
  ingredients: Array<{ item: string; amount: number }>,
): Recipe {
  return {
    id,
    name: id,
    alternate: false,
    ingredients,
    products: [{ item: productId, amount: productAmt }],
    producedIn: [],
    manufacturingDuration: 1,
  };
}

describe("ingredientInflowPerMin", () => {
  it("scales crafts × ingredient amount", () => {
    // 4/min product, 2 product per craft → 2 crafts/min; 3 ingredient each → 6/min
    const r = recipe("R", "P", 2, [{ item: "H", amount: 3 }]);
    expect(ingredientInflowPerMin(4, r, "P", "H")).toBeCloseTo(6);
  });
});

describe("classifyExpansionLink", () => {
  const hsRecipe = recipe("HS", "HS", 1, [
    { item: "Cu", amount: 1 },
    { item: "Al", amount: 1 },
  ]);
  const rcuRecipe = recipe("RCU", "RCU", 1, [{ item: "HS", amount: 3 }]);
  const csRecipe = recipe("CS", "CS", 1, [{ item: "HS", amount: 4 }]);
  const scRecipe = recipe("SC", "SC", 1, [{ item: "CS", amount: 1 }]);

  it("hover on-site HS: green consumers with ↑ inflow; Cu is a predicate slice", () => {
    const linkRcu = classifyExpansionLink({
      row: { itemId: "RCU", itemsPerMinute: 8, external: false },
      hoveredItemId: "HS",
      hoveredRate: 24,
      hoveredOnSite: true,
      hoveredRecipe: hsRecipe,
      rowRecipe: rcuRecipe,
    });
    // 8 RCU/min × 3 HS = 24 HS/min
    expect(linkRcu.kind).toBe("consumer");
    expect(linkRcu.attributed).toBeCloseTo(24);

    const linkCu = classifyExpansionLink({
      row: { itemId: "Cu", itemsPerMinute: 30, external: false },
      hoveredItemId: "HS",
      hoveredRate: 24,
      hoveredOnSite: true,
      hoveredRecipe: hsRecipe,
      rowRecipe: undefined,
    });
    expect(linkCu.kind).toBe("predicate");
    expect(linkCu.attributed).toBeCloseTo(24); // 24 HS × 1 Cu
  });

  it("hover off-site HS: consumers still light; no Cu/Al predicates", () => {
    const linkRcu = classifyExpansionLink({
      row: { itemId: "RCU", itemsPerMinute: 8, external: false },
      hoveredItemId: "HS",
      hoveredRate: 24,
      hoveredOnSite: false,
      hoveredRecipe: hsRecipe,
      rowRecipe: rcuRecipe,
    });
    expect(linkRcu.kind).toBe("consumer");
    expect(linkRcu.attributed).toBeCloseTo(24);

    const linkCu = classifyExpansionLink({
      row: { itemId: "Cu", itemsPerMinute: 30, external: false },
      hoveredItemId: "HS",
      hoveredRate: 24,
      hoveredOnSite: false,
      hoveredRecipe: hsRecipe,
      rowRecipe: undefined,
    });
    expect(linkCu.kind).toBe("none");
  });

  it("hover Cu: off-site HS is red ghost 0", () => {
    const linkHs = classifyExpansionLink({
      row: { itemId: "HS", itemsPerMinute: 24, external: true },
      hoveredItemId: "Cu",
      hoveredRate: 10,
      hoveredOnSite: true,
      hoveredRecipe: undefined,
      rowRecipe: hsRecipe,
    });
    expect(linkHs.kind).toBe("ghost-consumer");
    expect(linkHs.attributed).toBe(0);
  });

  it("hover off-site CS: Supercomputer is still a green consumer; no HS predicate", () => {
    const linkSc = classifyExpansionLink({
      row: { itemId: "SC", itemsPerMinute: 5, external: false },
      hoveredItemId: "CS",
      hoveredRate: 5,
      hoveredOnSite: false,
      hoveredRecipe: csRecipe,
      rowRecipe: scRecipe,
    });
    expect(linkSc.kind).toBe("consumer");
    expect(linkSc.attributed).toBeCloseTo(5);

    const linkHs = classifyExpansionLink({
      row: { itemId: "HS", itemsPerMinute: 20, external: false },
      hoveredItemId: "CS",
      hoveredRate: 5,
      hoveredOnSite: false,
      hoveredRecipe: csRecipe,
      rowRecipe: hsRecipe,
    });
    expect(linkHs.kind).toBe("none");
  });

  it("hover HS on-site: off-site CS is red ghost 0 (not emerald)", () => {
    const linkCs = classifyExpansionLink({
      row: { itemId: "CS", itemsPerMinute: 5, external: true },
      hoveredItemId: "HS",
      hoveredRate: 24,
      hoveredOnSite: true,
      hoveredRecipe: hsRecipe,
      rowRecipe: csRecipe,
      rowDefaultRecipe: csRecipe,
    });
    expect(linkCs.kind).toBe("ghost-consumer");
    expect(linkCs.attributed).toBe(0);
  });

  it("off-site Computer with Caterium alt: Rubber ghost uses default recipe only", () => {
    // Default Computer: no rubber. Caterium Computer: uses rubber.
    const defaultComputer = recipe("Computer", "Computer", 1, [
      { item: "CircuitBoard", amount: 10 },
      { item: "Cable", amount: 9 },
      { item: "Plastic", amount: 18 },
      { item: "Screw", amount: 52 },
    ]);
    const cateriumComputer = recipe("CateriumComputer", "Computer", 1, [
      { item: "CircuitBoard", amount: 7 },
      { item: "Quickwire", amount: 28 },
      { item: "Rubber", amount: 12 },
    ]);

    // Alt still selected in overrides, but row is off-site → compare default
    const ghostRubber = classifyExpansionLink({
      row: { itemId: "Computer", itemsPerMinute: 10, external: true },
      hoveredItemId: "Rubber",
      hoveredRate: 50,
      hoveredOnSite: true,
      hoveredRecipe: undefined,
      rowRecipe: cateriumComputer,
      rowDefaultRecipe: defaultComputer,
    });
    expect(ghostRubber.kind).toBe("none");

    // Default that did use rubber would still ghost
    const defaultUsesRubber = recipe("RubberComputer", "Computer", 1, [
      { item: "Rubber", amount: 5 },
    ]);
    const ghostIfDefault = classifyExpansionLink({
      row: { itemId: "Computer", itemsPerMinute: 10, external: true },
      hoveredItemId: "Rubber",
      hoveredRate: 50,
      hoveredOnSite: true,
      hoveredRecipe: undefined,
      rowRecipe: cateriumComputer,
      rowDefaultRecipe: defaultUsesRubber,
    });
    expect(ghostIfDefault.kind).toBe("ghost-consumer");
  });
});

import { describe, expect, it } from "vitest";
import { classifyExpansionLink, ingredientInflowPerMin } from "@/lib/production/expansionLinks";
import { sloopOutputMultiplier, solveProductsToRaw } from "@/lib/production/solve";
import type { ItemDef, Recipe } from "@/types";

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

  it("halves inflow when Somersloop doubles output", () => {
    const r = recipe("R", "P", 2, [{ item: "H", amount: 3 }]);
    expect(ingredientInflowPerMin(4, r, "P", "H", 2)).toBeCloseTo(3);
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

  it("slooped hover halves predicate inflow; slooped consumer halves ↑ inflow", () => {
    const linkCu = classifyExpansionLink({
      row: { itemId: "Cu", itemsPerMinute: 30, external: false },
      hoveredItemId: "HS",
      hoveredRate: 24,
      hoveredOnSite: true,
      hoveredRecipe: hsRecipe,
      rowRecipe: undefined,
      hoveredOutputMultiplier: 2,
    });
    expect(linkCu.kind).toBe("predicate");
    expect(linkCu.attributed).toBeCloseTo(12);

    const linkRcu = classifyExpansionLink({
      row: { itemId: "RCU", itemsPerMinute: 8, external: false },
      hoveredItemId: "HS",
      hoveredRate: 24,
      hoveredOnSite: true,
      hoveredRecipe: hsRecipe,
      rowRecipe: rcuRecipe,
      rowOutputMultiplier: 2,
    });
    expect(linkRcu.kind).toBe("consumer");
    expect(linkRcu.attributed).toBeCloseTo(12);
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

describe("hover slices vs slooped expand", () => {
  const items: Record<string, ItemDef> = {
    Desc_OreIron_C: { id: "Desc_OreIron_C", name: "Iron Ore", raw: true },
    Desc_IronIngot_C: { id: "Desc_IronIngot_C", name: "Iron Ingot", raw: false },
    Desc_IronPlate_C: { id: "Desc_IronPlate_C", name: "Iron Plate", raw: false },
  };
  const ingotRecipe: Recipe = {
    id: "Recipe_IronIngot_C",
    name: "Iron Ingot",
    durationSec: 2,
    ingredients: [{ item: "Desc_OreIron_C", amount: 1 }],
    products: [{ item: "Desc_IronIngot_C", amount: 1 }],
    alternate: false,
    producedIn: "Build_SmelterMk1_C",
  };
  const plateRecipe: Recipe = {
    id: "Recipe_IronPlate_C",
    name: "Iron Plate",
    durationSec: 6,
    ingredients: [{ item: "Desc_IronIngot_C", amount: 3 }],
    products: [{ item: "Desc_IronPlate_C", amount: 2 }],
    alternate: false,
    producedIn: "Build_ConstructorMk1_C",
  };
  const recipes = [ingotRecipe, plateRecipe];

  function link(opts: { slooped: string[]; hovered: string; row: string }) {
    const slooped = new Set(opts.slooped);
    const { expansion } = solveProductsToRaw(
      [{ productId: "Desc_IronPlate_C", itemsPerMinute: 60 }],
      recipes,
      items,
      { sloopedItems: slooped },
    );
    const hovered = expansion.find((e) => e.itemId === opts.hovered);
    const row = expansion.find((e) => e.itemId === opts.row);
    expect(hovered).toBeDefined();
    expect(row).toBeDefined();
    const hoveredRecipe =
      opts.hovered === plateRecipe.products[0]?.item ? plateRecipe : ingotRecipe;
    const rowRecipe = opts.row === plateRecipe.products[0]?.item ? plateRecipe : ingotRecipe;
    return {
      hovered,
      row,
      info: classifyExpansionLink({
        row: {
          itemId: row?.itemId ?? "",
          itemsPerMinute: row?.itemsPerMinute ?? 0,
          external: row?.external ?? false,
        },
        hoveredItemId: opts.hovered,
        hoveredRate: hovered?.itemsPerMinute ?? 0,
        hoveredOnSite: !(hovered?.external ?? true),
        hoveredRecipe,
        rowRecipe,
        hoveredOutputMultiplier: sloopOutputMultiplier(opts.hovered, hoveredRecipe, slooped),
        rowOutputMultiplier: sloopOutputMultiplier(opts.row, rowRecipe, slooped),
      }),
    };
  }

  it("slooped plates: hover plates → ingot predicate equals expand ingot rate (45, not 90)", () => {
    const { row, info } = link({
      slooped: ["Desc_IronPlate_C"],
      hovered: "Desc_IronPlate_C",
      row: "Desc_IronIngot_C",
    });
    expect(info.kind).toBe("predicate");
    expect(row?.itemsPerMinute).toBeCloseTo(45);
    expect(info.attributed).toBeCloseTo(45);
  });

  it("slooped plates: hover ingots → plate consumer ↑ equals expand ingot rate", () => {
    const { row, info } = link({
      slooped: ["Desc_IronPlate_C"],
      hovered: "Desc_IronIngot_C",
      row: "Desc_IronPlate_C",
    });
    expect(info.kind).toBe("consumer");
    expect(row?.itemsPerMinute).toBeCloseTo(60);
    expect(info.attributed).toBeCloseTo(45);
  });

  it("slooped ingots only: hover ingots does not half plate consumer inflow", () => {
    // Plates still need 90 ingot/min; slooping the smelter only halves ore.
    const { info } = link({
      slooped: ["Desc_IronIngot_C"],
      hovered: "Desc_IronIngot_C",
      row: "Desc_IronPlate_C",
    });
    expect(info.kind).toBe("consumer");
    expect(info.attributed).toBeCloseTo(90);
  });

  it("slooped ingots only: hover plates → ingot predicate is unslooped 90", () => {
    const { row, info } = link({
      slooped: ["Desc_IronIngot_C"],
      hovered: "Desc_IronPlate_C",
      row: "Desc_IronIngot_C",
    });
    expect(info.kind).toBe("predicate");
    expect(row?.itemsPerMinute).toBeCloseTo(90);
    expect(info.attributed).toBeCloseTo(90);
  });
});

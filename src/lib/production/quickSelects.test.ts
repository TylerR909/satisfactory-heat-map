import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applicableQuickSelects,
  isQuickSelectSelected,
  pureAltByProduct,
  QUICK_SELECTS,
  type QuickSelect,
  type QuickSelectContext,
} from "@/lib/production/quickSelects";
import {
  DEFAULT_EXTERNAL_ITEM_IDS,
  listProductionRecipes,
  solveProductsToRaw,
} from "@/lib/production/solve";
import type { ItemDef, Recipe } from "@/types";

function loadRecipes(): Recipe[] {
  return JSON.parse(
    readFileSync(new URL("../../../public/data/recipes/recipes.json", import.meta.url), "utf8"),
  ) as Recipe[];
}

function loadItems(): Record<string, ItemDef> {
  return JSON.parse(
    readFileSync(new URL("../../../public/data/recipes/items.json", import.meta.url), "utf8"),
  ) as Record<string, ItemDef>;
}

function ctx(
  recipes: Recipe[],
  expansion: string[],
  products: string[] = [],
  items?: Record<string, ItemDef>,
): QuickSelectContext {
  return {
    recipes,
    items: items ?? loadItems(),
    expansionItemIds: new Set(expansion),
    productTargetIds: new Set(products),
  };
}

function quickSelect(id: string): QuickSelect {
  const q = QUICK_SELECTS.find((x) => x.id === id);
  if (!q) throw new Error(`missing quick select ${id}`);
  return q;
}

describe("quickSelects", () => {
  it("lists Pure alts from catalog", () => {
    const recipes = loadRecipes();
    const pure = pureAltByProduct(recipes);
    expect(pure.has("Desc_IronIngot_C")).toBe(true);
    expect(pure.has("Desc_AluminumIngot_C")).toBe(true);
    expect(pure.get("Desc_IronIngot_C")?.id).toMatch(/PureIron/i);
  });

  it("Defaults always applicable and clears", () => {
    const recipes = loadRecipes();
    const c = ctx(recipes, ["Desc_IronIngot_C"]);
    const def = QUICK_SELECTS.find((q) => q.id === "defaults");
    expect(def?.applicable(c)).toBe(true);
    expect(def?.resolve(c)).toEqual({ kind: "clear" });
  });

  it("All Pure only targets in-play products", () => {
    const recipes = loadRecipes();
    const c = ctx(recipes, ["Desc_IronIngot_C", "Desc_Plastic_C"]);
    const q = quickSelect("all-pure");
    expect(q.applicable(c)).toBe(true);
    const r = q.resolve(c);
    expect(r.kind).toBe("merge");
    if (r.kind !== "merge") return;
    expect(r.overrides.Desc_IronIngot_C).toBeDefined();
    expect(r.overrides.Desc_Plastic_C).toBeUndefined();
  });

  it("Sloppy + Pure Al applies full pack when either is in play", () => {
    const recipes = loadRecipes();
    const c = ctx(recipes, ["Desc_AluminumIngot_C"]);
    const q = quickSelect("sloppy-pure-al");
    expect(q.applicable(c)).toBe(true);
    const r = q.resolve(c);
    expect(r.kind).toBe("merge");
    if (r.kind !== "merge") return;
    // Full harmony — including steps not yet on the expand (one-click packs)
    expect(r.overrides.Desc_AluminumIngot_C).toBe("Recipe_PureAluminumIngot_C");
    expect(r.overrides.Desc_AluminaSolution_C).toBe("Recipe_Alternate_SloppyAlumina_C");
  });

  it("Recycled loop wires HOR + Diluted Fuel + Recycled Plastic/Rubber", () => {
    const recipes = loadRecipes();
    const c = ctx(recipes, [
      "Desc_HeavyOilResidue_C",
      "Desc_LiquidFuel_C",
      "Desc_Plastic_C",
      "Desc_Rubber_C",
    ]);
    const q = quickSelect("recycled-loop");
    const r = q.resolve(c);
    expect(r.kind).toBe("merge");
    if (r.kind !== "merge") return;
    expect(r.overrides.Desc_HeavyOilResidue_C).toBe("Recipe_Alternate_HeavyOilResidue_C");
    expect(r.overrides.Desc_LiquidFuel_C).toBe("Recipe_Alternate_DilutedFuel_C");
    expect(r.overrides.Desc_Plastic_C).toBe("Recipe_Alternate_Plastic_1_C");
    expect(r.overrides.Desc_Rubber_C).toBe("Recipe_Alternate_RecycledRubber_C");
  });

  it("Polymer plastics wires Residual Plastic + Residual Rubber", () => {
    const recipes = loadRecipes();
    const c = ctx(recipes, ["Desc_Plastic_C", "Desc_Rubber_C"]);
    const q = quickSelect("polymer-plastics");
    expect(q.applicable(c)).toBe(true);
    const r = q.resolve(c);
    expect(r.kind).toBe("merge");
    if (r.kind !== "merge") return;
    expect(r.overrides.Desc_Plastic_C).toBe("Recipe_ResidualPlastic_C");
    expect(r.overrides.Desc_Rubber_C).toBe("Recipe_ResidualRubber_C");
    expect(r.overrides.Desc_PolymerResin_C).toBe("Recipe_Alternate_PolymerResin_C");
    // Residual must not be the catalog default — otherwise the diamond never lights
    expect(listProductionRecipes(recipes, "Desc_Plastic_C")[0]?.id).toBe("Recipe_Plastic_C");
    expect(listProductionRecipes(recipes, "Desc_Rubber_C")[0]?.id).toBe("Recipe_Rubber_C");
  });

  it("No Screws picks screw-free alts for RIP / HMF when in play", () => {
    const recipes = loadRecipes();
    const c = ctx(recipes, ["Desc_IronPlateReinforced_C", "Desc_ModularFrameHeavy_C"]);
    const q = quickSelect("no-screws");
    expect(q.applicable(c)).toBe(true);
    const r = q.resolve(c);
    expect(r.kind).toBe("merge");
    if (r.kind !== "merge") return;
    expect(r.overrides.Desc_IronPlateReinforced_C).toBeDefined();
    expect(r.overrides.Desc_ModularFrameHeavy_C).toBeDefined();
    // Does not rewrite products whose default never used screws
    expect(r.overrides.Desc_IronPlate_C).toBeUndefined();
    expect(r.overrides.Desc_IronIngot_C).toBeUndefined();
    // Chosen alts must not use screws
    for (const rid of Object.values(r.overrides)) {
      const rec = recipes.find((x) => x.id === rid);
      expect(rec).toBeDefined();
      if (!rec) continue;
      expect(rec.ingredients.some((i) => i.item === "Desc_IronScrew_C")).toBe(false);
    }
  });

  it("No Screws stays Selected after apply on HMF expand", () => {
    const recipes = loadRecipes();
    const items = loadItems();
    const targets = [{ productId: "Desc_ModularFrameHeavy_C", itemsPerMinute: 10 }];
    const { expansion } = solveProductsToRaw(targets, recipes, items, {
      externalItems: [...DEFAULT_EXTERNAL_ITEM_IDS],
    });
    const c0: QuickSelectContext = {
      recipes,
      items,
      expansionItemIds: new Set(expansion.map((e) => e.itemId)),
      productTargetIds: new Set(["Desc_ModularFrameHeavy_C"]),
      productTargets: targets,
      externalItems: [...DEFAULT_EXTERNAL_ITEM_IDS],
    };
    const q = quickSelect("no-screws");
    const r = q.resolve(c0);
    expect(r.kind).toBe("merge");
    if (r.kind !== "merge") return;
    const overrides = r.overrides;
    // Re-expand as the app would after apply
    const after = solveProductsToRaw(targets, recipes, items, {
      externalItems: [...DEFAULT_EXTERNAL_ITEM_IDS],
      recipeOverrides: overrides,
    });
    const c1: QuickSelectContext = {
      recipes,
      items,
      expansionItemIds: new Set(after.expansion.map((e) => e.itemId)),
      productTargetIds: new Set(["Desc_ModularFrameHeavy_C"]),
      productTargets: targets,
      externalItems: [...DEFAULT_EXTERNAL_ITEM_IDS],
    };
    expect(isQuickSelectSelected(q, c1, overrides)).toBe(true);
  });

  it("applicableQuickSelects pins Defaults, All Pure, No Screws first", () => {
    const recipes = loadRecipes();
    const list = applicableQuickSelects(
      ctx(recipes, ["Desc_IronIngot_C", "Desc_IronPlateReinforced_C", "Desc_Plastic_C"]),
    );
    expect(list[0]?.id).toBe("defaults");
    const ids = list.map((q) => q.id);
    expect(ids.indexOf("defaults")).toBeLessThan(ids.indexOf("all-pure"));
    expect(ids.indexOf("all-pure")).toBeLessThan(ids.indexOf("no-screws"));
    // Packs come after pinned trio
    if (ids.includes("recycled-loop")) {
      expect(ids.indexOf("no-screws")).toBeLessThan(ids.indexOf("recycled-loop"));
    }
  });

  it("Resource Efficient quick-select picks Solid Steel over Coke/Compacted", () => {
    const recipes = loadRecipes();
    const items = loadItems();
    const c = ctx(recipes, ["Desc_SteelIngot_C"], [], items);
    const q = quickSelect("resource-efficient");
    expect(q.applicable(c)).toBe(true);
    const r = q.resolve(c);
    expect(r.kind).toBe("merge");
    if (r.kind !== "merge") return;
    // Solid Steel is same raw set + savings; Coke/Compacted introduce oil/sulfur
    expect(r.overrides.Desc_SteelIngot_C).toBe("Recipe_Alternate_IngotSteel_1_C");
  });

  it("Caterium computers wires Computer + Circuit Board + Fused Quickwire", () => {
    const recipes = loadRecipes();
    const c = ctx(recipes, ["Desc_Computer_C", "Desc_CircuitBoard_C", "Desc_HighSpeedWire_C"]);
    const q = quickSelect("caterium-computers");
    expect(q.applicable(c)).toBe(true);
    const r = q.resolve(c);
    expect(r.kind).toBe("merge");
    if (r.kind !== "merge") return;
    expect(r.overrides.Desc_Computer_C).toBe("Recipe_Alternate_Computer_1_C");
    expect(r.overrides.Desc_CircuitBoard_C).toBe("Recipe_Alternate_CircuitBoard_2_C");
    expect(r.overrides.Desc_HighSpeedWire_C).toBe("Recipe_Alternate_Quickwire_C");
  });

  it("Caterium computers sets Quickwire even when only Computer is in play (one click)", () => {
    const recipes = loadRecipes();
    const items = loadItems();
    // Adaptive Control Unit default expand has Computer + Circuit Board, not Quickwire yet
    const targets = [{ productId: "Desc_SpaceElevatorPart_5_C", itemsPerMinute: 5 }];
    const base = solveProductsToRaw(targets, recipes, items, {
      externalItems: [...DEFAULT_EXTERNAL_ITEM_IDS],
    });
    expect(base.expansion.some((e) => e.itemId === "Desc_Computer_C")).toBe(true);
    expect(base.expansion.some((e) => e.itemId === "Desc_HighSpeedWire_C")).toBe(false);

    const c: QuickSelectContext = {
      recipes,
      items,
      expansionItemIds: new Set(base.expansion.map((e) => e.itemId)),
      productTargetIds: new Set(["Desc_SpaceElevatorPart_5_C"]),
      productTargets: targets,
      externalItems: [...DEFAULT_EXTERNAL_ITEM_IDS],
    };
    const q = quickSelect("caterium-computers");
    const r = q.resolve(c);
    expect(r.kind).toBe("merge");
    if (r.kind !== "merge") return;
    // Full pack in one resolve — including Quickwire not yet on the expand
    expect(r.overrides.Desc_Computer_C).toBe("Recipe_Alternate_Computer_1_C");
    expect(r.overrides.Desc_CircuitBoard_C).toBe("Recipe_Alternate_CircuitBoard_2_C");
    expect(r.overrides.Desc_HighSpeedWire_C).toBe("Recipe_Alternate_Quickwire_C");

    const after = solveProductsToRaw(targets, recipes, items, {
      externalItems: [...DEFAULT_EXTERNAL_ITEM_IDS],
      recipeOverrides: r.overrides,
    });
    const c1: QuickSelectContext = {
      recipes,
      items,
      expansionItemIds: new Set(after.expansion.map((e) => e.itemId)),
      productTargetIds: new Set(["Desc_SpaceElevatorPart_5_C"]),
      productTargets: targets,
      externalItems: [...DEFAULT_EXTERNAL_ITEM_IDS],
    };
    expect(isQuickSelectSelected(q, c1, r.overrides)).toBe(true);
  });

  it("isQuickSelectSelected: Defaults when no in-play overrides", () => {
    const recipes = loadRecipes();
    const c = ctx(recipes, ["Desc_IronIngot_C", "Desc_Plastic_C"]);
    const def = quickSelect("defaults");
    expect(isQuickSelectSelected(def, c, {})).toBe(true);
    expect(
      isQuickSelectSelected(def, c, { Desc_IronIngot_C: "Recipe_Alternate_PureIronIngot_C" }),
    ).toBe(false);
  });

  it("isQuickSelectSelected: Pure only when every pure pick is set", () => {
    const recipes = loadRecipes();
    const c = ctx(recipes, ["Desc_IronIngot_C", "Desc_CopperIngot_C"]);
    const q = quickSelect("all-pure");
    const r = q.resolve(c);
    expect(r.kind).toBe("merge");
    if (r.kind !== "merge") return;
    const iron = r.overrides.Desc_IronIngot_C;
    const copper = r.overrides.Desc_CopperIngot_C;
    expect(typeof iron).toBe("string");
    expect(typeof copper).toBe("string");
    if (typeof iron !== "string" || typeof copper !== "string") return;
    expect(isQuickSelectSelected(q, c, {})).toBe(false);
    expect(isQuickSelectSelected(q, c, { Desc_IronIngot_C: iron })).toBe(false);
    expect(
      isQuickSelectSelected(q, c, {
        Desc_IronIngot_C: iron,
        Desc_CopperIngot_C: copper,
      }),
    ).toBe(true);
  });

  it("isQuickSelectSelected: Recycled loop when all in-play steps match", () => {
    const recipes = loadRecipes();
    const c = ctx(recipes, [
      "Desc_HeavyOilResidue_C",
      "Desc_LiquidFuel_C",
      "Desc_Plastic_C",
      "Desc_Rubber_C",
    ]);
    const q = quickSelect("recycled-loop");
    expect(
      isQuickSelectSelected(q, c, {
        Desc_HeavyOilResidue_C: "Recipe_Alternate_HeavyOilResidue_C",
        Desc_LiquidFuel_C: "Recipe_Alternate_DilutedFuel_C",
        Desc_Plastic_C: "Recipe_Alternate_Plastic_1_C",
        Desc_Rubber_C: "Recipe_Alternate_RecycledRubber_C",
      }),
    ).toBe(true);
    // Missing HOR / Diluted Fuel → not selected (no partial)
    expect(
      isQuickSelectSelected(q, c, {
        Desc_Plastic_C: "Recipe_Alternate_Plastic_1_C",
        Desc_Rubber_C: "Recipe_Alternate_RecycledRubber_C",
      }),
    ).toBe(false);
  });

  it("Removes Types is replace-kind and cuts unique raws for Nuke Nobelisk", () => {
    const recipes = loadRecipes();
    const items = loadItems();
    const c: QuickSelectContext = {
      recipes,
      items,
      expansionItemIds: new Set(),
      productTargetIds: new Set(["Desc_NobeliskNuke_C"]),
      productTargets: [{ productId: "Desc_NobeliskNuke_C", itemsPerMinute: 10 }],
    };
    const q = quickSelect("minimize-input-types");
    expect(q.label).toBe("Removes Types");
    expect(q.chip).toEqual({ kind: "badge", badgeKind: "removes", text: "Removes Types" });
    expect(q.applicable(c)).toBe(true);
    const r = q.resolve(c);
    expect(r.kind).toBe("replace");
    if (r.kind !== "replace") return;
    expect(Object.keys(r.overrides).length).toBeGreaterThan(0);
    // Plastic AI Limiter is the classic Copper cut on this tree
    expect(r.overrides.Desc_CircuitBoardHighSpeed_C).toBeDefined();
  });

  it("Removes Types stays Selected when extra RE-style overrides are stacked", () => {
    const recipes = loadRecipes();
    const items = loadItems();
    const c: QuickSelectContext = {
      recipes,
      items,
      expansionItemIds: new Set(),
      productTargetIds: new Set(["Desc_NobeliskNuke_C"]),
      productTargets: [{ productId: "Desc_NobeliskNuke_C", itemsPerMinute: 10 }],
    };
    const q = quickSelect("minimize-input-types");
    const r = q.resolve(c);
    expect(r.kind).toBe("replace");
    if (r.kind !== "replace") return;
    // Extra Pure Copper (Resource Efficient often stacks this) must not deselect
    const stacked = {
      ...r.overrides,
      Desc_CopperIngot_C: "Recipe_Alternate_PureCopperIngot_C",
    };
    expect(isQuickSelectSelected(q, c, stacked)).toBe(true);
    // Overwriting a pack pick does deselect
    const firstKey = Object.keys(r.overrides)[0];
    if (firstKey) {
      const broken = { ...r.overrides, [firstKey]: "Recipe_DoesNotExist_C" };
      expect(isQuickSelectSelected(q, c, broken)).toBe(false);
    }
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applicableQuickSelects,
  pureAltByProduct,
  QUICK_SELECTS,
  type QuickSelect,
  type QuickSelectContext,
} from "@/lib/production/quickSelects";
import { listProductionRecipes } from "@/lib/production/solve";
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

  it("Sloppy + Pure Al applies both when either is in play", () => {
    const recipes = loadRecipes();
    const c = ctx(recipes, ["Desc_AluminumIngot_C"]);
    const q = quickSelect("sloppy-pure-al");
    expect(q.applicable(c)).toBe(true);
    const r = q.resolve(c);
    expect(r.kind).toBe("merge");
    if (r.kind !== "merge") return;
    // Only in-play products get overrides
    expect(r.overrides.Desc_AluminumIngot_C).toBe("Recipe_PureAluminumIngot_C");
    expect(r.overrides.Desc_AluminaSolution_C).toBeUndefined();
  });

  it("Recycled loop wires Plastic + Rubber alts", () => {
    const recipes = loadRecipes();
    const c = ctx(recipes, ["Desc_Plastic_C", "Desc_Rubber_C"]);
    const q = quickSelect("recycled-loop");
    const r = q.resolve(c);
    expect(r.kind).toBe("merge");
    if (r.kind !== "merge") return;
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
    // Chosen alts must not use screws
    for (const rid of Object.values(r.overrides)) {
      const rec = recipes.find((x) => x.id === rid);
      expect(rec).toBeDefined();
      if (!rec) continue;
      expect(rec.ingredients.some((i) => i.item === "Desc_IronScrew_C")).toBe(false);
    }
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

  it("Minimize Input Types is replace-kind and cuts unique raws for Nuke Nobelisk", () => {
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
    expect(q.applicable(c)).toBe(true);
    const r = q.resolve(c);
    expect(r.kind).toBe("replace");
    if (r.kind !== "replace") return;
    expect(Object.keys(r.overrides).length).toBeGreaterThan(0);
    // Plastic AI Limiter is the classic Copper cut on this tree
    expect(r.overrides.Desc_CircuitBoardHighSpeed_C).toBeDefined();
  });
});

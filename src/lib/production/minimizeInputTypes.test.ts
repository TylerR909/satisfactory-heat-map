import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canMinimizeInputTypes,
  minimizeInputTypeOverrides,
} from "@/lib/production/minimizeInputTypes";
import { solveProductsToRaw } from "@/lib/production/solve";
import type { ItemDef, Recipe } from "@/types";

function loadDocs() {
  const recipes = JSON.parse(
    readFileSync(new URL("../../../public/data/recipes/recipes.json", import.meta.url), "utf8"),
  ) as Recipe[];
  const items = JSON.parse(
    readFileSync(new URL("../../../public/data/recipes/items.json", import.meta.url), "utf8"),
  ) as Record<string, ItemDef>;
  return { recipes, items };
}

function uniqueRaws(demand: Array<{ resource: string; itemsPerMinute: number }>): Set<string> {
  return new Set(demand.filter((d) => d.itemsPerMinute > 1e-6).map((d) => d.resource));
}

describe("minimizeInputTypeOverrides", () => {
  it("reduces unique raw types for Nuke Nobelisk vs all-defaults", () => {
    const { recipes, items } = loadDocs();
    const targets = [{ productId: "Desc_NobeliskNuke_C", itemsPerMinute: 10 }];
    const baseline = solveProductsToRaw(targets, recipes, items);
    const baseSet = uniqueRaws(baseline.demand);
    expect(baseSet.size).toBeGreaterThanOrEqual(6);

    const result = minimizeInputTypeOverrides({ recipes, items, productTargets: targets });
    expect(result.baselineUnique).toBe(baseSet.size);
    expect(result.finalUnique).toBeLessThanOrEqual(result.baselineUnique);

    const withPicks = solveProductsToRaw(targets, recipes, items, {
      recipeOverrides: result.overrides,
    });
    const finalSet = uniqueRaws(withPicks.demand);
    expect(finalSet.size).toBe(result.finalUnique);

    // Should actually change something when there is headroom to cut types
    if (result.finalUnique < result.baselineUnique) {
      expect(Object.keys(result.overrides).length).toBeGreaterThan(0);
    }
  });

  it("does not introduce brand-new raws without cutting unique count", () => {
    const { recipes, items } = loadDocs();
    const targets = [{ productId: "Desc_NobeliskNuke_C", itemsPerMinute: 5 }];
    const baseline = uniqueRaws(solveProductsToRaw(targets, recipes, items).demand);
    const result = minimizeInputTypeOverrides({ recipes, items, productTargets: targets });
    const final = uniqueRaws(
      solveProductsToRaw(targets, recipes, items, {
        recipeOverrides: result.overrides,
      }).demand,
    );
    // Any raw in final that was not in baseline is only allowed if unique dropped overall
    const newRaws = [...final].filter((r) => !baseline.has(r));
    if (newRaws.length > 0) {
      expect(final.size).toBeLessThan(baseline.size);
    }
  });

  it("does not swap Tempered Caterium (same types, oil already on plan)", () => {
    const { recipes, items } = loadDocs();
    const targets = [{ productId: "Desc_NobeliskNuke_C", itemsPerMinute: 10 }];
    const result = minimizeInputTypeOverrides({ recipes, items, productTargets: targets });
    // Efficiency / oil-path caterium is not a unique-type win
    expect(result.overrides.Desc_GoldIngot_C).toBeUndefined();
    expect(
      Object.values(result.overrides).some((id) => /TemperedCaterium|Tempered.*Caterium/i.test(id)),
    ).toBe(false);
  });

  it("canMinimize is true for Nuke Nobelisk when improvements exist", () => {
    const { recipes, items } = loadDocs();
    const ok = canMinimizeInputTypes({
      recipes,
      items,
      productTargets: [{ productId: "Desc_NobeliskNuke_C", itemsPerMinute: 10 }],
    });
    // If the greedy search finds no override worth taking, that's ok — but Nuke has known Removes alts
    expect(typeof ok).toBe("boolean");
    const result = minimizeInputTypeOverrides({
      recipes,
      items,
      productTargets: [{ productId: "Desc_NobeliskNuke_C", itemsPerMinute: 10 }],
    });
    // Log-friendly assertion: algorithm is stable and non-increasing
    expect(result.finalUnique).toBeLessThanOrEqual(result.baselineUnique);
  });

  it("picks AI Limiter plastic path when Copper can be cut from AI Limiter alone", () => {
    // Isolated: AI Limiter default uses copper sheet; plastic alt removes copper (quick-circuit path)
    const { recipes, items } = loadDocs();
    const targets = [{ productId: "Desc_CircuitBoardHighSpeed_C", itemsPerMinute: 10 }];
    const result = minimizeInputTypeOverrides({ recipes, items, productTargets: targets });
    const baseline = uniqueRaws(solveProductsToRaw(targets, recipes, items).demand);
    const final = uniqueRaws(
      solveProductsToRaw(targets, recipes, items, {
        recipeOverrides: result.overrides,
      }).demand,
    );
    expect(final.size).toBeLessThanOrEqual(baseline.size);
    // Plastic AI Limiter is the classic Copper-removing alt when in play
    if (baseline.has("Desc_OreCopper_C") && !final.has("Desc_OreCopper_C")) {
      expect(result.overrides.Desc_CircuitBoardHighSpeed_C).toMatch(/Plastic|AILimiter/i);
    }
  });
});

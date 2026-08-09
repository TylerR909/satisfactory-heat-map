import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  listAlternateRecipes,
  recipeButtonLabel,
  recipeButtonLabels,
} from "@/lib/production/solve";
import type { Recipe } from "@/types";

function loadRecipes(): Recipe[] {
  return JSON.parse(
    readFileSync(new URL("../../../public/data/recipes/recipes.json", import.meta.url), "utf8"),
  ) as Recipe[];
}

describe("recipeButtonLabel collision handling", () => {
  it("disambiguates Heavy Flexible / Heavy Encased HMF alts", () => {
    const recipes = loadRecipes();
    const alts = listAlternateRecipes(recipes, "Desc_ModularFrameHeavy_C");
    expect(alts.length).toBeGreaterThanOrEqual(2);
    const labels = recipeButtonLabels(alts);
    const vals = [...labels.values()];
    expect(new Set(vals.map((v) => v.toLowerCase())).size).toBe(vals.length);
    // Prefer distinctive words, not both "Heav"
    expect(vals.every((v) => v.toLowerCase() !== "heav")).toBe(true);
    const flex = alts.find((a) => /Flexible/i.test(a.name));
    const enc = alts.find((a) => /Encased/i.test(a.name));
    expect(flex && labels.get(flex.id)).toMatch(/flex/i);
    expect(enc && labels.get(enc.id)).toMatch(/enca/i);
  });

  it("recipeButtonLabel with peers matches group assignment", () => {
    const recipes = loadRecipes();
    const alts = listAlternateRecipes(recipes, "Desc_ModularFrameHeavy_C");
    for (const a of alts) {
      expect(recipeButtonLabel(a, alts)).toBe(recipeButtonLabels(alts).get(a.id));
    }
  });

  it("solo Pure still shortens to Pure", () => {
    const recipes = loadRecipes();
    const pure = recipes.find((r) => r.id === "Recipe_Alternate_PureIronIngot_C");
    expect(pure).toBeDefined();
    if (!pure) return;
    expect(recipeButtonLabel(pure)).toBe("Pure");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { badgeAlternate, compareAlternateToDefault } from "@/lib/production/badges";
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

describe("badgeAlternate (live Docs)", () => {
  it("tags Pure Aluminum Ingot as Pure + Skips Silica / Removes Quartz", () => {
    const { recipes, items } = loadDocs();
    const pure = recipes.find((r) => r.id === "Recipe_PureAluminumIngot_C");
    expect(pure).toBeDefined();
    if (!pure) return;
    const badges = badgeAlternate(pure, recipes, items);
    expect(badges.some((b) => b.kind === "pure")).toBe(true);
    // Crafted intermediate eliminated
    expect(badges.some((b) => b.kind === "skips" && b.itemId === "Desc_Silica_C")).toBe(true);
    // Map raw quartz often drops too
    expect(
      badges.some((b) => b.kind === "removes" && b.itemId === "Desc_RawQuartz_C") ||
        badges.some((b) => b.kind === "skips" && b.itemId === "Desc_Silica_C"),
    ).toBe(true);
  });

  it("tags Copper Alloy Ingot as Alloy", () => {
    const { recipes, items } = loadDocs();
    const alloy = recipes.find((r) => r.id === "Recipe_Alternate_CopperAlloyIngot_C");
    expect(alloy).toBeDefined();
    if (!alloy) return;
    const badges = badgeAlternate(alloy, recipes, items);
    expect(badges.some((b) => b.kind === "alloy")).toBe(true);
  });

  it("tags Pure Iron Ingot as Pure and introduces Water", () => {
    const { recipes, items } = loadDocs();
    const pure = recipes.find((r) => r.id === "Recipe_Alternate_PureIronIngot_C");
    expect(pure).toBeDefined();
    if (!pure) return;
    const result = compareAlternateToDefault(pure, recipes, items);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.badges.some((b) => b.kind === "pure")).toBe(true);
    expect(result.badges.some((b) => b.kind === "introduces" && b.itemId === "Desc_Water_C")).toBe(
      true,
    );
    // Ore savings should register as resource efficient
    expect(result.altRawTotal).toBeLessThan(result.baselineRawTotal);
  });

  it("tags Cast Screws as Skips Iron Rod + Shorter Chain", () => {
    const { recipes, items } = loadDocs();
    const cast = recipes.find((r) => r.id === "Recipe_Alternate_Screw_C");
    expect(cast).toBeDefined();
    if (!cast) return;
    const badges = badgeAlternate(cast, recipes, items);
    expect(badges.some((b) => b.kind === "skips" && b.itemId === "Desc_IronRod_C")).toBe(true);
    expect(badges.some((b) => b.kind === "shorter-chain")).toBe(true);
    // Only the direct default ingredient — not deeper Iron Ingot
    expect(badges.some((b) => b.itemId === "Desc_IronIngot_C")).toBe(false);
  });

  it("does not claim Steel Screws skips Iron Ingot (off-chain path swap)", () => {
    const { recipes, items } = loadDocs();
    const steel = recipes.find((r) => r.id === "Recipe_Alternate_Screw_2_C");
    expect(steel).toBeDefined();
    if (!steel) return;
    const badges = badgeAlternate(steel, recipes, items);
    // Steel Beam is off the iron-rod tree — not a same-chain "Skips Rod" shortcut
    expect(badges.some((b) => b.kind === "skips")).toBe(false);
    expect(badges.some((b) => b.kind === "shorter-chain")).toBe(false);
    expect(badges.some((b) => b.itemId === "Desc_IronIngot_C")).toBe(false);
  });

  it("tags Steel Screws and Bolted RIP as High Throughput", () => {
    const { recipes, items } = loadDocs();
    const steel = recipes.find((r) => r.id === "Recipe_Alternate_Screw_2_C");
    const bolted = recipes.find((r) => r.id === "Recipe_Alternate_ReinforcedIronPlate_1_C");
    expect(steel).toBeDefined();
    expect(bolted).toBeDefined();
    if (!steel || !bolted) return;
    const steelHt = badgeAlternate(steel, recipes, items).find((b) => b.kind === "high-throughput");
    const boltedHt = badgeAlternate(bolted, recipes, items).find(
      (b) => b.kind === "high-throughput",
    );
    expect(steelHt?.score).toBeGreaterThanOrEqual(6);
    expect(boltedHt?.score).toBeGreaterThanOrEqual(2.9);
  });

  it("Solid Steel Ingot is Resource Efficient; Coke/Compacted are not (new raws)", () => {
    const { recipes, items } = loadDocs();
    const solid = recipes.find((r) => r.id === "Recipe_Alternate_IngotSteel_1_C");
    const coke = recipes.find((r) => r.id === "Recipe_Alternate_CokeSteelIngot_C");
    const compact = recipes.find((r) => r.id === "Recipe_Alternate_IngotSteel_2_C");
    expect(solid).toBeDefined();
    expect(coke).toBeDefined();
    expect(compact).toBeDefined();
    if (!solid || !coke || !compact) return;
    expect(badgeAlternate(solid, recipes, items).some((b) => b.kind === "resource-efficient")).toBe(
      true,
    );
    expect(badgeAlternate(coke, recipes, items).some((b) => b.kind === "resource-efficient")).toBe(
      false,
    );
    expect(
      badgeAlternate(compact, recipes, items).some((b) => b.kind === "resource-efficient"),
    ).toBe(false);
  });

  it("OC Supercomputer Adds only unavoidable raws (not Iron/Coal)", () => {
    const { recipes, items } = loadDocs();
    const oc = recipes.find((r) => r.id === "Recipe_Alternate_OCSupercomputer_C");
    expect(oc).toBeDefined();
    if (!oc) return;
    const badges = badgeAlternate(oc, recipes, items);
    const adds = badges.filter((b) => b.kind === "introduces").map((b) => b.itemId);
    // Signature costs of OC path
    expect(adds).toContain("Desc_NitrogenGas_C");
    expect(adds).toContain("Desc_OreBauxite_C");
    // Avoidable with other intermediate alts — must not badge
    expect(adds).not.toContain("Desc_OreIron_C");
    expect(adds).not.toContain("Desc_Coal_C");
  });

  it("tags Crystal Computer as simpler-machine (Assembler vs Manufacturer) from producedIn", () => {
    const { recipes, items } = loadDocs();
    const crystal = recipes.find((r) => r.id === "Recipe_Alternate_Computer_2_C");
    const def = recipes.find((r) => r.id === "Recipe_Computer_C");
    expect(crystal).toBeDefined();
    expect(def).toBeDefined();
    if (!crystal || !def) return;
    expect(def.producedIn).toMatch(/Manufacturer/i);
    expect(crystal.producedIn).toMatch(/Assembler/i);
    const badges = badgeAlternate(crystal, recipes, items);
    const simpler = badges.find((b) => b.kind === "simpler-machine");
    expect(simpler?.label).toBe("Assembler");
    // Same building family (Manufacturer): no machine badge even if inputs differ
    const caterium = recipes.find((r) => r.id === "Recipe_Alternate_Computer_1_C");
    expect(caterium).toBeDefined();
    if (!caterium) return;
    expect(caterium.producedIn).toMatch(/Manufacturer/i);
    expect(
      badgeAlternate(caterium, recipes, items).some(
        (b) =>
          b.kind === "simpler-machine" ||
          b.kind === "heavier-machine" ||
          b.kind === "machine-change",
      ),
    ).toBe(false);
  });

  it("tags Pure Iron as machine-change Refinery (Smelter → OilRefinery)", () => {
    const { recipes, items } = loadDocs();
    const pure = recipes.find((r) => r.id === "Recipe_Alternate_PureIronIngot_C");
    const def = recipes.find((r) => r.id === "Recipe_IngotIron_C");
    expect(pure).toBeDefined();
    expect(def).toBeDefined();
    if (!pure || !def) return;
    expect(def.producedIn).toMatch(/Smelter/i);
    expect(pure.producedIn).toMatch(/OilRefinery/i);
    const badges = badgeAlternate(pure, recipes, items);
    expect(badges.some((b) => b.kind === "pure")).toBe(true);
    const m = badges.find((b) => b.kind === "machine-change");
    expect(m?.label).toBe("Refinery");
  });

  it("tags Copper Alloy as machine-change Foundry (not ingredient-count Assembler)", () => {
    const { recipes, items } = loadDocs();
    const alloy = recipes.find((r) => r.id === "Recipe_Alternate_CopperAlloyIngot_C");
    const def = recipes.find((r) => r.id === "Recipe_IngotCopper_C");
    expect(alloy).toBeDefined();
    expect(def).toBeDefined();
    if (!alloy || !def) return;
    expect(def.producedIn).toMatch(/Smelter/i);
    expect(alloy.producedIn).toMatch(/Foundry/i);
    const badges = badgeAlternate(alloy, recipes, items);
    expect(badges.some((b) => b.kind === "alloy")).toBe(true);
    const m = badges.find((b) => b.kind === "machine-change");
    expect(m?.label).toBe("Foundry");
    // Must not claim Assembler just because there are 2 inputs
    expect(badges.some((b) => b.label === "Assembler")).toBe(false);
  });

  it("does not machine-badge Residual Plastic (same Refinery as crude default)", () => {
    const { recipes, items } = loadDocs();
    const residual = recipes.find((r) => r.id === "Recipe_ResidualPlastic_C");
    const def = recipes.find((r) => r.id === "Recipe_Plastic_C");
    expect(residual).toBeDefined();
    expect(def).toBeDefined();
    if (!residual || !def) return;
    expect(residual.alternate).toBe(false);
    expect(def.producedIn).toMatch(/OilRefinery/i);
    expect(residual.producedIn).toMatch(/OilRefinery/i);
    const badges = badgeAlternate(residual, recipes, items);
    // Comparative badges OK (path change) — but not a false Assembler/machine step-up
    expect(
      badges.some(
        (b) =>
          b.kind === "simpler-machine" ||
          b.kind === "heavier-machine" ||
          b.kind === "machine-change",
      ),
    ).toBe(false);
    expect(badges.some((b) => b.label === "Assembler")).toBe(false);
  });
});

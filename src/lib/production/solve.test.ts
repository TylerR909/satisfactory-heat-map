import { describe, expect, it } from "vitest";
import { solveProductsToRaw, solveProductToRaw } from "@/lib/production/solve";
import type { ItemDef, Recipe } from "@/types";

const items: Record<string, ItemDef> = {
  Desc_OreIron_C: { id: "Desc_OreIron_C", name: "Iron Ore", raw: true },
  Desc_Coal_C: { id: "Desc_Coal_C", name: "Coal", raw: true },
  Desc_IronIngot_C: { id: "Desc_IronIngot_C", name: "Iron Ingot", raw: false },
  Desc_IronPlate_C: { id: "Desc_IronPlate_C", name: "Iron Plate", raw: false },
  Desc_SteelIngot_C: { id: "Desc_SteelIngot_C", name: "Steel Ingot", raw: false },
  Desc_SteelPipe_C: { id: "Desc_SteelPipe_C", name: "Steel Pipe", raw: false },
  Desc_SteelBeam_C: { id: "Desc_SteelBeam_C", name: "Steel Beam", raw: false },
};

const recipes: Recipe[] = [
  {
    id: "Recipe_IronIngot_C",
    name: "Iron Ingot",
    durationSec: 2,
    ingredients: [{ item: "Desc_OreIron_C", amount: 1 }],
    products: [{ item: "Desc_IronIngot_C", amount: 1 }],
    alternate: false,
  },
  {
    id: "Recipe_IronPlate_C",
    name: "Iron Plate",
    durationSec: 6,
    ingredients: [{ item: "Desc_IronIngot_C", amount: 3 }],
    products: [{ item: "Desc_IronPlate_C", amount: 2 }],
    alternate: false,
  },
  {
    id: "Recipe_SteelIngot_C",
    name: "Steel Ingot",
    durationSec: 4,
    ingredients: [
      { item: "Desc_OreIron_C", amount: 3 },
      { item: "Desc_Coal_C", amount: 3 },
    ],
    products: [{ item: "Desc_SteelIngot_C", amount: 3 }],
    alternate: false,
  },
  {
    id: "Recipe_SteelPipe_C",
    name: "Steel Pipe",
    durationSec: 6,
    ingredients: [{ item: "Desc_SteelIngot_C", amount: 3 }],
    products: [{ item: "Desc_SteelPipe_C", amount: 2 }],
    alternate: false,
  },
  {
    id: "Recipe_SteelBeam_C",
    name: "Steel Beam",
    durationSec: 4,
    ingredients: [{ item: "Desc_SteelIngot_C", amount: 4 }],
    products: [{ item: "Desc_SteelBeam_C", amount: 1 }],
    alternate: false,
  },
];

describe("solveProductToRaw", () => {
  it("expands iron plate demand to iron ore", () => {
    const { demand } = solveProductToRaw("Desc_IronPlate_C", 60, recipes, items);
    expect(demand).toHaveLength(1);
    expect(demand[0]?.resource).toBe("Desc_OreIron_C");
    expect(demand[0]?.itemsPerMinute).toBeCloseTo(90, 5);
  });

  it("returns raw as-is", () => {
    const { demand } = solveProductToRaw("Desc_OreIron_C", 120, recipes, items);
    expect(demand[0]?.itemsPerMinute).toBe(120);
  });
});

describe("solveProductsToRaw multi-target stacking", () => {
  it("stacks steel ingots for pipe + beam + extra ingots", () => {
    const { demand, intermediates } = solveProductsToRaw(
      [
        { productId: "Desc_SteelPipe_C", itemsPerMinute: 60 },
        { productId: "Desc_SteelBeam_C", itemsPerMinute: 30 },
        { productId: "Desc_SteelIngot_C", itemsPerMinute: 200 },
      ],
      recipes,
      items,
    );
    expect(intermediates.Desc_SteelIngot_C).toBeCloseTo(410, 5);
    const iron = demand.find((d) => d.resource === "Desc_OreIron_C");
    const coal = demand.find((d) => d.resource === "Desc_Coal_C");
    expect(iron?.itemsPerMinute).toBeCloseTo(410, 5);
    expect(coal?.itemsPerMinute).toBeCloseTo(410, 5);
  });
});

describe("primary product + alt fallback + no fake map raws", () => {
  const chainItems: Record<string, ItemDef> = {
    Desc_OreBauxite_C: { id: "Desc_OreBauxite_C", name: "Bauxite", raw: true },
    Desc_Water_C: { id: "Desc_Water_C", name: "Water", raw: true },
    Desc_Coal_C: { id: "Desc_Coal_C", name: "Coal", raw: true },
    Desc_RawQuartz_C: { id: "Desc_RawQuartz_C", name: "Raw Quartz", raw: true },
    Desc_LiquidOil_C: { id: "Desc_LiquidOil_C", name: "Crude Oil", raw: true },
    Desc_NitrogenGas_C: { id: "Desc_NitrogenGas_C", name: "Nitrogen Gas", raw: true },
    Desc_AluminaSolution_C: {
      id: "Desc_AluminaSolution_C",
      name: "Alumina Solution",
      raw: false,
    },
    Desc_Silica_C: { id: "Desc_Silica_C", name: "Silica", raw: false },
    Desc_AluminumScrap_C: { id: "Desc_AluminumScrap_C", name: "Aluminum Scrap", raw: false },
    Desc_AluminumIngot_C: { id: "Desc_AluminumIngot_C", name: "Aluminum Ingot", raw: false },
    Desc_GasTank_C: { id: "Desc_GasTank_C", name: "Empty Fluid Tank", raw: false },
    Desc_LiquidTurboFuel_C: { id: "Desc_LiquidTurboFuel_C", name: "Turbofuel", raw: false },
    Desc_LiquidFuel_C: { id: "Desc_LiquidFuel_C", name: "Fuel", raw: false },
    Desc_CompactedCoal_C: { id: "Desc_CompactedCoal_C", name: "Compacted Coal", raw: false },
    Desc_RocketFuel_C: { id: "Desc_RocketFuel_C", name: "Rocket Fuel", raw: false },
    Desc_NitricAcid_C: { id: "Desc_NitricAcid_C", name: "Nitric Acid", raw: false },
    Desc_PackagedRocketFuel_C: {
      id: "Desc_PackagedRocketFuel_C",
      name: "Packaged Rocket Fuel",
      raw: false,
    },
    Desc_TurboFuel_C: { id: "Desc_TurboFuel_C", name: "Packaged Turbofuel", raw: false },
    Desc_Sulfur_C: { id: "Desc_Sulfur_C", name: "Sulfur", raw: true },
  };

  const chainRecipes: Recipe[] = [
    // Alumina: primary alumina, byproduct silica — must NOT be silica's default
    {
      id: "Recipe_AluminaSolution_C",
      name: "Alumina Solution",
      durationSec: 6,
      ingredients: [
        { item: "Desc_OreBauxite_C", amount: 12 },
        { item: "Desc_Water_C", amount: 18 },
      ],
      products: [
        { item: "Desc_AluminaSolution_C", amount: 12 },
        { item: "Desc_Silica_C", amount: 5 },
      ],
      alternate: false,
    },
    {
      id: "Recipe_Silica_C",
      name: "Silica",
      durationSec: 8,
      ingredients: [{ item: "Desc_RawQuartz_C", amount: 3 }],
      products: [{ item: "Desc_Silica_C", amount: 5 }],
      alternate: false,
    },
    {
      id: "Recipe_AluminumScrap_C",
      name: "Aluminum Scrap",
      durationSec: 1,
      ingredients: [
        { item: "Desc_AluminaSolution_C", amount: 4 },
        { item: "Desc_Coal_C", amount: 2 },
      ],
      products: [
        { item: "Desc_AluminumScrap_C", amount: 6 },
        { item: "Desc_Water_C", amount: 2 },
      ],
      alternate: false,
    },
    {
      id: "Recipe_IngotAluminum_C",
      name: "Aluminum Ingot",
      durationSec: 4,
      ingredients: [
        { item: "Desc_AluminumScrap_C", amount: 6 },
        { item: "Desc_Silica_C", amount: 5 },
      ],
      products: [{ item: "Desc_AluminumIngot_C", amount: 4 }],
      alternate: false,
    },
    {
      id: "Recipe_GasTank_C",
      name: "Empty Fluid Tank",
      durationSec: 1,
      ingredients: [{ item: "Desc_AluminumIngot_C", amount: 1 }],
      products: [{ item: "Desc_GasTank_C", amount: 1 }],
      alternate: false,
    },
    // Turbofuel: only alts + unpackage (no mainline default)
    {
      id: "Recipe_UnpackageTurboFuel_C",
      name: "Unpackage Turbofuel",
      durationSec: 6,
      ingredients: [{ item: "Desc_TurboFuel_C", amount: 2 }],
      products: [
        { item: "Desc_LiquidTurboFuel_C", amount: 2 },
        { item: "Desc_FluidCanister_C", amount: 2 },
      ],
      alternate: false,
    },
    {
      id: "Recipe_Alternate_Turbofuel_C",
      name: "Alternate: Turbofuel",
      durationSec: 16,
      ingredients: [
        { item: "Desc_LiquidFuel_C", amount: 6 },
        { item: "Desc_CompactedCoal_C", amount: 4 },
      ],
      products: [{ item: "Desc_LiquidTurboFuel_C", amount: 5 }],
      alternate: true,
    },
    {
      id: "Recipe_LiquidFuel_C",
      name: "Fuel",
      durationSec: 6,
      ingredients: [{ item: "Desc_LiquidOil_C", amount: 6 }],
      products: [
        { item: "Desc_LiquidFuel_C", amount: 4 },
        { item: "Desc_PolymerResin_C", amount: 3 },
      ],
      alternate: false,
    },
    {
      id: "Recipe_CompactedCoal_C",
      name: "Compacted Coal",
      durationSec: 12,
      ingredients: [
        { item: "Desc_Coal_C", amount: 5 },
        { item: "Desc_Sulfur_C", amount: 5 },
      ],
      products: [{ item: "Desc_CompactedCoal_C", amount: 5 }],
      alternate: false,
    },
    {
      id: "Recipe_RocketFuel_C",
      name: "Rocket Fuel",
      durationSec: 6,
      ingredients: [
        { item: "Desc_LiquidTurboFuel_C", amount: 6 },
        { item: "Desc_NitricAcid_C", amount: 1 },
      ],
      products: [
        { item: "Desc_RocketFuel_C", amount: 10 },
        { item: "Desc_CompactedCoal_C", amount: 1 },
      ],
      alternate: false,
    },
    // Nitric acid simplified as nitrogen + water for test
    {
      id: "Recipe_NitricAcid_C",
      name: "Nitric Acid",
      durationSec: 3,
      ingredients: [
        { item: "Desc_NitrogenGas_C", amount: 12 },
        { item: "Desc_Water_C", amount: 3 },
        { item: "Desc_OreIron_C", amount: 1 },
      ],
      products: [{ item: "Desc_NitricAcid_C", amount: 3 }],
      alternate: false,
    },
    {
      id: "Recipe_PackagedRocketFuel_C",
      name: "Packaged Rocket Fuel",
      durationSec: 1,
      ingredients: [
        { item: "Desc_RocketFuel_C", amount: 2 },
        { item: "Desc_GasTank_C", amount: 1 },
      ],
      products: [{ item: "Desc_PackagedRocketFuel_C", amount: 1 }],
      alternate: false,
    },
  ];

  // iron ore for nitric
  chainItems.Desc_OreIron_C = { id: "Desc_OreIron_C", name: "Iron Ore", raw: true };
  chainItems.Desc_PolymerResin_C = {
    id: "Desc_PolymerResin_C",
    name: "Polymer Resin",
    raw: false,
  };
  chainItems.Desc_FluidCanister_C = {
    id: "Desc_FluidCanister_C",
    name: "Empty Canister",
    raw: false,
  };

  it("does not use alumina recipe as silica's default (no 4× bauxite)", () => {
    // 150 tanks → 150 ingots → 225 scrap + 187.5 silica
    // scrap → 150 alumina; silica via quartz not alumina
    // alumina 150 → 150 bauxite (not 600)
    const { demand } = solveProductsToRaw(
      [{ productId: "Desc_GasTank_C", itemsPerMinute: 150 }],
      chainRecipes,
      chainItems,
    );
    const baux = demand.find((d) => d.resource === "Desc_OreBauxite_C");
    const quartz = demand.find((d) => d.resource === "Desc_RawQuartz_C");
    expect(baux?.itemsPerMinute).toBeCloseTo(150, 5);
    expect(quartz?.itemsPerMinute).toBeCloseTo(112.5, 5); // 187.5 silica / 5 * 3 quartz
    expect(baux).toBeDefined();
    if (!baux) return;
    expect(baux.itemsPerMinute).toBeLessThan(400);
  });

  it("uses alternate turbofuel instead of dumping LiquidTurboFuel as map raw", () => {
    const { demand, unresolved } = solveProductsToRaw(
      [{ productId: "Desc_PackagedRocketFuel_C", itemsPerMinute: 150 }],
      chainRecipes,
      chainItems,
    );
    // Must not ask the heatmap for liquid turbofuel nodes
    expect(demand.find((d) => d.resource === "Desc_LiquidTurboFuel_C")).toBeUndefined();
    expect(unresolved.find((u) => u.itemId === "Desc_LiquidTurboFuel_C")).toBeUndefined();
    // Should expand through alt turbofuel → fuel + compacted coal → oil/coal/sulfur etc.
    expect(demand.some((d) => d.resource === "Desc_LiquidOil_C")).toBe(true);
    expect(demand.some((d) => d.resource === "Desc_OreBauxite_C")).toBe(true);
  });

  it("never places non-map intermediates on heatmap demand", () => {
    const { demand } = solveProductsToRaw(
      [{ productId: "Desc_PackagedRocketFuel_C", itemsPerMinute: 150 }],
      chainRecipes,
      chainItems,
    );
    for (const d of demand) {
      expect(
        chainItems[d.resource]?.raw ||
          [
            "Desc_OreIron_C",
            "Desc_OreBauxite_C",
            "Desc_Water_C",
            "Desc_Coal_C",
            "Desc_RawQuartz_C",
            "Desc_LiquidOil_C",
            "Desc_NitrogenGas_C",
            "Desc_Sulfur_C",
          ].includes(d.resource),
      ).toBe(true);
    }
  });
});

describe("live Docs recipes (packaged rocket fuel)", () => {
  it("expands 150/min without fake turbofuel raw or 4× bauxite", async () => {
    const { readFileSync } = await import("node:fs");
    const recipes = JSON.parse(
      readFileSync(new URL("../../../public/data/recipes/recipes.json", import.meta.url), "utf8"),
    ) as Recipe[];
    const items = JSON.parse(
      readFileSync(new URL("../../../public/data/recipes/items.json", import.meta.url), "utf8"),
    ) as Record<string, ItemDef>;

    const { demand } = solveProductsToRaw(
      [{ productId: "Desc_PackagedRocketFuel_C", itemsPerMinute: 150 }],
      recipes,
      items,
    );

    expect(demand.find((d) => d.resource === "Desc_LiquidTurboFuel_C")).toBeUndefined();
    const baux = demand.find((d) => d.resource === "Desc_OreBauxite_C");
    expect(baux?.itemsPerMinute).toBeCloseTo(150, 0);
    expect(baux).toBeDefined();
    if (!baux) return;
    expect(baux.itemsPerMinute).toBeLessThan(300);
    // All demand lines are true map raws
    for (const d of demand) {
      expect(items[d.resource]?.raw === true).toBe(true);
    }
  });
});

describe("fluid unit normalization (Docs milliliters → m³)", () => {
  const fluidItems: Record<string, ItemDef> = {
    ...items,
    Desc_Water_C: { id: "Desc_Water_C", name: "Water", raw: true },
    Desc_LiquidOil_C: { id: "Desc_LiquidOil_C", name: "Crude Oil", raw: true },
    Desc_LiquidBiofuel_C: { id: "Desc_LiquidBiofuel_C", name: "Liquid Biofuel", raw: false },
    Desc_PackagedBiofuel_C: {
      id: "Desc_PackagedBiofuel_C",
      name: "Packaged Liquid Biofuel",
      raw: false,
    },
    Desc_Biofuel_C: { id: "Desc_Biofuel_C", name: "Solid Biofuel", raw: false },
    Desc_GenericBiomass_C: { id: "Desc_GenericBiomass_C", name: "Biomass", raw: false },
    Desc_FluidCanister_C: { id: "Desc_FluidCanister_C", name: "Empty Canister", raw: false },
    Desc_Plastic_C: { id: "Desc_Plastic_C", name: "Plastic", raw: false },
    Desc_HeavyOilResidue_C: {
      id: "Desc_HeavyOilResidue_C",
      name: "Heavy Oil Residue",
      raw: false,
    },
    Desc_Leaves_C: { id: "Desc_Leaves_C", name: "Leaves", raw: false },
  };

  const fluidRecipes: Recipe[] = [
    {
      id: "Recipe_PackagedBiofuel_C",
      name: "Packaged Liquid Biofuel",
      durationSec: 3,
      ingredients: [
        { item: "Desc_LiquidBiofuel_C", amount: 2 },
        { item: "Desc_FluidCanister_C", amount: 2 },
      ],
      products: [{ item: "Desc_PackagedBiofuel_C", amount: 2 }],
      alternate: false,
    },
    {
      id: "Recipe_LiquidBiofuel_C",
      name: "Liquid Biofuel",
      durationSec: 4,
      ingredients: [
        { item: "Desc_Biofuel_C", amount: 6 },
        { item: "Desc_Water_C", amount: 3 },
      ],
      products: [{ item: "Desc_LiquidBiofuel_C", amount: 4 }],
      alternate: false,
    },
    {
      id: "Recipe_Biofuel_C",
      name: "Solid Biofuel",
      durationSec: 4,
      ingredients: [{ item: "Desc_GenericBiomass_C", amount: 8 }],
      products: [{ item: "Desc_Biofuel_C", amount: 4 }],
      alternate: false,
    },
    {
      id: "Recipe_Biomass_Leaves_C",
      name: "Biomass (Leaves)",
      durationSec: 5,
      ingredients: [{ item: "Desc_Leaves_C", amount: 10 }],
      products: [{ item: "Desc_GenericBiomass_C", amount: 5 }],
      alternate: false,
    },
    {
      id: "Recipe_Biomass_AlienProtein_C",
      name: "Biomass (Alien Protein)",
      durationSec: 4,
      ingredients: [{ item: "Desc_AlienProtein_C", amount: 1 }],
      products: [{ item: "Desc_GenericBiomass_C", amount: 100 }],
      alternate: false,
    },
    {
      id: "Recipe_FluidCanister_C",
      name: "Empty Canister",
      durationSec: 4,
      ingredients: [{ item: "Desc_Plastic_C", amount: 2 }],
      products: [{ item: "Desc_FluidCanister_C", amount: 4 }],
      alternate: false,
    },
    {
      id: "Recipe_Plastic_C",
      name: "Plastic",
      durationSec: 6,
      ingredients: [{ item: "Desc_LiquidOil_C", amount: 3 }],
      products: [
        { item: "Desc_Plastic_C", amount: 2 },
        { item: "Desc_HeavyOilResidue_C", amount: 1 },
      ],
      alternate: false,
    },
  ];

  it("does not demand 1000× crude/water for packaged liquid biofuel", () => {
    const { demand } = solveProductsToRaw(
      [{ productId: "Desc_PackagedBiofuel_C", itemsPerMinute: 150 }],
      fluidRecipes,
      fluidItems,
    );
    const oil = demand.find((d) => d.resource === "Desc_LiquidOil_C");
    const water = demand.find((d) => d.resource === "Desc_Water_C");
    expect(oil?.itemsPerMinute).toBeCloseTo(112.5, 5);
    expect(water?.itemsPerMinute).toBeCloseTo(112.5, 5);
    expect(oil).toBeDefined();
    expect(water).toBeDefined();
    if (!oil || !water) return;
    expect(oil.itemsPerMinute).toBeLessThan(1000);
    expect(water.itemsPerMinute).toBeLessThan(1000);
  });

  it("prefers leaves biomass over alien-protein biomass as default", () => {
    const { demand, unresolved } = solveProductsToRaw(
      [{ productId: "Desc_GenericBiomass_C", itemsPerMinute: 100 }],
      fluidRecipes,
      {
        ...fluidItems,
        Desc_AlienProtein_C: { id: "Desc_AlienProtein_C", name: "Alien Protein", raw: false },
      },
    );
    // Leaves are not map raws → unresolved sink (not heatmap node demand)
    const leaves = unresolved.find((u) => u.itemId === "Desc_Leaves_C");
    expect(leaves?.itemsPerMinute).toBeCloseTo(200, 5);
    expect(demand.find((d) => d.resource === "Desc_AlienProtein_C")).toBeUndefined();
    expect(unresolved.find((u) => u.itemId === "Desc_AlienProtein_C")).toBeUndefined();
  });
});

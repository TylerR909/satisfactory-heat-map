/** Display names for common resource class names. */
export const RESOURCE_LABELS: Record<string, string> = {
  Desc_OreIron_C: "Iron Ore",
  Desc_OreCopper_C: "Copper Ore",
  Desc_Stone_C: "Limestone",
  Desc_Coal_C: "Coal",
  Desc_OreGold_C: "Caterium Ore",
  Desc_RawQuartz_C: "Raw Quartz",
  Desc_Sulfur_C: "Sulfur",
  Desc_OreBauxite_C: "Bauxite",
  Desc_OreUranium_C: "Uranium",
  Desc_SAM_C: "S.A.M. Ore",
  Desc_LiquidOil_C: "Crude Oil",
  Desc_Water_C: "Water",
  Desc_NitrogenGas_C: "Nitrogen Gas",
  Desc_GeothermalEnergy_C: "Geyser",
};

/** Class name for liquid water (open extractors + resource wells). */
export const WATER_RESOURCE_ID = "Desc_Water_C";

/** Resources typically placed on solid nodes for Mode A picker. */
export const RAW_RESOURCE_OPTIONS = [
  "Desc_OreIron_C",
  "Desc_OreCopper_C",
  "Desc_Stone_C",
  "Desc_Coal_C",
  "Desc_OreGold_C",
  "Desc_RawQuartz_C",
  "Desc_Sulfur_C",
  "Desc_OreBauxite_C",
  "Desc_OreUranium_C",
  "Desc_SAM_C",
  "Desc_LiquidOil_C",
  WATER_RESOURCE_ID,
  "Desc_NitrogenGas_C",
] as const;

/**
 * Human label for a resource / item class name.
 * Prefer explicit map labels, then items catalog `name`, then a spaced fallback.
 */
export function resourceLabel(
  id: string,
  items?: Record<string, { name?: string } | undefined>,
): string {
  if (RESOURCE_LABELS[id]) return RESOURCE_LABELS[id];
  const fromItems = items?.[id]?.name;
  if (fromItems) return fromItems;
  // Desc_LiquidTurboFuel_C → "Liquid Turbo Fuel" (not LiquidTurboFuel)
  const bare = id
    .replace(/^Desc_/, "")
    .replace(/^BP_/, "")
    .replace(/_C$/, "");
  return bare
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

export const RESOURCE_COLORS: Record<string, string> = {
  Desc_OreIron_C: "#94a3b8",
  Desc_OreCopper_C: "#f97316",
  Desc_Stone_C: "#a8a29e",
  Desc_Coal_C: "#475569",
  Desc_OreGold_C: "#eab308",
  Desc_RawQuartz_C: "#e879f9",
  Desc_Sulfur_C: "#facc15",
  Desc_OreBauxite_C: "#c2410c",
  Desc_OreUranium_C: "#22c55e",
  Desc_SAM_C: "#a855f7",
  // Light enough on dark basemap (was #0f172a — invisible)
  Desc_LiquidOil_C: "#a16207",
  Desc_Water_C: "#38bdf8",
  Desc_NitrogenGas_C: "#e2e8f0",
};

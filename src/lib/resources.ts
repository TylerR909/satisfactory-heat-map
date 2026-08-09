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

/** Class name for nitrogen gas (resource wells only — no open-map extractors). */
export const NITROGEN_RESOURCE_ID = "Desc_NitrogenGas_C";

/**
 * Raws that only exist as resource-well satellites in world data.
 * With “Pressurized Resource Wells” off, these cannot be satisfied anywhere.
 */
export const WELL_ONLY_RESOURCE_IDS: readonly string[] = [NITROGEN_RESOURCE_ID];

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

/**
 * Map dot fills — tuned for a dark basemap.
 * Contrasting borders are reserved for selected “draw” endpoints (TopSitesLayer),
 * not ambient demand nodes.
 */
export const RESOURCE_COLORS: Record<string, string> = {
  // Mid slate — readable without washing out on the basemap
  Desc_OreIron_C: "#64748b",
  Desc_OreCopper_C: "#f97316",
  // Light aquamarine — taupe blended into ~80% of the basemap
  Desc_Stone_C: "#5eead4",
  // Dark slate (not pure black — too stark on the map)
  Desc_Coal_C: "#334155",
  // Caterium — pale metallic gold (ingot-like), not copper-orange
  Desc_OreGold_C: "#e8c547",
  Desc_RawQuartz_C: "#e879f9",
  // Brighter lemon — distinct from caterium gold
  Desc_Sulfur_C: "#fde047",
  // Brick — darker than copper orange
  Desc_OreBauxite_C: "#9a3412",
  Desc_OreUranium_C: "#22c55e",
  Desc_SAM_C: "#a855f7",
  // Amber-brown crude (not black)
  Desc_LiquidOil_C: "#b45309",
  Desc_Water_C: "#38bdf8",
  // Cool ice — not iron grey
  Desc_NitrogenGas_C: "#bae6fd",
};

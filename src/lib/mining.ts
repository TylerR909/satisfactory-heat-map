import type { MinerMk, MinerSettings, Purity, ResourceNode } from "@/types";

/** Purity multipliers used by miners, oil extractors, and well satellites. */
export const PURITY_MULT: Record<Purity, number> = {
  impure: 0.5,
  normal: 1,
  pure: 2,
};

/**
 * Miner base items/min at 100% clock on a **normal** solid node.
 * Only applies to solid ore/limestone/etc. nodes and (approx) deposits.
 */
export const MINER_BASE: Record<MinerMk, number> = {
  1: 60,
  2: 120,
  3: 240,
};

/**
 * Oil Extractor on a permanent crude oil *node* (not a resource well).
 * Single building rank — miner Mk does not apply.
 * Rates at 100% clock: impure 60, normal 120, pure 240.
 */
export const OIL_EXTRACTOR_NORMAL_BASE = 120;

/**
 * Water Extractor on open water (no purity). Single rank.
 * Permanent water *wells* use resource-well satellites instead.
 */
export const WATER_EXTRACTOR_BASE = 120;

/**
 * Resource Well Extractor on one satellite (oil / water / nitrogen wells).
 * Requires a pressurizer on the core (core itself has no throughput).
 * Rates at 100% clock: impure 30, normal 60, pure 120.
 */
export const WELL_EXTRACTOR_NORMAL_BASE = 60;

/**
 * Portable miner on a resource *deposit* (finite piles). Not industrial.
 * Approx at “normal” pile: 40/min × purity mult.
 */
export const PORTABLE_MINER_NORMAL_BASE = 40;

const SOLID_ORES = new Set([
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
]);

export function isSolidOre(resource: string): boolean {
  return SOLID_ORES.has(resource);
}

export type ExtractorKind =
  | "miner"
  | "oil_extractor"
  | "water_extractor"
  | "resource_well"
  | "portable_miner"
  | "none";

/** Which building actually produces from this map entity. */
export function extractorKindFor(node: ResourceNode): ExtractorKind {
  if (node.nodeType === "geyser") return "none";
  if (node.nodeType === "frackingCore") return "none";
  if (node.nodeType === "frackingSatellite") return "resource_well";
  if (node.nodeType === "deposit") return "portable_miner";
  if (node.resource === "Desc_LiquidOil_C") return "oil_extractor";
  // Standalone water nodes are rare; treat like water extractor if present
  if (node.resource === "Desc_Water_C") return "water_extractor";
  if (isSolidOre(node.resource) || node.nodeType === "node") return "miner";
  return "none";
}

function withClock(itemsPerMinAt100: number, clockPercent: number): number {
  return itemsPerMinAt100 * (clockPercent / 100);
}

function withPurity(normalBase: number, purity: Purity): number {
  return normalBase * PURITY_MULT[purity];
}

/** UI / scoring overclock range. */
export const CLOCK_PERCENT_MIN = 50;
export const CLOCK_PERCENT_MAX = 250;
/** Preferred marks — soft-snap magnets while dragging (not hard steps). */
export const CLOCK_PERCENT_MARKS = [50, 100, 150, 200, 250] as const;
/** How close (in percentage points) before a drag latches onto a mark. */
export const CLOCK_PERCENT_SNAP_RADIUS = 3;

/** Clamp overclock percent to 50–250% (integer). No forced 50% steps. */
export function clampClockPercent(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.min(CLOCK_PERCENT_MAX, Math.max(CLOCK_PERCENT_MIN, n)));
}

/**
 * Soft magnetic snap: free values along 50–250, but pull to 50% marks when close.
 */
export function softSnapClockPercent(n: number, fallback: number = 100): number {
  const v = clampClockPercent(n, fallback);
  for (const mark of CLOCK_PERCENT_MARKS) {
    if (Math.abs(v - mark) <= CLOCK_PERCENT_SNAP_RADIUS) return mark;
  }
  return v;
}

/**
 * Continuous extract rate (items or m³ per minute) for heatmap capacity scoring.
 *
 * - Solids → Miner Mk.1–3 (user setting) × purity × miner clock
 * - Oil nodes → Oil Extractor × purity × oil clock
 * - Water (open / rare standalone) → Water Extractor × water clock, no purity
 * - Well satellites → Resource Well Extractor × purity × pressurizer clock
 *   (0 when resource wells disabled)
 * - Deposits → portable-miner approximation × miner clock
 * - Well cores / geysers → 0
 */
export function nodeExtractRate(node: ResourceNode, settings: MinerSettings): number {
  const minerClock = settings.clockPercent;
  const kind = extractorKindFor(node);

  switch (kind) {
    case "none":
      return 0;
    case "miner":
      return withClock(withPurity(MINER_BASE[settings.minerMk], node.purity), minerClock);
    case "oil_extractor":
      return withClock(
        withPurity(OIL_EXTRACTOR_NORMAL_BASE, node.purity),
        settings.oilClockPercent ?? minerClock,
      );
    case "water_extractor":
      return withClock(WATER_EXTRACTOR_BASE, settings.waterClockPercent ?? minerClock);
    case "resource_well":
      if (settings.resourceWellsEnabled === false) return 0;
      return withClock(
        withPurity(WELL_EXTRACTOR_NORMAL_BASE, node.purity),
        settings.wellClockPercent ?? minerClock,
      );
    case "portable_miner":
      return withClock(withPurity(PORTABLE_MINER_NORMAL_BASE, node.purity), minerClock);
    default:
      return 0;
  }
}

/** Impure / normal / pure rates at the given clock (for slider readout). */
export function purityRateTriplet(normalBaseAt100: number, clockPercent: number): string {
  const c = clockPercent / 100;
  const impure = formatRate(normalBaseAt100 * PURITY_MULT.impure * c);
  const normal = formatRate(normalBaseAt100 * PURITY_MULT.normal * c);
  const pure = formatRate(normalBaseAt100 * PURITY_MULT.pure * c);
  return `${impure}/${normal}/${pure}/min`;
}

export function minerClockRateLabel(minerMk: MinerMk, clockPercent: number): string {
  return purityRateTriplet(MINER_BASE[minerMk], clockPercent);
}

export function oilClockRateLabel(clockPercent: number): string {
  return purityRateTriplet(OIL_EXTRACTOR_NORMAL_BASE, clockPercent);
}

export function waterClockRateLabel(clockPercent: number): string {
  return `${formatRate(WATER_EXTRACTOR_BASE * (clockPercent / 100))}/min`;
}

export function wellClockRateLabel(clockPercent: number): string {
  return purityRateTriplet(WELL_EXTRACTOR_NORMAL_BASE, clockPercent);
}

/**
 * Format items/min for UI: magnitude-based precision, no trailing zeros
 * (90 not 90.0, 3 not 3.00, 12.5 stays 12.5).
 */
export function formatRate(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const places = Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2;
  const s = n.toFixed(places);
  if (!s.includes(".")) return s;
  return s.replace(/\.?0+$/, "");
}

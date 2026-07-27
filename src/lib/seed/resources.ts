/**
 * Resource descriptors / purity / gameplay tags used by randomization.
 *
 * TypeScript port of Konsl/satisfactory-world-generator `src/game.rs` (relevant enums only, MIT).
 * Copyright (c) 2026 Konsl — see third_party/konsl-satisfactory-world-generator.md
 */

import type { Purity } from "@/types";

/** Resources that participate in node/fracking shuffle (not geysers). */
export const SHUFFLE_RESOURCE_IDS = [
  "Desc_OreIron_C",
  "Desc_Coal_C",
  "Desc_OreCopper_C",
  "Desc_Stone_C",
  "Desc_RawQuartz_C",
  "Desc_LiquidOil_C",
  "Desc_Water_C",
  "Desc_SAM_C",
  "Desc_NitrogenGas_C",
  "Desc_OreBauxite_C",
  "Desc_OreGold_C",
  "Desc_Sulfur_C",
  "Desc_OreUranium_C",
] as const;

export type ShuffleResourceId = (typeof SHUFFLE_RESOURCE_IDS)[number];

export type GameplayTag = "basic" | "advanced" | "fossil_fuel";

/** Impure=1, Normal=2, Pure=4 — matches Konsl ResourcePurity discriminant for throughput math. */
export const PURITY_ORDINAL: Record<Purity, number> = {
  impure: 1,
  normal: 2,
  pure: 4,
};

export function purityFromOrdinal(n: number): Purity {
  if (n >= 4) return "pure";
  if (n >= 2) return "normal";
  return "impure";
}

export function hasGameplayTag(resource: string, tag: GameplayTag): boolean {
  switch (tag) {
    case "basic":
      return (
        resource === "Desc_OreIron_C" ||
        resource === "Desc_Coal_C" ||
        resource === "Desc_OreCopper_C" ||
        resource === "Desc_Stone_C"
      );
    case "advanced":
      return (
        resource === "Desc_RawQuartz_C" ||
        resource === "Desc_SAM_C" ||
        resource === "Desc_OreBauxite_C" ||
        resource === "Desc_OreGold_C" ||
        resource === "Desc_Sulfur_C" ||
        resource === "Desc_OreUranium_C"
      );
    case "fossil_fuel":
      return (
        resource === "Desc_Coal_C" ||
        resource === "Desc_LiquidOil_C" ||
        resource === "Desc_Sulfur_C"
      );
    default:
      return false;
  }
}

/** Resources that have a given tag, sorted by internal name (code-unit order). */
export function resourcesWithTag(tag: GameplayTag): string[] {
  return SHUFFLE_RESOURCE_IDS.filter((r) => hasGameplayTag(r, tag))
    .slice()
    .sort(compareCodeUnit);
}

/** Code-unit lexicographic compare (matches Rust str Ord for ASCII ids). */
export function compareCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function comparePurity(a: Purity | null, b: Purity | null): number {
  const ao = a == null ? -1 : PURITY_ORDINAL[a];
  const bo = b == null ? -1 : PURITY_ORDINAL[b];
  return ao - bo;
}

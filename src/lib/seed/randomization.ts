/**
 * World seed apply — thin wrapper over WASM `apply_map_seed`.
 * Algorithm lives in crates/vendored/konsl_randomization (Konsl MIT).
 */

import { configForSeed, type WorldSeedConfig } from "@/lib/seed/types";
import { requireWasmEngine } from "@/lib/wasm/loadEngine";
import type { ResourceNode } from "@/types";

/**
 * Apply world seed config to fixed base slots.
 * Pure function; does not mutate baseSlots.
 * Requires {@link loadWasmEngine} to have completed.
 */
export function applyWorldSeed(baseSlots: ResourceNode[], config: WorldSeedConfig): ResourceNode[] {
  const wasm = requireWasmEngine();
  // Product policy: none+no_change is default identity; strict+no_change for numeric seeds.
  const isDefault = config.mode === "none" && config.purity === "no_change";
  return wasm.apply_map_seed(baseSlots, config.seed | 0, isDefault);
}

/** Convenience: MapSeed → nodes. */
export function applyMapSeed(baseSlots: ResourceNode[], seed: number | null): ResourceNode[] {
  return applyWorldSeed(baseSlots, configForSeed(seed));
}

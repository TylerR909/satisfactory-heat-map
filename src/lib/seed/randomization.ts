/**
 * World seed apply — thin wrapper over WASM `apply_map_seed_config`.
 * Algorithm lives in crates/vendored/konsl_randomization (Konsl MIT).
 */

import { configForSeed, configForWorld, type WorldSeedConfig } from "@/lib/seed/types";
import { requireWasmEngine } from "@/lib/wasm/loadEngine";
import type { ResourceNode } from "@/types";

/**
 * Apply world seed config to fixed base slots.
 * Pure function; does not mutate baseSlots.
 * Requires {@link loadWasmEngine} to have completed.
 */
export function applyWorldSeed(baseSlots: ResourceNode[], config: WorldSeedConfig): ResourceNode[] {
  const wasm = requireWasmEngine();
  return wasm.apply_map_seed_config(baseSlots, config.seed | 0, config.mode, config.purity);
}

/** Convenience: MapSeed → nodes under the legacy seed-only policy. */
export function applyMapSeed(baseSlots: ResourceNode[], seed: number | null): ResourceNode[] {
  return applyWorldSeed(baseSlots, configForSeed(seed));
}

/** Convenience: full 1.2 triple → nodes. */
export function applyWorldGen(
  baseSlots: ResourceNode[],
  world: { seed: number | null; mode: WorldSeedConfig["mode"]; purity: WorldSeedConfig["purity"] },
): ResourceNode[] {
  return applyWorldSeed(baseSlots, configForWorld(world));
}

/**
 * Memoize world-gen triple → effective nodes so heatmap scoring never re-shuffles.
 */

import { applyWorldSeed } from "@/lib/seed/randomization";
import {
  configForWorld,
  impliedWorldFromSeed,
  type MapSeed,
  type WorldGenSettings,
} from "@/lib/seed/types";
import type { ResourceNode } from "@/types";

let baseRef: ResourceNode[] | null = null;
const cache = new Map<string, ResourceNode[]>();

function cacheKey(world: WorldGenSettings): string {
  const seed = world.seed === null ? "d" : String(world.seed | 0);
  return `${seed}|${world.mode}|${world.purity}`;
}

export function clearNodeSeedCache(): void {
  cache.clear();
  baseRef = null;
}

/**
 * Return effective nodes for a world-gen triple.
 * Recomputes only on cache miss or baseSlots identity change.
 */
export function getNodesForWorld(
  baseSlots: ResourceNode[],
  world: WorldGenSettings,
): ResourceNode[] {
  if (baseRef !== baseSlots) {
    cache.clear();
    baseRef = baseSlots;
  }
  const key = cacheKey(world);
  const hit = cache.get(key);
  if (hit) return hit;

  const nodes = applyWorldSeed(baseSlots, configForWorld(world));
  cache.set(key, nodes);
  return nodes;
}

/** Legacy: seed-only lookup (implies Random + unchanged for numeric seeds). */
export function getNodesForSeed(baseSlots: ResourceNode[], seed: MapSeed): ResourceNode[] {
  return getNodesForWorld(baseSlots, impliedWorldFromSeed(seed));
}

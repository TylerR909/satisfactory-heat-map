/**
 * Memoize seed → effective nodes so heatmap scoring never re-shuffles.
 */

import { applyWorldSeed } from "@/lib/seed/randomization";
import { configForSeed, type MapSeed } from "@/lib/seed/types";
import type { ResourceNode } from "@/types";

let baseRef: ResourceNode[] | null = null;
const cache = new Map<string, ResourceNode[]>();

function cacheKey(seed: MapSeed): string {
  return seed === null ? "default" : `s:${seed}`;
}

export function clearNodeSeedCache(): void {
  cache.clear();
  baseRef = null;
}

/**
 * Return effective nodes for seed. Recomputes only on cache miss or baseSlots identity change.
 */
export function getNodesForSeed(baseSlots: ResourceNode[], seed: MapSeed): ResourceNode[] {
  if (baseRef !== baseSlots) {
    cache.clear();
    baseRef = baseSlots;
  }
  const key = cacheKey(seed);
  const hit = cache.get(key);
  if (hit) return hit;

  const nodes = applyWorldSeed(baseSlots, configForSeed(seed));
  cache.set(key, nodes);
  return nodes;
}

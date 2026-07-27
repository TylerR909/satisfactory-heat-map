/**
 * Satisfactory 1.2+ resource node randomization.
 *
 * TypeScript port of Konsl/satisfactory-world-generator `src/randomization.rs` (MIT).
 * Copyright (c) 2026 Konsl — see third_party/konsl-satisfactory-world-generator.md
 *
 * GPL viewer code (src/app/*) is not used.
 */

import { RandomStream, shuffle } from "@/lib/seed/randomStream";
import {
  compareCodeUnit,
  comparePurity,
  type GameplayTag,
  hasGameplayTag,
  PURITY_ORDINAL,
  resourcesWithTag,
} from "@/lib/seed/resources";
import type { NodePuritySettings, NodeRandomizationMode, WorldSeedConfig } from "@/lib/seed/types";
import {
  type AlgoFrackingCore,
  type AlgoWorld,
  algoWorldToNodes,
  coreThroughput,
  nodesToAlgoWorld,
  sortByName,
} from "@/lib/seed/worldFromNodes";
import type { Purity, ResourceNode } from "@/types";

/** Pool entry: resource + optional purity (nodes) + throughput (fracking cores). */
type ResourceNodeInfo = {
  resource: string;
  purity: Purity | null;
  totalThroughput: number;
};

function compareNodeInfo(a: ResourceNodeInfo, b: ResourceNodeInfo): number {
  const rc = compareCodeUnit(a.resource, b.resource);
  if (rc !== 0) return rc;
  const pc = comparePurity(a.purity, b.purity);
  if (pc !== 0) return pc;
  return a.totalThroughput - b.totalThroughput;
}

function sortNodeInfo(pool: ResourceNodeInfo[]): void {
  pool.sort(compareNodeInfo);
}

export function getPurityOverride(
  rng: RandomStream,
  purity: Purity | null,
  puritySettings: NodePuritySettings,
): Purity | null {
  switch (puritySettings) {
    case "no_change":
      return null;
    case "all_pure":
      return "pure";
    case "all_normal":
      return "normal";
    case "all_impure":
      return "impure";
    case "all_random": {
      const r = rng.frandRange(0, 3) | 0;
      if (r === 0) return "impure";
      if (r === 1) return "normal";
      if (r === 2) return "pure";
      return null;
    }
    case "increase": {
      if (purity == null) return null;
      if (purity === "impure") return "normal";
      return "pure";
    }
    case "decrease": {
      if (purity == null) return null;
      if (purity === "pure") return "normal";
      return "impure";
    }
    default:
      return null;
  }
}

export function modifyNodeDistribution(
  rng: RandomStream,
  nodePool: ResourceNodeInfo[],
  tag: GameplayTag,
  multiplier: number,
): void {
  let matchingNodeCount = nodePool.filter((n) => hasGameplayTag(n.resource, tag)).length;
  const modifiedNodeCount = Math.round(matchingNodeCount * multiplier);

  const resourceOptions = resourcesWithTag(tag);
  shuffle(rng, nodePool);

  const seenResources = new Set<string>();
  for (const n of nodePool) {
    if (matchingNodeCount >= modifiedNodeCount) break;
    if (hasGameplayTag(n.resource, tag)) continue;
    if (!seenResources.has(n.resource)) {
      seenResources.add(n.resource);
      continue;
    }
    const idx = rng.frandRange(0, resourceOptions.length) | 0;
    n.resource = resourceOptions[idx] ?? n.resource;
    matchingNodeCount += 1;
  }
}

/**
 * Redistribute satellite purities to approximate total throughput.
 * Port of distribute_throughput — starts all Pure, then demotes.
 */
export function distributeThroughput(core: AlgoFrackingCore, throughput: number): void {
  for (const s of core.satellites) {
    s.purity = "pure";
  }

  let error = core.satellites.length * PURITY_ORDINAL.pure - throughput;
  if (error < 2) return;

  const convertCount = Math.min((error / 2) | 0, core.satellites.length);
  for (let i = 0; i < convertCount; i++) {
    const sat = core.satellites[i];
    if (sat) sat.purity = "normal";
  }
  error += convertCount * (PURITY_ORDINAL.normal - PURITY_ORDINAL.pure);

  if (error < 1) return;

  const impureCount = Math.min(error | 0, core.satellites.length);
  for (let i = 0; i < impureCount; i++) {
    const sat = core.satellites[i];
    if (sat) sat.purity = "impure";
  }
}

function applyToAlgoWorld(
  world: AlgoWorld,
  seed: number,
  randomizationMode: NodeRandomizationMode,
  puritySettings: NodePuritySettings,
): void {
  const rng = new RandomStream(seed);

  sortByName(world.resourceNodes);
  sortByName(world.frackingCores);
  for (const c of world.frackingCores) {
    sortByName(c.satellites);
  }

  if (randomizationMode === "none") {
    for (const n of world.resourceNodes) {
      const next = getPurityOverride(rng, n.purity, puritySettings);
      if (next != null) n.purity = next;
    }
  } else {
    const nodePool: ResourceNodeInfo[] = world.resourceNodes.map((n) => ({
      resource: n.resource,
      purity: n.purity,
      totalThroughput: 0,
    }));
    sortNodeInfo(nodePool);

    if (randomizationMode === "basic_rich") {
      modifyNodeDistribution(rng, nodePool, "basic", 1.1);
    } else if (randomizationMode === "advanced_rich") {
      modifyNodeDistribution(rng, nodePool, "advanced", 3.0);
    } else if (randomizationMode === "fossil_fuel_rich") {
      modifyNodeDistribution(rng, nodePool, "fossil_fuel", 2.0);
    }

    for (const n of world.resourceNodes) {
      const poolIndex = rng.frandRange(0, nodePool.length) | 0;
      const info = nodePool.splice(poolIndex, 1)[0];
      if (!info) continue;
      n.resource = info.resource;
      // Konsl: only assign purity when purity settings produce an override.
      // With no_change, slot purity stays (resource still comes from the pool card).
      const next = getPurityOverride(rng, info.purity, puritySettings);
      if (next != null) n.purity = next;
    }

    const frackingPool: ResourceNodeInfo[] = world.frackingCores.map((c) => ({
      resource: c.resource,
      purity: null,
      totalThroughput: coreThroughput(c),
    }));
    sortNodeInfo(frackingPool);
    shuffle(rng, frackingPool);

    for (const core of world.frackingCores) {
      const poolIndex = rng.frandRange(0, frackingPool.length) | 0;
      const info = frackingPool.splice(poolIndex, 1)[0];
      if (!info) continue;
      core.resource = info.resource;
      distributeThroughput(core, info.totalThroughput);
    }
  }

  if (puritySettings !== "no_change") {
    const satellites = world.frackingCores.flatMap((c) => c.satellites);
    sortByName(satellites);
    for (const s of satellites) {
      const next = getPurityOverride(rng, s.purity, puritySettings);
      if (next != null) s.purity = next;
    }
  }
}

/**
 * Apply world seed config to fixed base slots.
 * Pure function; does not mutate baseSlots.
 */
export function applyWorldSeed(baseSlots: ResourceNode[], config: WorldSeedConfig): ResourceNode[] {
  // Fast path: identity config → shallow clone (stable for Default)
  if (config.mode === "none" && config.purity === "no_change") {
    return baseSlots.map((n) => ({ ...n }));
  }

  const world = nodesToAlgoWorld(baseSlots);
  applyToAlgoWorld(world, config.seed, config.mode, config.purity);
  return algoWorldToNodes(baseSlots, world);
}

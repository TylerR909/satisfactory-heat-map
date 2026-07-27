/**
 * Split / join our flat ResourceNode[] into Konsl-shaped pools for randomization.
 *
 * TypeScript support code for the Konsl/satisfactory-world-generator MIT algorithm port.
 * Copyright (c) 2026 Konsl — see third_party/konsl-satisfactory-world-generator.md
 *
 * Deposit membership: Konsl extract only includes BP_ResourceNode_C — deposits are
 * EXCLUDED from the shuffle pool.
 */

import { resourceLabel } from "@/lib/resources";
import { compareCodeUnit, PURITY_ORDINAL } from "@/lib/seed/resources";
import type { Purity, ResourceNode } from "@/types";

export type AlgoResourceNode = {
  name: string;
  resource: string;
  purity: Purity;
  /** Index into original baseSlots array for write-back. */
  baseIndex: number;
};

export type AlgoSatellite = {
  name: string;
  purity: Purity;
  baseIndex: number;
};

export type AlgoFrackingCore = {
  name: string;
  resource: string;
  satellites: AlgoSatellite[];
  baseIndex: number;
};

export type AlgoWorld = {
  resourceNodes: AlgoResourceNode[];
  frackingCores: AlgoFrackingCore[];
  /** Indices of nodes left untouched (geysers, deposits, etc.). */
  passthroughIndices: number[];
};

/**
 * Build algorithm world from flat nodes.
 * Fracking satellites assigned to nearest core (same-resource guaranteed on vanilla data).
 */
export function nodesToAlgoWorld(baseSlots: ResourceNode[]): AlgoWorld {
  const resourceNodes: AlgoResourceNode[] = [];
  const cores: { node: ResourceNode; index: number }[] = [];
  const sats: { node: ResourceNode; index: number }[] = [];
  const passthroughIndices: number[] = [];

  for (let i = 0; i < baseSlots.length; i++) {
    const n = baseSlots[i];
    if (!n) continue;
    switch (n.nodeType) {
      case "node":
        // Explicit: only BP_ResourceNode-style miners — NOT deposits
        resourceNodes.push({
          name: n.id,
          resource: n.resource,
          purity: n.purity,
          baseIndex: i,
        });
        break;
      case "deposit":
        // Konsl does not shuffle deposits — leave vanilla
        passthroughIndices.push(i);
        break;
      case "frackingCore":
        cores.push({ node: n, index: i });
        break;
      case "frackingSatellite":
        sats.push({ node: n, index: i });
        break;
      default:
        // geysers and any other types pass through unshuffled
        passthroughIndices.push(i);
        break;
    }
  }

  // Nearest-core association (vanilla data: 0 resource mismatches)
  const frackingCores: AlgoFrackingCore[] = cores.map(({ node, index }) => ({
    name: node.id,
    resource: node.resource,
    satellites: [],
    baseIndex: index,
  }));

  for (const { node, index } of sats) {
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let c = 0; c < frackingCores.length; c++) {
      const core = cores[c]?.node;
      if (!core) continue;
      const dx = core.x - node.x;
      const dy = core.y - node.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    const target = frackingCores[best];
    if (!target) continue;
    target.satellites.push({
      name: node.id,
      purity: node.purity,
      baseIndex: index,
    });
  }

  return { resourceNodes, frackingCores, passthroughIndices };
}

/** Write algorithm results back onto a shallow copy of baseSlots. */
export function algoWorldToNodes(baseSlots: ResourceNode[], world: AlgoWorld): ResourceNode[] {
  const out = baseSlots.map((n) => ({ ...n }));

  for (const rn of world.resourceNodes) {
    const slot = out[rn.baseIndex];
    if (!slot) continue;
    slot.resource = rn.resource;
    slot.purity = rn.purity;
    // Must update label — vanilla displayName is the pre-shuffle type and would lie after seed
    slot.displayName = resourceLabel(rn.resource);
  }

  for (const core of world.frackingCores) {
    const coreSlot = out[core.baseIndex];
    if (coreSlot) {
      coreSlot.resource = core.resource;
      coreSlot.displayName = resourceLabel(core.resource);
    }
    for (const sat of core.satellites) {
      const satSlot = out[sat.baseIndex];
      if (!satSlot) continue;
      satSlot.resource = core.resource;
      satSlot.purity = sat.purity;
      satSlot.displayName = resourceLabel(core.resource);
    }
  }

  return out;
}

/** Sum of purity ordinals for a core’s satellites (Konsl total_throughput). */
export function coreThroughput(core: AlgoFrackingCore): number {
  return core.satellites.reduce((sum, s) => sum + PURITY_ORDINAL[s.purity], 0);
}

/** Sort names with code-unit order (Rust Ord). */
export function sortByName<T extends { name: string }>(items: T[]): void {
  items.sort((a, b) => compareCodeUnit(a.name, b.name));
}

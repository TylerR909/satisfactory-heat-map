/**
 * Load the compiled sf_engine WASM module (wasm-pack --target bundler).
 * Required for scoring and map seed — no TypeScript algorithm fallback.
 *
 * Wire types: tsify-generated `generated/sf_engine.d.ts` (from Rust).
 * Call sites use domain `@/types` via this façade — no `any`.
 */

import type {
  HeatmapResult as WireHeatmapResult,
  ResourceNodeDto as WireNode,
  ScoreGridInput as WireScoreGridInput,
} from "@/lib/wasm/generated/sf_engine";
import type {
  CapacityTag,
  HeatmapResult,
  NodeType,
  Purity,
  ResourceNode,
  ScoreGridInput,
} from "@/types";

/** Typed surface after load — domain types only. */
export type WasmEngineApi = {
  ping: () => number;
  engine_version: () => string;
  score_grid: (input: ScoreGridInput) => HeatmapResult;
  apply_map_seed: (nodes: ResourceNode[], seed: number, isDefault: boolean) => ResourceNode[];
};

let cached: WasmEngineApi | null | undefined;
let loadPromise: Promise<WasmEngineApi> | null = null;

function asPurity(p: string): Purity {
  if (p === "impure" || p === "normal" || p === "pure") return p;
  return "normal";
}

function asNodeType(t: string | undefined): NodeType {
  if (
    t === "node" ||
    t === "deposit" ||
    t === "frackingCore" ||
    t === "frackingSatellite" ||
    t === "geyser"
  ) {
    return t;
  }
  return "node";
}

function asCapacityTag(t: string | undefined): CapacityTag | undefined {
  if (t === "shortfall" || t === "limited" || t === "ok" || t === "abundant") return t;
  return undefined;
}

/** Map domain score input → wire (null openWater → omitted; camelCase JSON). */
function toWireScoreInput(input: ScoreGridInput): WireScoreGridInput {
  const { openWater, ...rest } = input;
  return {
    ...rest,
    // Wire uses optional | undefined; domain allows null from the store.
    openWater: openWater ?? undefined,
  };
}

function fromWireHeatmap(result: WireHeatmapResult): HeatmapResult {
  return {
    grid: result.grid,
    elapsedMs: result.elapsedMs,
    timings: result.timings,
    scoredDemand: result.scoredDemand,
    topSites: result.topSites.map((s) => ({
      x: s.x,
      y: s.y,
      z: s.z,
      score: s.score,
      satisfiable: s.satisfiable,
      totalHaul: s.totalHaul,
      caveRiskNotes: s.caveRiskNotes,
      capacityTag: asCapacityTag(s.capacityTag),
      maxUtilization: s.maxUtilization,
      limited: s.limited,
      capacityByResource: s.capacityByResource,
      byResource: s.byResource.map((ra) => ({
        resource: ra.resource,
        supplied: ra.supplied,
        demanded: ra.demanded,
        shortfall: ra.shortfall,
        nodes: ra.nodes.map((n) => ({
          nodeId: n.nodeId,
          rateUsed: n.rateUsed,
          dist: n.dist,
          x: n.x,
          y: n.y,
          z: n.z,
          purity: asPurity(n.purity),
          caveRisk: n.caveRisk,
        })),
      })),
    })),
  };
}

function toWireNodes(nodes: ResourceNode[]): WireNode[] {
  return nodes.map((n) => ({
    id: n.id,
    resource: n.resource,
    purity: n.purity,
    nodeType: n.nodeType,
    displayName: n.displayName,
    x: n.x,
    y: n.y,
    z: n.z,
    classPath: n.classPath,
    rotation: n.rotation,
    flags: n.flags ? { cave: n.flags.cave } : undefined,
  }));
}

function fromWireNodes(nodes: WireNode[]): ResourceNode[] {
  return nodes.map((n) => ({
    id: n.id,
    resource: n.resource,
    purity: asPurity(n.purity),
    nodeType: asNodeType(n.nodeType),
    displayName: n.displayName,
    x: n.x,
    y: n.y,
    z: n.z ?? 0,
    classPath: n.classPath,
    rotation: n.rotation,
    flags: n.flags?.cave != null ? { cave: n.flags.cave } : undefined,
  }));
}

/**
 * Eager-load WASM once. Safe from main thread or worker.
 * Rejects if the package is missing or exports fail.
 */
export async function loadWasmEngine(): Promise<WasmEngineApi> {
  if (cached) return cached;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const mod = await import("../../../crates/engine/pkg/sf_engine.js");

    if (typeof mod.ping !== "function" || mod.ping() !== 1) {
      throw new Error("[wasm] sf_engine.ping() failed sanity check");
    }
    if (typeof mod.score_grid !== "function") {
      throw new Error("[wasm] sf_engine.score_grid missing — run npm run wasm:build");
    }
    if (typeof mod.apply_map_seed !== "function") {
      throw new Error("[wasm] sf_engine.apply_map_seed missing — run npm run wasm:build");
    }

    const api: WasmEngineApi = {
      ping: () => mod.ping(),
      engine_version: () => mod.engine_version(),
      score_grid: (input) => fromWireHeatmap(mod.score_grid(toWireScoreInput(input))),
      apply_map_seed: (nodes, seed, isDefault) =>
        fromWireNodes(mod.apply_map_seed(toWireNodes(nodes), seed, isDefault)),
    };
    cached = api;
    return api;
  })();

  try {
    return await loadPromise;
  } catch (e) {
    loadPromise = null;
    cached = undefined;
    throw e;
  }
}

/** Sync access after {@link loadWasmEngine} has resolved. */
export function getCachedWasmEngine(): WasmEngineApi | null {
  return cached ?? null;
}

export function requireWasmEngine(): WasmEngineApi {
  const w = getCachedWasmEngine();
  if (!w) {
    throw new Error(
      "[wasm] Engine not loaded. Call await loadWasmEngine() first (npm run wasm:build if pkg missing).",
    );
  }
  return w;
}

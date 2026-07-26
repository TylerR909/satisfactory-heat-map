import type { HeatmapEngine } from "@/lib/engine-types";
import { computeHierarchicalHeatmap } from "@/lib/heatmap/hierarchical";

/**
 * Factory for the heatmap engine.
 * MVP: pure TypeScript. Later: WasmHeatmapEngine behind the same interface.
 */
export function createEngine(): HeatmapEngine {
  return {
    scoreGrid(input) {
      return computeHierarchicalHeatmap(input);
    },
  };
}

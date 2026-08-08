import type { HeatmapEngine } from "@/lib/engine-types";
import { requireWasmEngine } from "@/lib/wasm/loadEngine";

/**
 * Heatmap engine — WASM only (hierarchical scorer lives in crates/engine).
 */
export function createEngine(): HeatmapEngine {
  return {
    scoreGrid(input) {
      return requireWasmEngine().score_grid(input);
    },
  };
}

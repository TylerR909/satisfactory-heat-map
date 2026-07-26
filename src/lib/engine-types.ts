import type { HeatmapResult, ScoreGridInput } from "@/types";

export interface HeatmapEngine {
  scoreGrid(input: ScoreGridInput): HeatmapResult;
}

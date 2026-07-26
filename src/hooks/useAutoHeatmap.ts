import { useEffect, useMemo, useRef } from "react";
import { useHeatmapWorker } from "@/hooks/useHeatmapWorker";
import { WATER_RESOURCE_ID } from "@/lib/resources";
import { useAppStore } from "@/store/useAppStore";

/**
 * Debounced live heatmap: re-runs when demand, extractors, mode, or knobs change.
 */
export function useAutoHeatmap(debounceMs = 180) {
  const { score } = useHeatmapWorker();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gen = useRef(0);

  const dataReady = useAppStore((s) => s.dataReady);
  const meta = useAppStore((s) => s.meta);
  const nodes = useAppStore((s) => s.nodes);
  const activeDemand = useAppStore((s) => s.activeDemand);
  const omitWaterFromScoring = useAppStore((s) => s.omitWaterFromScoring);
  const miner = useAppStore((s) => s.miner);
  const scoringMode = useAppStore((s) => s.scoringMode);
  const scoringOptions = useAppStore((s) => s.scoringOptions);
  const setHeatmap = useAppStore((s) => s.setHeatmap);
  const setComputing = useAppStore((s) => s.setComputing);
  const setError = useAppStore((s) => s.setError);

  /** Demand actually scored — may drop water when open extractors aren't mapped. */
  const scoringDemand = useMemo(() => {
    if (!omitWaterFromScoring) return activeDemand;
    return activeDemand.filter((d) => d.resource !== WATER_RESOURCE_ID);
  }, [activeDemand, omitWaterFromScoring]);

  useEffect(() => {
    if (!dataReady || !meta) return;
    if (scoringDemand.length === 0) {
      // Invalidate any in-flight worker so a late result can't revive a cleared map
      gen.current += 1;
      if (timer.current) clearTimeout(timer.current);
      setHeatmap(null);
      setComputing(false);
      return;
    }

    if (timer.current) clearTimeout(timer.current);
    setComputing(true);

    timer.current = setTimeout(() => {
      const myGen = ++gen.current;
      void score({
        nodes,
        demand: scoringDemand,
        miner,
        scoringMode,
        options: scoringOptions,
        bounds: meta.worldBounds,
        coarseCols: meta.heatmapDefaults.coarseCols,
        coarseRows: meta.heatmapDefaults.coarseRows,
        refineTopK: meta.heatmapDefaults.refineTopK,
        refineSubdiv: meta.heatmapDefaults.refineSubdiv,
        caveDeltaZCm: meta.heatmapDefaults.caveDeltaZCm,
      })
        .then((result) => {
          if (myGen !== gen.current) return;
          setHeatmap(result);
          setError(null);
        })
        .catch((e: unknown) => {
          if (myGen !== gen.current) return;
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (myGen === gen.current) setComputing(false);
        });
    }, debounceMs);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [
    dataReady,
    meta,
    nodes,
    scoringDemand,
    miner,
    scoringMode,
    scoringOptions,
    score,
    setHeatmap,
    setComputing,
    setError,
    debounceMs,
  ]);
}

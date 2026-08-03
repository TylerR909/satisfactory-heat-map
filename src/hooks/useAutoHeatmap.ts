import { useEffect, useMemo, useRef } from "react";
import { useHeatmapWorker } from "@/hooks/useHeatmapWorker";
import { WELL_ONLY_RESOURCE_IDS } from "@/lib/resources";
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
  const openWater = useAppStore((s) => s.openWater);
  const activeDemand = useAppStore((s) => s.activeDemand);
  const miner = useAppStore((s) => s.miner);
  const scoringMode = useAppStore((s) => s.scoringMode);
  const scoringOptions = useAppStore((s) => s.scoringOptions);
  const setHeatmap = useAppStore((s) => s.setHeatmap);
  const setComputing = useAppStore((s) => s.setComputing);
  const setError = useAppStore((s) => s.setError);

  /**
   * Nitrogen (etc.) only exists on resource wells — force wells on for scoring
   * even if the user preference is still flipping via the store effect.
   */
  const scoringMiner = useMemo(() => {
    const needsWells = activeDemand.some(
      (d) => d.itemsPerMinute > 0 && WELL_ONLY_RESOURCE_IDS.includes(d.resource),
    );
    if (needsWells && !miner.resourceWellsEnabled) {
      return { ...miner, resourceWellsEnabled: true };
    }
    return miner;
  }, [miner, activeDemand]);

  useEffect(() => {
    if (!dataReady || !meta) return;
    if (activeDemand.length === 0) {
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
        openWater,
        demand: activeDemand,
        miner: scoringMiner,
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
    openWater,
    activeDemand,
    scoringMiner,
    scoringMode,
    scoringOptions,
    score,
    setHeatmap,
    setComputing,
    setError,
    debounceMs,
  ]);
}

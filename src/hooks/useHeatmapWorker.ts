import { useCallback, useRef } from "react";
import type { HeatmapResult, ScoreGridInput } from "@/types";
import type { WorkerRequest, WorkerResponse } from "@/workers/heatmap.worker";

export function useHeatmapWorker() {
  const workerRef = useRef<Worker | null>(null);
  const idRef = useRef(0);
  const pendingRef = useRef(
    new Map<number, { resolve: (r: HeatmapResult) => void; reject: (e: Error) => void }>(),
  );

  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL("../workers/heatmap.worker.ts", import.meta.url), {
        type: "module",
      });
      workerRef.current.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const msg = ev.data;
        const pending = pendingRef.current.get(msg.id);
        if (!pending) return;
        pendingRef.current.delete(msg.id);
        if (msg.type === "result") pending.resolve(msg.result);
        else pending.reject(new Error(msg.message));
      };
    }
    return workerRef.current;
  }, []);

  const score = useCallback(
    (input: ScoreGridInput): Promise<HeatmapResult> => {
      const id = ++idRef.current;
      const worker = getWorker();
      return new Promise((resolve, reject) => {
        pendingRef.current.set(id, { resolve, reject });
        const req: WorkerRequest = { type: "score", id, input };
        worker.postMessage(req);
      });
    },
    [getWorker],
  );

  return { score };
}

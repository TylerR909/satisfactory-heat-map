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
        if (msg.type === "ready") {
          if (import.meta.env.DEV) {
            console.info(
              `[heatmap worker] ready · wasm=${msg.wasm}${msg.version ? ` · v${msg.version}` : ""}`,
            );
          }
          return;
        }
        const pending = pendingRef.current.get(msg.id);
        if (!pending) return;
        pendingRef.current.delete(msg.id);
        if (msg.type === "result") pending.resolve(msg.result);
        else pending.reject(new Error(msg.message));
      };
    }
    return workerRef.current;
  }, []);

  /** Construct the worker immediately so WASM init runs at app load. */
  const warm = useCallback(() => {
    getWorker();
  }, [getWorker]);

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

  return { score, warm };
}

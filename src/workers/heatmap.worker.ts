import { createEngine } from "@/lib/engine";
import type { HeatmapEngine } from "@/lib/engine-types";
import { loadWasmEngine } from "@/lib/wasm/loadEngine";
import type { HeatmapResult, ScoreGridInput } from "@/types";

export type WorkerRequest = {
  type: "score";
  id: number;
  input: ScoreGridInput;
};

export type WorkerResponse =
  | { type: "result"; id: number; result: HeatmapResult }
  | { type: "error"; id: number; message: string }
  | { type: "ready"; wasm: boolean; version: string | null };

/** Eager boot: WASM required (no TS fallback). */
const engineReady: Promise<HeatmapEngine> = (async () => {
  const wasm = await loadWasmEngine();
  const engine = createEngine();
  const ready: WorkerResponse = {
    type: "ready",
    wasm: true,
    version: wasm.engine_version(),
  };
  self.postMessage(ready);
  return engine;
})();

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type !== "score") return;
  void engineReady
    .then((engine) => {
      const result = engine.scoreGrid(msg.input);
      const response: WorkerResponse = { type: "result", id: msg.id, result };
      self.postMessage(response);
    })
    .catch((e: unknown) => {
      const response: WorkerResponse = {
        type: "error",
        id: msg.id,
        message: e instanceof Error ? e.message : String(e),
      };
      self.postMessage(response);
    });
};

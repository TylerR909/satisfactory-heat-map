import { createEngine } from "@/lib/engine";
import type { HeatmapResult, ScoreGridInput } from "@/types";

const engine = createEngine();

export type WorkerRequest = {
  type: "score";
  id: number;
  input: ScoreGridInput;
};

export type WorkerResponse =
  | { type: "result"; id: number; result: HeatmapResult }
  | { type: "error"; id: number; message: string };

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type !== "score") return;
  try {
    const result = engine.scoreGrid(msg.input);
    const response: WorkerResponse = { type: "result", id: msg.id, result };
    self.postMessage(response);
  } catch (e) {
    const response: WorkerResponse = {
      type: "error",
      id: msg.id,
      message: e instanceof Error ? e.message : String(e),
    };
    self.postMessage(response);
  }
};

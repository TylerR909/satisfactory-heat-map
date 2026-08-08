import { beforeAll } from "vitest";
import { loadWasmEngine } from "@/lib/wasm/loadEngine";

beforeAll(async () => {
  await loadWasmEngine();
});

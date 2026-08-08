import path from "node:path";
import { fileURLToPath } from "node:url";
import wasm from "vite-plugin-wasm";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/** Vitest loads WASM via vite-plugin-wasm (same pkg as the app). */
export default defineConfig({
  plugins: [wasm()],
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
    // Build WASM before the suite if pkg is missing (CI / fresh worktree).
    globalSetup: ["./src/test/wasmGlobalSetup.ts"],
    // Per-file: load WASM into the module cache
    setupFiles: ["./src/test/wasmSetup.ts"],
    testTimeout: 30_000,
  },
});

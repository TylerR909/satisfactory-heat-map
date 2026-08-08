/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Override basemap base URL (default is same-origin `/map/v1/...`). */
  readonly VITE_MAP_TILES_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * Runtime WASM glue (gitignored under crates/engine/pkg/).
 * Types are published from tsify → `src/lib/wasm/generated/sf_engine.d.ts` by wasm:build.
 */
declare module "../../../crates/engine/pkg/sf_engine.js" {
  export * from "@/lib/wasm/generated/sf_engine";
}

/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Override basemap base (e.g. `/map/v1` after `npm run map:generate`). */
  readonly VITE_MAP_TILES_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Override basemap base URL (default is same-origin `/map/v1/...`). */
  readonly VITE_MAP_TILES_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

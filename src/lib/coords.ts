import type { MapMeta } from "@/types";

export type LatLngTuple = [number, number];

/**
 * Map projection for the self-hosted WebP tile pyramid
 * (same game→Leaflet math as rockfactory / community calibration).
 *
 * Do **not** flip tile Y in the TileLayer — that produces horizontal
 * strip seams that get worse every zoom level.
 *
 * Satisfactory Unreal axes (game): +X east, +Y south on many references.
 * This transform is calibrated so **markers sit on the basemap art**, not
 * so that mathematical +Y points “up the screen.”
 *
 * See docs/DATA.md / public/map/v1/README.md.
 */

/** Leaflet zoom-0 image size (= one 256px tile). */
export const IMAGE_SIZE = 256;

/** Playable area in Unreal cm (community / rockfactory calibration). */
export const WORLD_X_MIN = -324_700;
export const WORLD_X_MAX = 425_300;
export const WORLD_Y_MIN = -375_000;
export const WORLD_Y_MAX = 375_000;

const X_RANGE = WORLD_X_MAX - WORLD_X_MIN;
const Y_RANGE = WORLD_Y_MAX - WORLD_Y_MIN;

/**
 * Full map in CRS.Simple. Top edge lat=0, bottom lat=−IMAGE_SIZE
 * (required so XYZ tile indices stay non-negative).
 */
export const IMAGE_BOUNDS: LatLngTuple[] = [
  [-IMAGE_SIZE, 0],
  [0, IMAGE_SIZE],
];

export const MIN_ZOOM = 0;
/** Matches wiki→4096 pyramid (`npm run map:generate`, z0–4). */
export const MAX_ZOOM = 4;
export const DEFAULT_ZOOM = 2;

/** Same-origin path (Vite `public/` in dev; baked into `dist` in prod). */
export const DEFAULT_TILES_URL = "/map/v1/{z}/{x}/{y}.webp";

/**
 * Resolve TileLayer URL template.
 * - `VITE_MAP_TILES_BASE_URL` wins (absolute host, `/map/v1`, or full `{z}/{x}/{y}` template)
 * - Else `metaTilesUrl`, else same-origin `DEFAULT_TILES_URL`
 *
 * Dev and prod both default to same-origin. Local Vite: `npm run map:ensure`
 * (unpack pack) or `npm run map:generate` (Docker). Do not point at a remote
 * host unless it serves real WebPs (SPA HTML → `net::ERR_BLOCKED_BY_ORB`).
 */
export function resolveTilesUrl(metaTilesUrl?: string): string {
  const override = import.meta.env.VITE_MAP_TILES_BASE_URL as string | undefined;
  if (override?.trim()) {
    const base = override.trim().replace(/\/$/, "");
    return base.includes("{z}") ? base : `${base}/{z}/{x}/{y}.webp`;
  }
  return metaTilesUrl?.trim() || DEFAULT_TILES_URL;
}

/**
 * Game cm → Leaflet CRS.Simple [lat, lng].
 * Community-calibrated so markers land on the basemap art.
 */
export function worldToLeaflet(
  x: number,
  y: number,
  _meta?: Pick<MapMeta, "leaflet">,
): LatLngTuple {
  const lng = ((x - WORLD_X_MIN) / X_RANGE) * IMAGE_SIZE;
  const lat = -((y - WORLD_Y_MIN) / Y_RANGE) * IMAGE_SIZE;
  return [lat, lng];
}

export function leafletToWorld(
  lat: number,
  lng: number,
  _meta?: Pick<MapMeta, "leaflet">,
): { x: number; y: number } {
  const x = (lng / IMAGE_SIZE) * X_RANGE + WORLD_X_MIN;
  const y = (-lat / IMAGE_SIZE) * Y_RANGE + WORLD_Y_MIN;
  return { x, y };
}

export function worldBoundsToLeaflet(
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  meta?: Pick<MapMeta, "leaflet">,
): LatLngTuple[] {
  const a = worldToLeaflet(bounds.minX, bounds.minY, meta);
  const b = worldToLeaflet(bounds.maxX, bounds.maxY, meta);
  const south = Math.min(a[0], b[0]);
  const north = Math.max(a[0], b[0]);
  const west = Math.min(a[1], b[1]);
  const east = Math.max(a[1], b[1]);
  return [
    [south, west],
    [north, east],
  ];
}

export function defaultWorldBounds() {
  return {
    minX: WORLD_X_MIN,
    maxX: WORLD_X_MAX,
    minY: WORLD_Y_MIN,
    maxY: WORLD_Y_MAX,
  };
}

export function distXY(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.hypot(dx, dy);
}

export function formatDistCm(cm: number): string {
  const m = cm / 100;
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${m.toFixed(0)} m`;
}

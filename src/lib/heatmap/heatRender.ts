/**
 * Display-only heat paint settings.
 * Not part of the plan hash (does not change scoring / clustering).
 * Preferences are cached in localStorage via the app store.
 */

export type HeatRenderOptions = {
  /**
   * Heat ≤ this is fully transparent (0–0.85).
   * Higher separates clusters / kills more of the map.
   */
  fadeDead: number;
  /**
   * Heat ≥ this is max opacity (must be > fadeDead).
   * Lower = bigger solid cores; higher = softer edges.
   */
  fadeFull: number;
  /**
   * Ease power for opacity ramp (1–6).
   * ~1–1.5 = gentle fringe; higher fills hotspot bodies more.
   */
  fadeEase: number;
  /**
   * Peak pixel alpha in the raster (0.25–1), before overlay opacity.
   */
  maxAlpha: number;
  /**
   * Cool band: green holds until here (0.05–0.65).
   */
  stopYellow: number;
  /**
   * Yellow band end → orange (after stopYellow). Higher = more yellow body.
   */
  stopOrange: number;
  /**
   * Into orange peak (after stopOrange). Higher = orange only on narrow core.
   */
  stopRed: number;
  /**
   * Haul-line display only (cm), elevation-offset dashing:
   * - **−1 (Off):** never dash for elevation (caves still dash when flagged)
   * - **0:** dash on any |node.z − site.z| > 0
   * - **> 0:** dash when |Δz| ≥ this many cm
   *
   * Not in URL hash.
   */
  elevDashThresholdCm: number;
};

/** Sentinel: elevation-based haul dashing disabled. */
export const ELEV_DASH_OFF = -1;

/** Slider far-right stop (meters UI); maps to {@link ELEV_DASH_OFF}. */
export const ELEV_DASH_SLIDER_OFF_M = 155;

/**
 * Defaults aimed at: sparse yellow bodies, orange only on narrow peaks,
 * large clear basemap. Works with Peak emphasis default (~2.35).
 * Code line: `0.52 / 0.88 / 1.5 / 0.70 / 0.48 / 0.90 / 0.97`
 */
export const DEFAULT_HEAT_RENDER: HeatRenderOptions = {
  fadeDead: 0.52,
  fadeFull: 0.88,
  fadeEase: 1.5,
  maxAlpha: 0.7,
  stopYellow: 0.48,
  stopOrange: 0.9,
  stopRed: 0.97,
  /** 30 m off median elevation → dashed haul line */
  elevDashThresholdCm: 3_000,
};

export function clampHeatRender(o: Partial<HeatRenderOptions>): HeatRenderOptions {
  const d = { ...DEFAULT_HEAT_RENDER, ...o };
  const fadeDead = Math.min(0.85, Math.max(0, d.fadeDead));
  let fadeFull = Math.min(1, Math.max(0.2, d.fadeFull));
  if (fadeFull <= fadeDead + 0.05) fadeFull = Math.min(1, fadeDead + 0.05);
  const stopYellow = Math.min(0.65, Math.max(0.05, d.stopYellow));
  const stopOrange = Math.min(0.95, Math.max(stopYellow + 0.05, d.stopOrange));
  const stopRed = Math.min(0.99, Math.max(stopOrange + 0.02, d.stopRed));
  // −1 = Off; 0…200 m threshold
  let elevDashThresholdCm = d.elevDashThresholdCm;
  if (!Number.isFinite(elevDashThresholdCm) || elevDashThresholdCm < 0) {
    elevDashThresholdCm = ELEV_DASH_OFF;
  } else {
    elevDashThresholdCm = Math.min(20_000, Math.max(0, elevDashThresholdCm));
  }
  return {
    fadeDead,
    fadeFull,
    fadeEase: Math.min(6, Math.max(1, d.fadeEase)),
    maxAlpha: Math.min(1, Math.max(0.25, d.maxAlpha)),
    stopYellow,
    stopOrange,
    stopRed,
    elevDashThresholdCm,
  };
}

/** Slider meters (0…150) or {@link ELEV_DASH_SLIDER_OFF_M} ↔ stored cm / Off. */
export function elevDashThresholdToSliderM(cm: number): number {
  if (cm < 0) return ELEV_DASH_SLIDER_OFF_M;
  return Math.min(150, Math.max(0, Math.round(cm / 100 / 5) * 5));
}

export function elevDashSliderMToThresholdCm(sliderM: number): number {
  if (sliderM >= ELEV_DASH_SLIDER_OFF_M - 2.5) return ELEV_DASH_OFF;
  return Math.min(150, Math.max(0, sliderM)) * 100;
}

/** Whether a haul line should dash for elevation offset (not caves). */
export function elevOffsetShouldDash(nodeZ: number, siteZ: number, thresholdCm: number): boolean {
  if (thresholdCm < 0) return false; // Off
  const dz = Math.abs(nodeZ - siteZ);
  if (thresholdCm === 0) return dz > 0; // any difference
  return dz >= thresholdCm;
}

/** Compact line for support / sharing paint prefs (not URL hash). */
export function formatHeatRenderCode(o: HeatRenderOptions): string {
  const c = clampHeatRender(o);
  const elev = c.elevDashThresholdCm < 0 ? "off" : `${(c.elevDashThresholdCm / 100).toFixed(0)}m`;
  return [
    c.fadeDead.toFixed(2),
    c.fadeFull.toFixed(2),
    c.fadeEase.toFixed(1),
    c.maxAlpha.toFixed(2),
    c.stopYellow.toFixed(2),
    c.stopOrange.toFixed(2),
    c.stopRed.toFixed(2),
    `elevDash=${elev}`,
  ].join(" / ");
}

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
};

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
};

export function clampHeatRender(o: Partial<HeatRenderOptions>): HeatRenderOptions {
  const d = { ...DEFAULT_HEAT_RENDER, ...o };
  const fadeDead = Math.min(0.85, Math.max(0, d.fadeDead));
  let fadeFull = Math.min(1, Math.max(0.2, d.fadeFull));
  if (fadeFull <= fadeDead + 0.05) fadeFull = Math.min(1, fadeDead + 0.05);
  const stopYellow = Math.min(0.65, Math.max(0.05, d.stopYellow));
  const stopOrange = Math.min(0.95, Math.max(stopYellow + 0.05, d.stopOrange));
  const stopRed = Math.min(0.99, Math.max(stopOrange + 0.02, d.stopRed));
  return {
    fadeDead,
    fadeFull,
    fadeEase: Math.min(6, Math.max(1, d.fadeEase)),
    maxAlpha: Math.min(1, Math.max(0.25, d.maxAlpha)),
    stopYellow,
    stopOrange,
    stopRed,
  };
}

/** Compact line for support / sharing paint prefs (not URL hash). */
export function formatHeatRenderCode(o: HeatRenderOptions): string {
  const c = clampHeatRender(o);
  return [
    c.fadeDead.toFixed(2),
    c.fadeFull.toFixed(2),
    c.fadeEase.toFixed(1),
    c.maxAlpha.toFixed(2),
    c.stopYellow.toFixed(2),
    c.stopOrange.toFixed(2),
    c.stopRed.toFixed(2),
  ].join(" / ");
}

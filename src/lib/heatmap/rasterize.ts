import {
  clampHeatRender,
  DEFAULT_HEAT_RENDER,
  type HeatRenderOptions,
} from "@/lib/heatmap/heatRender";
import type { HeatmapGrid } from "@/types";

export function easeOutPower(t: number, power: number): number {
  const x = Math.max(0, Math.min(1, t));
  const p = Math.min(6, Math.max(1, power));
  return 1 - (1 - x) ** p;
}

/** Opacity from heat + render knobs. */
export function heatOpacityCurve(t: number, opts: HeatRenderOptions = DEFAULT_HEAT_RENDER): number {
  const o = clampHeatRender(opts);
  if (t <= o.fadeDead) return 0;
  if (t >= o.fadeFull) return 1;
  const u = (t - o.fadeDead) / (o.fadeFull - o.fadeDead);
  return easeOutPower(u, o.fadeEase);
}

/**
 * Warm-pleasant gradient (cool → hot):
 *   soft green → lime → yellow → **orange peak**
 * Orange is the hotspot core; yellow sits just outside; green is the cool falloff.
 * No deep fire-red.
 */
export function heatColorRgb(
  t: number,
  opts: HeatRenderOptions = DEFAULT_HEAT_RENDER,
): [number, number, number] {
  const o = clampHeatRender(opts);
  const x = Math.max(0, Math.min(1, t));

  // Ordered low→high heat. Peak (t=1) = saturated orange.
  const stops: Array<{ t: number; c: [number, number, number] }> = [
    { t: 0, c: [52, 211, 153] }, // soft emerald (outer falloff)
    { t: o.stopYellow, c: [163, 230, 53] }, // lime
    { t: o.stopOrange, c: [250, 204, 21] }, // gold yellow
    { t: o.stopRed, c: [251, 146, 60] }, // warm orange
    { t: 1, c: [234, 88, 12] }, // hotspot peak orange
  ];

  for (let i = 1; i < stops.length; i++) {
    if (stops[i]!.t <= stops[i - 1]!.t) {
      stops[i]!.t = Math.min(0.99, stops[i - 1]!.t + 0.04);
    }
  }

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (x <= b.t) {
      const u = (x - a.t) / (b.t - a.t || 1);
      // smoothstep for less banded color rings
      const s = u * u * (3 - 2 * u);
      return [
        Math.round(a.c[0] + s * (b.c[0] - a.c[0])),
        Math.round(a.c[1] + s * (b.c[1] - a.c[1])),
        Math.round(a.c[2] + s * (b.c[2] - a.c[2])),
      ];
    }
  }
  return stops[stops.length - 1]!.c;
}

export function scoreToRgba(
  t: number,
  satisfiable: boolean,
  opts: HeatRenderOptions = DEFAULT_HEAT_RENDER,
): [number, number, number, number] {
  const o = clampHeatRender(opts);
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped <= 1e-6) return [0, 0, 0, 0];

  const alphaF = heatOpacityCurve(clamped, o);
  if (alphaF <= 0.02) return [0, 0, 0, 0];

  if (!satisfiable) {
    // Cool slate — not red — for shortfall cells that still paint
    const a = Math.round(alphaF * o.maxAlpha * 120);
    return [100, 116, 139, a];
  }

  const [r, g, b] = heatColorRgb(clamped, o);
  const a = Math.round(alphaF * o.maxAlpha * 255);
  return [r, g, b, a];
}

export function rasterizeHeatmapGrid(
  grid: HeatmapGrid,
  scale = 8,
  opts: HeatRenderOptions = DEFAULT_HEAT_RENDER,
): string {
  const o = clampHeatRender(opts);
  const w = grid.cols * scale;
  const h = grid.rows * scale;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const image = ctx.createImageData(w, h);
  const data = image.data;

  for (let row = 0; row < grid.rows; row++) {
    const outRow0 = row * scale;
    for (let col = 0; col < grid.cols; col++) {
      const idx = row * grid.cols + col;
      const score = grid.scores[idx] ?? 0;
      const sat = grid.satisfiable[idx] ?? false;
      const [r, g, b, a] = score > 1e-6 ? scoreToRgba(score, sat, o) : ([0, 0, 0, 0] as const);

      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = ((outRow0 + dy) * w + col * scale + dx) * 4;
          data[px] = r;
          data[px + 1] = g;
          data[px + 2] = b;
          data[px + 3] = a;
        }
      }
    }
  }

  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

import { useEffect, useMemo, useState } from "react";
import { ImageOverlay, useMap } from "react-leaflet";
import { ensureMapPanes } from "@/components/map/MapPanes";
import { worldToLeaflet } from "@/lib/coords";
import type { HeatRenderOptions } from "@/lib/heatmap/heatRender";
import { DEFAULT_HEAT_RENDER } from "@/lib/heatmap/heatRender";
import { rasterizeHeatmapGrid } from "@/lib/heatmap/rasterize";
import type { HeatmapResult, MapMeta } from "@/types";

type Props = {
  result: HeatmapResult | null;
  meta: MapMeta;
  opacity: number;
  heatRender?: HeatRenderOptions;
};

/**
 * World-space heatmap via Leaflet ImageOverlay.
 * Re-rasterizes when score grid **or** paint knobs change (no rescoring).
 */
export function HeatmapLayer({ result, meta, opacity, heatRender = DEFAULT_HEAT_RENDER }: Props) {
  const map = useMap();
  ensureMapPanes(map);
  const [url, setUrl] = useState<string | null>(null);

  const imageBounds = useMemo(() => {
    if (!result) return null;
    const { grid } = result;
    const minX = grid.originX;
    const minY = grid.originY;
    const maxX = grid.originX + grid.cols * grid.cellW;
    const maxY = grid.originY + grid.rows * grid.cellH;
    const a = worldToLeaflet(minX, minY, meta);
    const b = worldToLeaflet(maxX, maxY, meta);
    const south = Math.min(a[0], b[0]);
    const north = Math.max(a[0], b[0]);
    const west = Math.min(a[1], b[1]);
    const east = Math.max(a[1], b[1]);
    return [
      [south, west],
      [north, east],
    ] as [[number, number], [number, number]];
  }, [result, meta]);

  useEffect(() => {
    if (!result) {
      setUrl(null);
      return;
    }
    const id = requestAnimationFrame(() => {
      setUrl(rasterizeHeatmapGrid(result.grid, 8, heatRender));
    });
    return () => cancelAnimationFrame(id);
  }, [result, heatRender]);

  if (!url || !imageBounds || !result) return null;

  // Key forces Leaflet to replace the overlay when the raster changes (url prop alone
  // can leave a stale heat image while top-site pins already reflect the new demand).
  return (
    <ImageOverlay
      key={url}
      url={url}
      bounds={imageBounds}
      opacity={opacity}
      pane="heatmapPane"
      className="sf-heatmap-overlay"
    />
  );
}

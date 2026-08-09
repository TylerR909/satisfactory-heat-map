import type { Map as LeafletMap } from "leaflet";
import { useMap } from "react-leaflet";

/**
 * Custom Leaflet panes (created synchronously so Path layers can attach).
 *
 * Stack (bottom → top), matching product intent:
 *   1. tiles              (Leaflet tilePane ≈ 200)
 *   2. heatmap colors     heatmapPane
 *   3. ambient demand dots  nodePane        — “non-draw” resource nodes
 *   4. haul / assignment lines  haulLinePane
 *   5. assignment endpoints   assignedNodePane — water sources + selected feed nodes
 *   6. top-site pins      sitePinPane
 *   7. tooltips           (Leaflet tooltipPane ≈ 650)
 */
function pane(map: LeafletMap, name: string, zIndex: string, pointerEvents?: string): void {
  const el = map.getPane(name) ?? map.createPane(name);
  el.style.zIndex = zIndex;
  if (pointerEvents != null) el.style.pointerEvents = pointerEvents;
}

export function ensureMapPanes(map: LeafletMap): void {
  // 2 — heat under everything interactive
  pane(map, "heatmapPane", "350", "none");
  // 3 — ambient demand nodes (under haul lines so lines aren’t buried)
  pane(map, "nodePane", "400");
  // 4 — assignment haul lines
  pane(map, "haulLinePane", "500");
  // 5 — nodes at the end of haul lines (water sources + selected feeds)
  pane(map, "assignedNodePane", "550");
  // 6 — hotspot pins
  pane(map, "sitePinPane", "600");
  // Legacy alias (HMR / older layers)
  pane(map, "assignmentPane", "600");
}

/** Mount first inside MapContainer so panes exist for sibling layers. */
export function MapPanes() {
  const map = useMap();
  ensureMapPanes(map);
  return null;
}

import type { Map as LeafletMap } from "leaflet";
import { useMap } from "react-leaflet";

/**
 * Custom Leaflet panes (created synchronously so Path layers can attach).
 *
 * Stack (bottom → top):
 *   tiles (200) → heatmap → haul lines → demand nodes → site pins → tooltips (650)
 */
function pane(map: LeafletMap, name: string, zIndex: string, pointerEvents?: string): void {
  const el = map.getPane(name) ?? map.createPane(name);
  el.style.zIndex = zIndex;
  if (pointerEvents != null) el.style.pointerEvents = pointerEvents;
}

export function ensureMapPanes(map: LeafletMap): void {
  pane(map, "heatmapPane", "350", "none");
  // Assignment lines above heat, under resource nodes
  pane(map, "haulLinePane", "400");
  // Demand nodes above haul lines + heat, under site pins
  pane(map, "nodePane", "520");
  // Hotspot pins above everything except tooltips (650)
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

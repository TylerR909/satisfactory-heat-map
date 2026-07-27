import L from "leaflet";
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import { worldToLeaflet } from "@/lib/coords";
import type { MapMeta, SiteScore } from "@/types";

type Props = {
  sites: SiteScore[];
  selectedIndex: number | null;
  meta: MapMeta;
};

/**
 * Inset the viewport slightly so a pin only "counts" as on-screen when it is
 * comfortably inside (not under the edge / chrome). Fraction of bounds size.
 */
const VIEWPORT_INSET = 0.08;

/**
 * When the user picks a different top site (map pin or planner list), pan to
 * that site at the **current** zoom — but only if it is off-screen (or barely
 * on the edge). Zoomed-out framing with the pin already in view stays put.
 *
 * Skips the automatic select of site #0 when a new heatmap result arrives.
 */
export function CenterOnSelectedSite({ sites, selectedIndex, meta }: Props) {
  const map = useMap();
  const prevIndex = useRef<number | null>(null);
  const prevSites = useRef(sites);

  useEffect(() => {
    const sitesChanged = prevSites.current !== sites;
    prevSites.current = sites;

    if (selectedIndex == null) {
      prevIndex.current = null;
      return;
    }

    const site = sites[selectedIndex];
    if (!site) return;

    // First bind or new heatmap auto-select (#0) — remember index, do not pan.
    if (prevIndex.current === null || (sitesChanged && selectedIndex === 0)) {
      prevIndex.current = selectedIndex;
      return;
    }

    if (prevIndex.current === selectedIndex) return;
    prevIndex.current = selectedIndex;

    const [lat, lng] = worldToLeaflet(site.x, site.y, meta);
    const target = L.latLng(lat, lng);

    // Comfortable inner frame: if the pin is already well inside, leave the map alone.
    const visible = map.getBounds().pad(-VIEWPORT_INSET);
    if (visible.contains(target)) return;

    map.panTo(target, { animate: true });
  }, [map, meta, selectedIndex, sites]);

  return null;
}

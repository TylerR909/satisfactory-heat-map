import { CircleMarker, Polyline, Tooltip, useMap } from "react-leaflet";
import { ensureMapPanes } from "@/components/map/MapPanes";
import { worldToLeaflet } from "@/lib/coords";
import { elevOffsetShouldDash } from "@/lib/heatmap/heatRender";
import type { CapacityTag, MapMeta, SiteScore } from "@/types";

type Props = {
  sites: SiteScore[];
  selectedIndex: number | null;
  meta: MapMeta;
  onSelect: (index: number) => void;
  /**
   * Display-only elev dash threshold (cm): −1 off, 0 any Δz, else |Δz| ≥ threshold.
   * Cave-flagged nodes always dash.
   */
  elevDashThresholdCm?: number;
};

/** Non-solid stroke for elevation offset or cave-flagged nodes. */
const HAUL_DASH = "10 8";

/** Color encodes capacity tag; labels stay off the map (list/breakdown only). */
function pinColors(
  tag: CapacityTag | undefined,
  satisfiable: boolean,
): { color: string; fill: string } {
  const t = tag ?? (satisfiable ? "ok" : "shortfall");
  switch (t) {
    case "abundant":
      return { color: "#e0f2fe", fill: "#0ea5e9" }; // sky
    case "limited":
      return { color: "#fef3c7", fill: "#f59e0b" }; // amber
    case "shortfall":
      return { color: "#fecaca", fill: "#ef4444" }; // red
    default:
      return { color: "#f8fafc", fill: "#22c55e" }; // green OK
  }
}

export function TopSitesLayer({
  sites,
  selectedIndex,
  meta,
  onSelect,
  elevDashThresholdCm = -1,
}: Props) {
  const map = useMap();
  ensureMapPanes(map);

  const selected = selectedIndex != null ? sites[selectedIndex] : null;
  if (!map.getPane("sitePinPane") || !map.getPane("haulLinePane")) return null;

  const siteZ = selected?.z ?? 0;
  const elevThresh = elevDashThresholdCm ?? -1;

  return (
    <>
      {selected?.byResource.flatMap((ra) =>
        ra.nodes.map((n) => {
          const elevOff = elevOffsetShouldDash(n.z, siteZ, elevThresh);
          const dashed = n.caveRisk || elevOff;
          return (
            <Polyline
              key={`line-${selectedIndex}-${n.nodeId}`}
              positions={[
                worldToLeaflet(selected.x, selected.y, meta),
                worldToLeaflet(n.x, n.y, meta),
              ]}
              pane="haulLinePane"
              pathOptions={{
                color: n.caveRisk ? "#e9d5ff" : elevOff ? "#fde68a" : "#ffffff",
                weight: 4,
                opacity: 1,
                lineCap: "round",
                lineJoin: "round",
                dashArray: dashed ? HAUL_DASH : undefined,
              }}
            />
          );
        }),
      )}

      {sites.map((site, i) => {
        const isSel = i === selectedIndex;
        const rank = i + 1;
        const siteKey = `${Math.round(site.x)}:${Math.round(site.y)}:${site.score.toFixed(6)}`;
        const pin = pinColors(site.capacityTag, site.satisfiable);
        return (
          <CircleMarker
            key={siteKey}
            center={worldToLeaflet(site.x, site.y, meta)}
            radius={isSel ? 11 : 8}
            pane="sitePinPane"
            pathOptions={{
              color: pin.color,
              fillColor: pin.fill,
              fillOpacity: isSel ? 1 : 0.92,
              weight: isSel ? 3 : 2,
            }}
            eventHandlers={{
              click: () => onSelect(i),
            }}
          >
            {/* Rank only — capacity is color-coded on the pin (not buried under text) */}
            <Tooltip
              permanent
              direction="center"
              offset={[0, 0]}
              opacity={1}
              className="sf-hotspot-rank"
              pane="tooltipPane"
            >
              {rank}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}

import { CircleMarker, Tooltip, useMap } from "react-leaflet";
import { ensureMapPanes } from "@/components/map/MapPanes";
import { worldToLeaflet } from "@/lib/coords";
import { formatRate, nodeExtractRate } from "@/lib/mining";
import { RESOURCE_COLORS, resourceLabel } from "@/lib/resources";
import type { MapMeta, MinerSettings, RawDemand, ResourceNode } from "@/types";

type Props = {
  nodes: ResourceNode[];
  meta: MapMeta;
  demand: RawDemand[];
  miner: MinerSettings;
  show: boolean;
};

export function NodeLayer({ nodes, meta, demand, miner, show }: Props) {
  const map = useMap();
  ensureMapPanes(map);
  if (!show) return null;
  if (!map.getPane("nodePane")) return null;

  const wanted = new Set(demand.map((d) => d.resource));
  const visible = wanted.size
    ? nodes.filter((n) => wanted.has(n.resource) && n.nodeType !== "frackingCore")
    : nodes.filter((n) => n.nodeType === "node").slice(0, 200);

  return (
    <>
      {visible.map((n) => {
        const color = RESOURCE_COLORS[n.resource] ?? "#64748b";
        const radius = n.purity === "pure" ? 6 : n.purity === "normal" ? 5 : 4;
        // Outline so dark fills (coal/oil) stay visible on the basemap
        const stroke =
          n.resource === "Desc_LiquidOil_C" || n.resource === "Desc_Coal_C" ? "#f8fafc" : color;
        const rate = nodeExtractRate(n, miner);
        // Key includes type/purity so seed reshuffles remount markers (Leaflet pathOptions
        // often do not repaint fillColor when only props change under a stable key).
        const markerKey = `${n.id}:${n.resource}:${n.purity}`;
        return (
          <CircleMarker
            key={markerKey}
            center={worldToLeaflet(n.x, n.y, meta)}
            radius={radius}
            pane="nodePane"
            pathOptions={{
              color: stroke,
              fillColor: color,
              fillOpacity: 0.9,
              weight: 1.5,
              opacity: 0.95,
            }}
          >
            <Tooltip>
              {resourceLabel(n.resource)} · {n.purity}
              {n.nodeType !== "node" ? ` · ${n.nodeType}` : ""}
              <br />
              {rate > 0 ? `${formatRate(rate)}/min` : "no extract rate"}
              <br />({Math.round(n.x)}, {Math.round(n.y)})
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}

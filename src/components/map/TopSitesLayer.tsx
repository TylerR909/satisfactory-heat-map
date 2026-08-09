import { Fragment } from "react";
import { CircleMarker, Polyline, Tooltip, useMap } from "react-leaflet";
import { ensureMapPanes } from "@/components/map/MapPanes";
import { worldToLeaflet } from "@/lib/coords";
import { elevOffsetShouldDash } from "@/lib/heatmap/heatRender";
import { formatRate } from "@/lib/mining";
import { RESOURCE_COLORS, resourceLabel, WATER_RESOURCE_ID } from "@/lib/resources";
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

const WATER_LINE = RESOURCE_COLORS[WATER_RESOURCE_ID] ?? "#38bdf8";

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

function haulLineColor(resource: string, caveRisk: boolean, elevOff: boolean): string {
  if (resource === WATER_RESOURCE_ID) return WATER_LINE;
  if (caveRisk) return "#e9d5ff";
  if (elevOff) return "#fde68a";
  return "#ffffff";
}

function endpointFill(resource: string): string {
  return RESOURCE_COLORS[resource] ?? "#94a3b8";
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
  if (
    !map.getPane("sitePinPane") ||
    !map.getPane("haulLinePane") ||
    !map.getPane("assignedNodePane")
  ) {
    return null;
  }

  const siteZ = selected?.z ?? 0;
  const elevThresh = elevDashThresholdCm ?? -1;

  return (
    <>
      {/* 4 — haul lines (above ambient demand nodes, under endpoint dots + pins) */}
      {selected?.byResource.flatMap((ra) =>
        ra.nodes.map((n) => {
          const elevOff = elevOffsetShouldDash(n.z, siteZ, elevThresh);
          const dashed = n.caveRisk || elevOff;
          return (
            <Polyline
              key={`line-${selectedIndex}-${ra.resource}-${n.nodeId}`}
              positions={[
                worldToLeaflet(selected.x, selected.y, meta),
                worldToLeaflet(n.x, n.y, meta),
              ]}
              pane="haulLinePane"
              pathOptions={{
                color: haulLineColor(ra.resource, n.caveRisk, elevOff),
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

      {/*
        5 — “draw” endpoints: sit on top of haul lines so lines don’t bury the
        destination (water sources + assigned demand nodes).
      */}
      {selected?.byResource.flatMap((ra) =>
        ra.nodes.map((n) => {
          const isWater = ra.resource === WATER_RESOURCE_ID;
          const isOpenWater = n.nodeId.startsWith("ow_");
          const fill = isWater ? WATER_LINE : endpointFill(ra.resource);
          /**
           * Light rim via two solid discs (not SVG stroke — stroke hit-testing is flaky).
           *
           * IMPORTANT: `interactive` must be a top-level CircleMarker prop.
           * Putting it in pathOptions only reaches setStyle() and is ignored, so both
           * circles stayed interactive; the inner (no tooltip) sat on top → tips only
           * on the exposed rim. That showed up more consistently on CF builds.
           */
          const rim = "#f8fafc";
          const outerR = isWater ? 7 : 6;
          const innerR = isWater ? 5 : 4;
          const center = worldToLeaflet(n.x, n.y, meta);
          const label = resourceLabel(ra.resource);
          const noSelect = {
            mousedown: (e: { originalEvent: Event }) => {
              e.originalEvent.preventDefault();
            },
            click: (e: { originalEvent: Event }) => {
              e.originalEvent.preventDefault();
              e.originalEvent.stopPropagation();
            },
          };
          return (
            <Fragment key={`end-${selectedIndex}-${ra.resource}-${n.nodeId}`}>
              {/* Outer disc: full hit target + tooltip (rim color) */}
              <CircleMarker
                center={center}
                radius={outerR}
                pane="assignedNodePane"
                interactive
                bubblingMouseEvents
                className="sf-assigned-node"
                pathOptions={{
                  color: rim,
                  fillColor: rim,
                  fillOpacity: 1,
                  weight: 0,
                  opacity: 1,
                }}
                eventHandlers={noSelect}
              >
                <Tooltip direction="top" opacity={0.95} sticky={false}>
                  {label}
                  {isOpenWater ? " · open water" : ` · ${n.purity}`}
                  {n.caveRisk ? " · cave" : ""}
                  <br />
                  {n.rateUsed > 0 ? `${formatRate(n.rateUsed)}/min used` : "no extract rate"}
                  <br />({Math.round(n.x)}, {Math.round(n.y)})
                </Tooltip>
              </CircleMarker>
              {/* Inner fill: must be non-interactive so hover reaches the outer disc */}
              <CircleMarker
                center={center}
                radius={innerR}
                pane="assignedNodePane"
                interactive={false}
                pathOptions={{
                  color: fill,
                  fillColor: fill,
                  fillOpacity: 1,
                  weight: 0,
                  opacity: 1,
                }}
              />
            </Fragment>
          );
        }),
      )}

      {/* 6 — top-site pins */}
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

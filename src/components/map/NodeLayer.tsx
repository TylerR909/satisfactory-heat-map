import type { CircleMarker as LeafletCircleMarker } from "leaflet";
import { useEffect, useRef } from "react";
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

type CircleMarkerWithTip = LeafletCircleMarker & {
  _openTooltip?: (e: unknown) => void;
};

/**
 * Demand dots must stay hoverable (tooltips) but must not act like controls.
 * Leaflet + browsers otherwise:
 *  - bind click → openTooltip (touch)
 *  - allow SVG path focus on click (focus ring looks like a “bigger” dot)
 */
function hardenDemandNode(layer: LeafletCircleMarker) {
  const tipLayer = layer as CircleMarkerWithTip;
  if (typeof tipLayer._openTooltip === "function") {
    layer.off("click", tipLayer._openTooltip);
  }
  // Drop any other click handlers so the map/UI can receive the click.
  layer.off("click");

  const el = layer.getElement?.() as SVGElement | HTMLElement | undefined;
  if (!el) return;

  // Not in the tab order; not announced as a control.
  el.setAttribute("tabindex", "-1");
  el.setAttribute("focusable", "false"); // SVG
  el.setAttribute("aria-hidden", "true");
  el.style.outline = "none";

  // WebKit/Blink will focus some SVG paths on mousedown unless prevented.
  const blockFocus = (e: Event) => {
    e.preventDefault();
  };
  el.addEventListener("mousedown", blockFocus, { capture: true });
  el.addEventListener("touchstart", blockFocus, { capture: true, passive: false });
  el.addEventListener("click", blockFocus, { capture: true });

  // Blur if something still focused the path.
  el.addEventListener("focus", () => {
    el.blur?.();
  });

  return () => {
    el.removeEventListener("mousedown", blockFocus, { capture: true } as EventListenerOptions);
    el.removeEventListener("touchstart", blockFocus, { capture: true } as EventListenerOptions);
    el.removeEventListener("click", blockFocus, { capture: true } as EventListenerOptions);
  };
}

function DemandNodeMarker({
  node,
  meta,
  miner,
}: {
  node: ResourceNode;
  meta: MapMeta;
  miner: MinerSettings;
}) {
  const ref = useRef<LeafletCircleMarker | null>(null);
  const color = RESOURCE_COLORS[node.resource] ?? "#64748b";
  const radius = node.purity === "pure" ? 6 : node.purity === "normal" ? 5 : 4;
  // No contrasting border on ambient nodes — borders are for selected “draw” endpoints only.
  const rate = nodeExtractRate(node, miner);

  useEffect(() => {
    const layer = ref.current;
    if (!layer) return;

    // Tooltip child binds after the marker mounts — harden immediately and again shortly after.
    const cleanups: Array<(() => void) | undefined> = [];
    const run = () => {
      cleanups.push(hardenDemandNode(layer));
    };
    run();
    const t0 = window.setTimeout(run, 0);
    const t1 = window.setTimeout(run, 50);

    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      for (const c of cleanups) c?.();
    };
  }, []);

  return (
    <CircleMarker
      ref={ref}
      center={worldToLeaflet(node.x, node.y, meta)}
      radius={radius}
      pane="nodePane"
      pathOptions={{
        color: color,
        fillColor: color,
        fillOpacity: 0.92,
        weight: 0,
        opacity: 1,
        className: "sf-resource-node",
        // Keep interactive so hover tooltips work; clicks/focus are blocked in hardenDemandNode.
        interactive: true,
        bubblingMouseEvents: true,
      }}
      eventHandlers={{
        // Leaflet layer events — stop click so nothing “selects” the path.
        mousedown: (e) => {
          // PreventDefault on the original event stops SVG focus in WebKit.
          e.originalEvent.preventDefault();
        },
        click: (e) => {
          e.originalEvent.preventDefault();
          e.originalEvent.stopPropagation();
        },
      }}
    >
      <Tooltip direction="top" opacity={0.95} sticky={false}>
        {resourceLabel(node.resource)} · {node.purity}
        {node.nodeType !== "node" ? ` · ${node.nodeType}` : ""}
        <br />
        {rate > 0 ? `${formatRate(rate)}/min` : "no extract rate"}
        <br />({Math.round(node.x)}, {Math.round(node.y)})
      </Tooltip>
    </CircleMarker>
  );
}

export function NodeLayer({ nodes, meta, demand, miner, show }: Props) {
  const map = useMap();
  ensureMapPanes(map);
  if (!show) return null;
  if (!map.getPane("nodePane")) return null;

  const wanted = new Set(demand.map((d) => d.resource));
  const wellsOn = miner.resourceWellsEnabled !== false;
  const visible = wanted.size
    ? nodes.filter((n) => {
        if (!wanted.has(n.resource)) return false;
        if (n.nodeType === "frackingCore") return false;
        if (!wellsOn && n.nodeType === "frackingSatellite") return false;
        return true;
      })
    : nodes.filter((n) => n.nodeType === "node").slice(0, 200);

  return (
    <>
      {visible.map((n) => {
        // Key includes type/purity so seed reshuffles remount markers (Leaflet pathOptions
        // often do not repaint fillColor when only props change under a stable key).
        const markerKey = `${n.id}:${n.resource}:${n.purity}`;
        return <DemandNodeMarker key={markerKey} node={n} meta={meta} miner={miner} />;
      })}
    </>
  );
}

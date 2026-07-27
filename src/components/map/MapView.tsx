import L from "leaflet";
import { useMemo } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import { CenterOnSelectedSite } from "@/components/map/CenterOnSelectedSite";
import { FitWorld } from "@/components/map/FitWorld";
import { HeatmapLayer } from "@/components/map/HeatmapLayer";
import { MapPanes } from "@/components/map/MapPanes";
import { NodeLayer } from "@/components/map/NodeLayer";
import { TopSitesLayer } from "@/components/map/TopSitesLayer";
import {
  IMAGE_BOUNDS,
  IMAGE_SIZE,
  MAX_ZOOM,
  MIN_ZOOM,
  resolveTilesUrl,
  worldToLeaflet,
} from "@/lib/coords";
import { useAppStore } from "@/store/useAppStore";
import "leaflet/dist/leaflet.css";

export function MapView() {
  const meta = useAppStore((s) => s.meta);
  const nodes = useAppStore((s) => s.nodes);
  const heatmap = useAppStore((s) => s.heatmap);
  const heatOpacity = useAppStore((s) => s.heatOpacity);
  const heatRender = useAppStore((s) => s.heatRender);
  const showNodes = useAppStore((s) => s.showNodes);
  const activeDemand = useAppStore((s) => s.activeDemand);
  const miner = useAppStore((s) => s.miner);
  const selectedSiteIndex = useAppStore((s) => s.selectedSiteIndex);
  const setSelectedSiteIndex = useAppStore((s) => s.setSelectedSiteIndex);

  const tilesUrl = resolveTilesUrl(meta?.basemap?.tilesUrl);
  const attribution = meta?.basemap?.attribution ?? "Map art © Coffee Stain Studios";

  const center = useMemo(() => {
    if (!meta) return [-IMAGE_SIZE / 2, IMAGE_SIZE / 2] as [number, number];
    return worldToLeaflet(
      (meta.worldBounds.minX + meta.worldBounds.maxX) / 2,
      (meta.worldBounds.minY + meta.worldBounds.maxY) / 2,
      meta,
    );
  }, [meta]);

  // Loose max bounds so fitBounds can fill the viewport; still keeps pan near the world
  const maxBounds = useMemo(() => L.latLngBounds(IMAGE_BOUNDS[0], IMAGE_BOUNDS[1]).pad(0.15), []);

  if (!meta) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-900 text-slate-400">
        Loading map…
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <MapContainer
        crs={L.CRS.Simple}
        center={center}
        // Start zoomed out; FitWorld immediately replaces with a true fit
        zoom={MIN_ZOOM}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        maxBounds={maxBounds}
        maxBoundsViscosity={0.6}
        attributionControl
        className="h-full w-full bg-slate-950"
        style={{ height: "100%", width: "100%", background: "#0a1628" }}
      >
        <MapPanes />
        <FitWorld />
        {/*
          Standard XYZ TileLayer — do not invert tile Y.
          Flipping Y in getTileUrl causes horizontal strip misalignment.
        */}
        <TileLayer
          url={tilesUrl}
          tileSize={256}
          noWrap
          bounds={IMAGE_BOUNDS as L.LatLngBoundsExpression}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          maxNativeZoom={MAX_ZOOM}
          attribution={attribution}
        />

        <HeatmapLayer result={heatmap} meta={meta} opacity={heatOpacity} heatRender={heatRender} />
        <NodeLayer nodes={nodes} meta={meta} demand={activeDemand} miner={miner} show={showNodes} />
        {heatmap && (
          <>
            <CenterOnSelectedSite
              sites={heatmap.topSites}
              selectedIndex={selectedSiteIndex}
              meta={meta}
            />
            <TopSitesLayer
              sites={heatmap.topSites}
              selectedIndex={selectedSiteIndex}
              meta={meta}
              onSelect={setSelectedSiteIndex}
            />
          </>
        )}
      </MapContainer>
    </div>
  );
}

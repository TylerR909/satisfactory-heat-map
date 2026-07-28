import L from "leaflet";
import { useEffect } from "react";
import { useMap } from "react-leaflet";

/** Tailwind `md` — same breakpoint as panel stack / FitWorld. */
const MOBILE_MQ = "(max-width: 767px)";

/**
 * Zoom +/− position:
 * - Mobile: bottom-right (thumb zone; leaves top-left free for ℹ)
 * - Desktop: top-left (Leaflet default)
 */
export function ResponsiveZoomControl() {
  const map = useMap();

  useEffect(() => {
    // MapContainer may have created a default zoom control — drop it.
    if (map.zoomControl) {
      map.removeControl(map.zoomControl);
    }

    let zoom: L.Control.Zoom | null = null;

    const apply = () => {
      const mobile = window.matchMedia(MOBILE_MQ).matches;
      const position: L.ControlPosition = mobile ? "bottomright" : "topleft";
      if (zoom) {
        zoom.setPosition(position);
      } else {
        zoom = L.control.zoom({ position });
        map.addControl(zoom);
      }
    };

    apply();
    const mql = window.matchMedia(MOBILE_MQ);
    mql.addEventListener("change", apply);

    return () => {
      mql.removeEventListener("change", apply);
      if (zoom) map.removeControl(zoom);
    };
  }, [map]);

  return null;
}

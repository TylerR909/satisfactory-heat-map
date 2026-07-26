import L from "leaflet";
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import { IMAGE_BOUNDS } from "@/lib/coords";

const WORLD = L.latLngBounds(IMAGE_BOUNDS[0], IMAGE_BOUNDS[1]);

/**
 * Fit the full world into the map container (fill width or height).
 *
 * Do **not** treat `zoomstart`/`moveend` as user input — `setView`/`fitBounds`
 * emit those, which previously locked us at the first tiny layout zoom (~512px
 * world at zoom 1) when the flex pane later grew to ~1400px.
 *
 * User intent is only: drag, wheel, double-click.
 */
export function FitWorld() {
  const map = useMap();
  const userMoved = useRef(false);

  useEffect(() => {
    const markUser = () => {
      userMoved.current = true;
    };

    const container = map.getContainer();
    map.on("dragstart", markUser);
    map.on("dblclick", markUser);
    container.addEventListener("wheel", markUser, { passive: true });

    const fitWorldToContainer = () => {
      const el = map.getContainer();
      // Wait until flex layout has a real box
      if (el.clientWidth < 80 || el.clientHeight < 80) return false;

      map.invalidateSize({ animate: false, pan: false });

      const size = map.getSize();
      const w = Math.max(size.x, el.clientWidth);
      const h = Math.max(size.y, el.clientHeight);
      if (w < 80 || h < 80) return false;

      if (userMoved.current) return true;

      // Explicit zoom for CRS.Simple — more reliable than fitBounds alone
      const pad = L.point(10, 10);
      const z = map.getBoundsZoom(WORLD, false, pad);
      if (!Number.isFinite(z)) return false;

      map.setView(WORLD.getCenter(), z, { animate: false });
      return true;
    };

    // Burst of attempts while sidebar/flex settles
    const delays = [0, 16, 50, 100, 200, 400, 800, 1600];
    const timers = delays.map((ms) => window.setTimeout(fitWorldToContainer, ms));
    const raf = requestAnimationFrame(() => {
      fitWorldToContainer();
      requestAnimationFrame(fitWorldToContainer);
    });

    const ro = new ResizeObserver(() => {
      fitWorldToContainer();
    });
    ro.observe(container);
    if (container.parentElement) ro.observe(container.parentElement);

    return () => {
      map.off("dragstart", markUser);
      map.off("dblclick", markUser);
      container.removeEventListener("wheel", markUser);
      cancelAnimationFrame(raf);
      for (const t of timers) window.clearTimeout(t);
      ro.disconnect();
    };
  }, [map]);

  return null;
}

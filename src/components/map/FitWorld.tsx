import L from "leaflet";
import { useEffect, useLayoutEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import { IMAGE_BOUNDS, MAX_ZOOM, MIN_ZOOM } from "@/lib/coords";

const WORLD = L.latLngBounds(IMAGE_BOUNDS[0], IMAGE_BOUNDS[1]);

/** Tailwind `md` — stack layout / aggressive fill below this. */
const MOBILE_MQ = "(max-width: 767px)";

/** Seconds — panel open/close zoom (Leaflet setView animate). */
const LAYOUT_ANIM_S = 0.4;

/** After a layout anim, ignore RO snap-fits so we don't "finish" with a hard jump. */
const LAYOUT_QUIET_MS = 600;

/**
 * Continuous zoom so the world *contains* the viewport (cover — fills all
 * pixels, may clip map edges) or *is contained by* the viewport (contain —
 * full world visible, may letterbox).
 */
function fitZoom(
  map: L.Map,
  mode: "contain" | "cover",
  overfill: number,
  sizeOverride?: L.Point,
): number {
  const size = sizeOverride ?? map.getSize();
  if (size.x < 80 || size.y < 80) return Number.NaN;

  const base = map.getZoom() || 0;
  const nw = WORLD.getNorthWest();
  const se = WORLD.getSouthEast();
  const boundsSize = L.bounds(map.project(se, base), map.project(nw, base)).getSize();
  if (boundsSize.x <= 0 || boundsSize.y <= 0) return Number.NaN;

  const scalex = size.x / boundsSize.x;
  const scaley = size.y / boundsSize.y;
  const scale = (mode === "cover" ? Math.max(scalex, scaley) : Math.min(scalex, scaley)) * overfill;

  const z = map.getScaleZoom(scale, base);
  if (!Number.isFinite(z)) return Number.NaN;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

function targetZoom(map: L.Map, sizeOverride?: L.Point): number {
  const mobile = window.matchMedia(MOBILE_MQ).matches;
  return mobile
    ? fitZoom(map, "cover", 1.06, sizeOverride)
    : fitZoom(map, "contain", 1.04, sizeOverride);
}

type Props = {
  /**
   * Changes when app chrome resizes the map pane (e.g. mobile settings sheet
   * collapse). Re-fits zoom into the new viewport without a size-jump.
   */
  layoutKey?: string | number | boolean;
};

/**
 * Fit the world into the map container on load / resize / layout chrome changes.
 *
 * Panel collapse previously did invalidateSize({ pan:false }) then setView —
 * growing the pane downward shifts the geometric center, so the basemap appears
 * to "drag down", then the animated setView snapped it back. We pin the world
 * to the screen with pan:true, then only animate zoom.
 */
export function FitWorld({ layoutKey = 0 }: Props) {
  const map = useMap();
  const userMoved = useRef(false);
  const layoutAnimating = useRef(false);
  const quietUntil = useRef(0);
  const prevLayoutKey = useRef(layoutKey);
  const layoutReady = useRef(false);

  useEffect(() => {
    const markUser = () => {
      if (layoutAnimating.current) return;
      userMoved.current = true;
    };

    const container = map.getContainer();
    map.on("dragstart", markUser);
    map.on("dblclick", markUser);
    container.addEventListener("wheel", markUser, { passive: true });
    container.addEventListener(
      "touchstart",
      (ev) => {
        if (ev.touches.length >= 2) markUser();
      },
      { passive: true },
    );

    const fitWorldToContainer = () => {
      if (layoutAnimating.current) return false;
      if (performance.now() < quietUntil.current) {
        // Size may still be settling; keep world glued to the screen only.
        map.invalidateSize({ animate: false, pan: true });
        return false;
      }

      const el = map.getContainer();
      if (el.clientWidth < 80 || el.clientHeight < 80) return false;

      // pan:true keeps lat/lng under the same pixels when the pane grows/shrinks
      // (e.g. settings sheet). pan:false is what made collapse "drag" the map.
      map.invalidateSize({ animate: false, pan: true });

      const size = map.getSize();
      if (size.x < 80 || size.y < 80) return false;

      if (userMoved.current) return true;

      const z = targetZoom(map);
      if (!Number.isFinite(z)) return false;

      // Already framed — don't hard-snap (this was the end-of-collapse jolt).
      if (Math.abs(map.getZoom() - z) < 0.08) {
        const c = map.getCenter();
        const w = WORLD.getCenter();
        if (Math.abs(c.lat - w.lat) < 0.5 && Math.abs(c.lng - w.lng) < 0.5) {
          return true;
        }
      }

      map.setView(WORLD.getCenter(), z, { animate: false });
      return true;
    };

    // Initial settle only (instant — no animation on first paint).
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
    const shell = container.closest("body")?.querySelector("#root > div");
    if (shell instanceof HTMLElement) ro.observe(shell);

    const onMq = () => {
      if (!userMoved.current && !layoutAnimating.current) fitWorldToContainer();
    };
    const mql = window.matchMedia(MOBILE_MQ);
    mql.addEventListener("change", onMq);

    return () => {
      map.off("dragstart", markUser);
      map.off("dblclick", markUser);
      container.removeEventListener("wheel", markUser);
      cancelAnimationFrame(raf);
      for (const t of timers) window.clearTimeout(t);
      ro.disconnect();
      mql.removeEventListener("change", onMq);
    };
  }, [map]);

  // Settings sheet open/close — before paint.
  useLayoutEffect(() => {
    void layoutKey;

    const isFirst = !layoutReady.current;
    layoutReady.current = true;

    const keyChanged = prevLayoutKey.current !== layoutKey;
    prevLayoutKey.current = layoutKey;

    if (isFirst || !keyChanged) return;

    userMoved.current = false;
    layoutAnimating.current = true;

    let safetyTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      layoutAnimating.current = false;
      quietUntil.current = performance.now() + LAYOUT_QUIET_MS;
      map.off("zoomend", onZoomEnd);
      map.off("moveend", onZoomEnd);
      if (safetyTimer) {
        window.clearTimeout(safetyTimer);
        safetyTimer = null;
      }
    };

    const onZoomEnd = () => {
      window.setTimeout(finish, 32);
    };

    const el = map.getContainer();
    if (el.clientWidth < 80 || el.clientHeight < 80) {
      finish();
      return;
    }

    const cssSize = L.point(el.clientWidth, el.clientHeight);
    const z = targetZoom(map, cssSize);
    if (!Number.isFinite(z)) {
      finish();
      return;
    }

    map.stop();

    // 1) Adopt new pane size while keeping the world fixed on screen.
    //    Without pan:true the geometric center slides (grow-from-bottom) and
    //    the basemap looks like it was dragged, then the zoom anim "catches up".
    map.invalidateSize({ animate: false, pan: true });

    // 2) Zoom only (keep the pinned center) so tiles + markers share one motion.
    const center = map.getCenter();
    if (Math.abs(map.getZoom() - z) < 0.05) {
      finish();
      return;
    }

    map.once("zoomend", onZoomEnd);
    map.once("moveend", onZoomEnd);
    map.setView(center, z, {
      animate: true,
      duration: LAYOUT_ANIM_S,
      easeLinearity: 0.25,
    });
    safetyTimer = window.setTimeout(finish, LAYOUT_ANIM_S * 1000 + 250);

    return () => {
      map.off("zoomend", onZoomEnd);
      map.off("moveend", onZoomEnd);
      if (safetyTimer) window.clearTimeout(safetyTimer);
      map.stop();
      layoutAnimating.current = false;
      quietUntil.current = performance.now() + LAYOUT_QUIET_MS;
    };
  }, [map, layoutKey]);

  return null;
}

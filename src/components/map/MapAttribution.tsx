import L from "leaflet";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-leaflet";

const TIP_W = 240;
const TIP_PAD = 8;
const MOBILE_MQ = "(max-width: 767px)";

type TipPos = { left: number; top: number };

function clampTipBox(anchor: DOMRect, boxW: number, boxH: number, vw: number, vh: number): TipPos {
  const width = Math.min(boxW, vw - TIP_PAD * 2);

  // Prefer aligning to the badge: left-side anchors open rightward, right-side leftward.
  const preferLeftAlign = anchor.left < vw / 2;
  let left = preferLeftAlign ? anchor.left : anchor.right - width;
  left = Math.min(vw - TIP_PAD - width, Math.max(TIP_PAD, left));

  // Prefer below when near the top (mobile under zoom); above when near the bottom.
  const spaceAbove = anchor.top - TIP_PAD;
  const spaceBelow = vh - anchor.bottom - TIP_PAD;
  const placeAbove = spaceAbove >= boxH && spaceAbove >= spaceBelow;
  let top = placeAbove ? anchor.top - 6 - boxH : anchor.bottom + 6;
  top = Math.min(vh - TIP_PAD - boxH, Math.max(TIP_PAD, top));
  return { left, top };
}

/** True mouse hover — not iOS/Chrome-device-mode synthetic mouseenter. */
function canHoverOpen(): boolean {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

/**
 * Compact map credit control — ℹ badge that expands to full Leaflet + basemap
 * attribution.
 *
 * Positions (swapped vs zoom):
 * - Mobile: top-left
 * - Desktop: bottom-right
 */
export function MapAttribution({ basemapAttribution }: { basemapAttribution: string }) {
  const map = useMap();
  const [host, setHost] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = L.DomUtil.create("div", "sf-map-attrib-control") as HTMLDivElement;
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);

    const Ctrl = L.Control.extend({
      options: { position: "topleft" as L.ControlPosition },
      onAdd() {
        return container;
      },
    });
    const ctrl = new Ctrl();

    const applyPosition = () => {
      const mobile = window.matchMedia(MOBILE_MQ).matches;
      // Opposite corner from zoom (mobile: zoom bottom-right; desktop: zoom top-left).
      ctrl.setPosition(mobile ? "topleft" : "bottomright");
    };
    applyPosition();
    map.addControl(ctrl);
    setHost(container);

    const mql = window.matchMedia(MOBILE_MQ);
    mql.addEventListener("change", applyPosition);

    return () => {
      mql.removeEventListener("change", applyPosition);
      map.removeControl(ctrl);
      setHost(null);
    };
  }, [map]);

  if (!host) return null;

  return createPortal(<AttributionButton basemapAttribution={basemapAttribution} />, host);
}

function AttributionButton({ basemapAttribution }: { basemapAttribution: string }) {
  const tipId = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [pos, setPos] = useState<TipPos | null>(null);

  const open = pinned || hovering;

  const close = useCallback(() => {
    setPinned(false);
    setHovering(false);
  }, []);

  const measure = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setPos(clampTipBox(r, TIP_W, 120, vw, vh));
    requestAnimationFrame(() => {
      const tip = tipRef.current;
      if (!tip) return;
      const tr = tip.getBoundingClientRect();
      setPos(clampTipBox(r, tr.width || TIP_W, tr.height || 120, vw, vh));
    });
  }, []);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    measure();
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (btnRef.current?.contains(t)) return;
      if (tipRef.current?.contains(t)) return;
      close();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, close]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="sf-map-attrib-btn"
        aria-label="Map attribution"
        aria-describedby={open ? tipId : undefined}
        aria-expanded={open}
        title="Map credits"
        onMouseEnter={() => {
          if (canHoverOpen()) setHovering(true);
        }}
        onMouseLeave={() => setHovering(false)}
        onFocus={(e) => {
          if (e.currentTarget.matches(":focus-visible")) setHovering(true);
        }}
        onBlur={() => setHovering(false)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setPinned((p) => {
            if (p) {
              setHovering(false);
              return false;
            }
            return true;
          });
        }}
      >
        {/* Latin "i" only — ℹ / ℹ️ become squarish emoji on iOS */}
        <span aria-hidden className="sf-map-attrib-icon">
          i
        </span>
      </button>
      {pos &&
        createPortal(
          <div
            ref={tipRef}
            id={tipId}
            role="tooltip"
            className="fixed z-[1100] rounded-md border border-slate-600 bg-slate-900 px-3 py-2.5 text-left shadow-xl"
            style={{
              left: pos.left,
              top: pos.top,
              width: TIP_W,
              maxWidth: `calc(100vw - ${TIP_PAD * 2}px)`,
            }}
            onMouseEnter={() => {
              if (canHoverOpen()) setHovering(true);
            }}
            onMouseLeave={() => setHovering(false)}
          >
            <p className="text-[11px] leading-snug text-slate-300">
              <a
                className="text-sky-400 underline decoration-slate-600 underline-offset-2 hover:text-sky-300"
                href="https://leafletjs.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                Leaflet
              </a>
              {" — "}
              {basemapAttribution || "Map art © Coffee Stain Studios"}
              <span className="text-slate-500"> · community wiki basemap</span>
            </p>
          </div>,
          document.body,
        )}
    </>
  );
}

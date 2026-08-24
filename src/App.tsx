import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { MapView } from "@/components/map/MapView";
import { PlannerPanel } from "@/components/planner/PlannerPanel";
import { usePlanHash } from "@/hooks/usePlanHash";
import { useAppStore } from "@/store/useAppStore";

/** Default split — between half and two-thirds of the mobile viewport. */
const PANEL_DEFAULT = 0.6;
/** Slow-release below this → collapse (a sliver of sheet isn't useful). */
const PANEL_SNAP_COLLAPSE = 0.2;
/** Slow-release above this → fullscreen (a sliver of map isn't useful). */
const PANEL_SNAP_FULL = 0.8;
/** Finger speed that counts as a fling (px/s). */
const PANEL_FLING_PX_S = 1100;
const TAP_SLOP_PX = 12;

/** Desktop sidebar — identical in every mobile panel mode. */
const DESKTOP_PANEL =
  "md:flex md:h-full md:w-[22rem] md:max-h-none md:shrink-0 md:flex-col lg:w-[26rem]";

type DragSample = { t: number; y: number };

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * Finger-down is +Y. Fast up → 1 (fullscreen); fast down → 0 (collapsed).
 * Leaving fullscreen is sticky: any drag settles into the open range (≤80%),
 * not back to 100% — crossing 80% from below is what enters fullscreen.
 */
function settlePanelFrac(frac: number, velocityYPxPerS: number, startFrac: number): number {
  if (-velocityYPxPerS > PANEL_FLING_PX_S) return 1;
  if (velocityYPxPerS > PANEL_FLING_PX_S) return 0;
  if (frac <= PANEL_SNAP_COLLAPSE) return 0;
  if (startFrac >= 1) return Math.min(PANEL_SNAP_FULL, clamp01(frac));
  if (frac >= PANEL_SNAP_FULL) return 1;
  return clamp01(frac);
}

function velocityYPxPerS(samples: DragSample[]): number {
  if (samples.length < 2) return 0;
  const now = samples[samples.length - 1];
  let then = samples[0];
  for (let i = samples.length - 2; i >= 0; i--) {
    if (now.t - samples[i].t > 80) {
      then = samples[i];
      break;
    }
    then = samples[i];
  }
  const dt = now.t - then.t;
  if (dt < 8) return 0;
  return ((now.y - then.y) / dt) * 1000;
}

function panelLayoutKey(frac: number): string {
  if (frac <= 0) return "collapsed";
  if (frac >= 1) return "fullscreen";
  return `open:${Math.round(frac * 100)}`;
}

export default function App() {
  const loadGameData = useAppStore((s) => s.loadGameData);
  const dataReady = useAppStore((s) => s.dataReady);
  const error = useAppStore((s) => s.error);

  const shellRef = useRef<HTMLDivElement>(null);
  const lastOpenFrac = useRef(PANEL_DEFAULT);
  const [panelFrac, setPanelFrac] = useState(PANEL_DEFAULT);
  const [dragging, setDragging] = useState(false);
  const [fitKey, setFitKey] = useState(() => panelLayoutKey(PANEL_DEFAULT));

  const dragRef = useRef<{
    grabOffset: number;
    startY: number;
    startFrac: number;
    frac: number;
    samples: DragSample[];
    moved: boolean;
  } | null>(null);

  usePlanHash(200);

  useEffect(() => {
    void loadGameData();
  }, [loadGameData]);

  const collapsed = panelFrac <= 0 && !dragging;
  const fullscreen = panelFrac >= 1 && !dragging;

  function commitFrac(next: number) {
    const frac = clamp01(next);
    setPanelFrac(frac);
    setFitKey(panelLayoutKey(frac));
    if (frac > PANEL_SNAP_COLLAPSE && frac <= PANEL_SNAP_FULL) lastOpenFrac.current = frac;
  }

  function endDrag() {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (!drag) return;

    if (!drag.moved) {
      // Tap grabber: toggle fullscreen ↔ last split. Settings chip opens split.
      commitFrac(drag.startFrac > 0 && drag.startFrac < 1 ? 1 : lastOpenFrac.current);
      return;
    }
    commitFrac(settlePanelFrac(drag.frac, velocityYPxPerS(drag.samples), drag.startFrac));
  }

  function onPointerDown(e: PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    const shell = shellRef.current;
    if (!shell) return;
    const rect = shell.getBoundingClientRect();
    const panelTop = rect.bottom - panelFrac * rect.height;
    dragRef.current = {
      grabOffset: e.clientY - panelTop,
      startY: e.clientY,
      startFrac: panelFrac,
      frac: panelFrac,
      samples: [{ t: performance.now(), y: e.clientY }],
      moved: false,
    };
    setDragging(true);

    const onMove = (ev: globalThis.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const box = shellRef.current?.getBoundingClientRect();
      if (!box) return;
      if (Math.abs(ev.clientY - drag.startY) > TAP_SLOP_PX) drag.moved = true;
      const panelTopNow = ev.clientY - drag.grabOffset;
      const frac = clamp01((box.bottom - panelTopNow) / box.height);
      drag.frac = frac;
      drag.samples.push({ t: performance.now(), y: ev.clientY });
      if (drag.samples.length > 12) drag.samples.shift();
      setPanelFrac(frac);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      endDrag();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function onHandleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    let next: number | null = null;
    if (e.key === "Home") next = 1;
    else if (e.key === "End") next = 0;
    else if (e.key === "ArrowUp") next = Math.min(1, panelFrac + 0.1);
    else if (e.key === "ArrowDown")
      next = panelFrac >= 1 ? PANEL_SNAP_FULL : Math.max(0, panelFrac - 0.1);
    if (next == null) return;
    e.preventDefault();
    commitFrac(next);
  }

  const panelHeightVar = fullscreen
    ? "100%"
    : collapsed
      ? "0px"
      : dragging
        ? `max(2.25rem, ${panelFrac * 100}dvh)`
        : `${panelFrac * 100}dvh`;

  return (
    <div ref={shellRef} className="flex h-dvh w-full flex-col-reverse md:flex-row">
      {/*
        DOM order: panel then map. flex-col-reverse puts the map on top on
        mobile; md:flex-row keeps the panel on the left on desktop.
      */}
      <div
        className={
          collapsed
            ? `hidden ${DESKTOP_PANEL}`
            : `flex h-[var(--sf-panel-h)] min-h-0 shrink-0 flex-col ${DESKTOP_PANEL} ${
                dragging
                  ? ""
                  : "transition-[height] duration-300 ease-out motion-reduce:transition-none"
              }`
        }
        style={{ ["--sf-panel-h" as string]: panelHeightVar }}
      >
        <div
          className={
            fullscreen
              ? "shrink-0 border-b border-slate-800 bg-slate-900/95 pt-[env(safe-area-inset-top,0px)] md:hidden"
              : "shrink-0 border-t border-slate-800 bg-slate-900/95 md:hidden"
          }
        >
          <div
            role="slider"
            tabIndex={0}
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(panelFrac * 100)}
            aria-valuetext={
              panelFrac <= 0
                ? "Hidden"
                : panelFrac >= 1
                  ? "Fullscreen"
                  : `${Math.round(panelFrac * 100)} percent`
            }
            aria-label="Resize settings panel. Drag or fling up for fullscreen, down to hide. Tap to toggle fullscreen."
            title="Drag to resize"
            className="flex h-9 w-full cursor-ns-resize touch-none items-center justify-center select-none"
            onKeyDown={onHandleKeyDown}
            onPointerDown={onPointerDown}
          >
            <span className="h-1.5 w-12 rounded-full bg-slate-500" aria-hidden />
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <PlannerPanel />
        </div>
      </div>

      <main className="relative min-h-0 flex-1">
        {!dataReady && !error && (
          <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-slate-950 text-slate-400">
            Loading node & recipe data…
          </div>
        )}
        <MapView layoutKey={fitKey} dragging={dragging} />
        {collapsed && (
          <button
            type="button"
            className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 z-[1000] flex -translate-x-1/2 touch-none items-center gap-1.5 rounded-full border border-slate-600 bg-slate-900/95 px-4 py-2 text-sm font-medium text-slate-100 shadow-lg backdrop-blur-sm transition hover:border-slate-500 hover:bg-slate-800 md:hidden"
            aria-label="Show settings panel"
            onClick={() => commitFrac(lastOpenFrac.current)}
            onPointerDown={onPointerDown}
          >
            <ChevronUp className="h-4 w-4" aria-hidden />
            Settings
          </button>
        )}
      </main>
    </div>
  );
}

function ChevronUp({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M4 9.5 8 5.5 12 9.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

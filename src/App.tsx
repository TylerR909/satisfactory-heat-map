import { type ReactNode, useEffect, useState } from "react";
import { MapView } from "@/components/map/MapView";
import { PlannerPanel } from "@/components/planner/PlannerPanel";
import { usePlanHash } from "@/hooks/usePlanHash";
import { useAppStore } from "@/store/useAppStore";

/** Mobile sheet: split with map, full viewport, or hidden. Desktop ignores this. */
type MobilePanelMode = "open" | "fullscreen" | "collapsed";

/** Desktop sidebar — identical in every mobile panel mode. */
const DESKTOP_PANEL =
  "md:flex md:h-full md:w-[22rem] md:max-h-none md:shrink-0 md:flex-col lg:w-[26rem]";

function panelShellClass(mode: MobilePanelMode): string {
  switch (mode) {
    case "collapsed":
      return `hidden ${DESKTOP_PANEL}`;
    case "fullscreen":
      return `flex h-full min-h-0 shrink-0 flex-col ${DESKTOP_PANEL}`;
    default:
      // 60dvh sits between half and two-thirds of the mobile viewport.
      // Use dvh (not vh) so Safari chrome doesn't shrink the sheet vs the map.
      return `flex max-h-[60dvh] min-h-0 shrink-0 flex-col ${DESKTOP_PANEL}`;
  }
}

export default function App() {
  const loadGameData = useAppStore((s) => s.loadGameData);
  const dataReady = useAppStore((s) => s.dataReady);
  const error = useAppStore((s) => s.error);
  const [panelMode, setPanelMode] = useState<MobilePanelMode>("open");

  usePlanHash(200);

  useEffect(() => {
    void loadGameData();
  }, [loadGameData]);

  return (
    <div className="flex h-dvh w-full flex-col-reverse md:flex-row">
      {/*
        DOM order: panel then map. flex-col-reverse puts the map on top on
        mobile; md:flex-row keeps the panel on the left on desktop.
      */}
      <div className={panelShellClass(panelMode)}>
        {/* Chevron controls — mobile only; not a drag handle. */}
        <div
          className={
            panelMode === "fullscreen"
              ? "shrink-0 border-b border-slate-800 bg-slate-900/95 pt-[env(safe-area-inset-top,0px)] md:hidden"
              : "shrink-0 border-t border-slate-800 bg-slate-900/95 md:hidden"
          }
        >
          <div className="flex h-9 w-full items-center justify-center gap-2">
            {panelMode === "open" && (
              <PanelHandleButton
                onClick={() => setPanelMode("fullscreen")}
                ariaLabel="Expand settings to fullscreen"
                title="Fullscreen settings"
              >
                <ChevronUp className="h-4 w-4" />
              </PanelHandleButton>
            )}
            <PanelHandleButton
              onClick={() => setPanelMode(panelMode === "fullscreen" ? "open" : "collapsed")}
              ariaLabel={
                panelMode === "fullscreen"
                  ? "Shrink settings and show map"
                  : "Collapse settings and expand map"
              }
              title={panelMode === "fullscreen" ? "Show map" : "Expand map"}
            >
              <ChevronDown className="h-4 w-4" />
            </PanelHandleButton>
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <PlannerPanel />
        </div>
      </div>

      <main
        className={
          panelMode === "fullscreen"
            ? "relative min-h-0 flex-1 max-md:hidden"
            : "relative min-h-0 flex-1"
        }
      >
        {!dataReady && !error && (
          <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-slate-950 text-slate-400">
            Loading node & recipe data…
          </div>
        )}
        <MapView layoutKey={panelMode} />
        {panelMode === "collapsed" && (
          <button
            type="button"
            className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 z-[1000] flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-slate-600 bg-slate-900/95 px-4 py-2 text-sm font-medium text-slate-100 shadow-lg backdrop-blur-sm transition hover:border-slate-500 hover:bg-slate-800 md:hidden"
            onClick={() => setPanelMode("open")}
            aria-label="Show settings panel"
          >
            <ChevronUp className="h-4 w-4" aria-hidden />
            Settings
          </button>
        )}
      </main>
    </div>
  );
}

function PanelHandleButton({
  onClick,
  ariaLabel,
  title,
  children,
}: {
  onClick: () => void;
  ariaLabel: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="inline-flex h-7 w-11 items-center justify-center rounded-full border border-slate-600/70 bg-slate-950/60 text-slate-400 transition active:bg-slate-800 active:text-slate-200"
      onClick={onClick}
      aria-label={ariaLabel}
      title={title}
    >
      {children}
    </button>
  );
}

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M4 6.5 8 10.5 12 6.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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

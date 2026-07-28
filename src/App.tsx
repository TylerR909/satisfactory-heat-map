import { useEffect, useState } from "react";
import { MapView } from "@/components/map/MapView";
import { PlannerPanel } from "@/components/planner/PlannerPanel";
import { usePlanHash } from "@/hooks/usePlanHash";
import { useAppStore } from "@/store/useAppStore";

export default function App() {
  const loadGameData = useAppStore((s) => s.loadGameData);
  const dataReady = useAppStore((s) => s.dataReady);
  const error = useAppStore((s) => s.error);
  /** Mobile only: hide the settings sheet so the map can go full-viewport. */
  const [panelCollapsed, setPanelCollapsed] = useState(false);

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
      <div
        className={
          panelCollapsed
            ? "hidden md:flex md:h-full md:w-[22rem] md:max-h-none md:shrink-0 lg:w-[26rem]"
            : "flex max-h-[min(45vh,24rem)] shrink-0 flex-col md:max-h-none md:h-full md:w-[22rem] lg:w-[26rem]"
        }
      >
        {/* Collapse control — oval chevron button (not a drag handle). */}
        <div className="flex h-9 w-full shrink-0 items-center justify-center border-t border-slate-800 bg-slate-900/95 md:hidden">
          <button
            type="button"
            className="inline-flex h-7 w-11 items-center justify-center rounded-full border border-slate-600/70 bg-slate-950/60 text-slate-400 transition active:bg-slate-800 active:text-slate-200"
            onClick={() => setPanelCollapsed(true)}
            aria-label="Collapse settings and expand map"
            title="Expand map"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
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
        <MapView layoutKey={panelCollapsed ? "collapsed" : "open"} />
        {panelCollapsed && (
          <button
            type="button"
            className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 z-[1000] flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-slate-600 bg-slate-900/95 px-4 py-2 text-sm font-medium text-slate-100 shadow-lg backdrop-blur-sm transition hover:border-slate-500 hover:bg-slate-800 md:hidden"
            onClick={() => setPanelCollapsed(false)}
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

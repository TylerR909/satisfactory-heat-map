import { useEffect } from "react";
import { MapView } from "@/components/map/MapView";
import { PlannerPanel } from "@/components/planner/PlannerPanel";
import { usePlanHash } from "@/hooks/usePlanHash";
import { useAppStore } from "@/store/useAppStore";

export default function App() {
  const loadGameData = useAppStore((s) => s.loadGameData);
  const dataReady = useAppStore((s) => s.dataReady);
  const error = useAppStore((s) => s.error);

  usePlanHash(200);

  useEffect(() => {
    void loadGameData();
  }, [loadGameData]);

  return (
    <div className="flex h-dvh w-full flex-col md:flex-row">
      <div className="max-h-[45vh] shrink-0 md:max-h-none md:h-full md:w-[22rem] lg:w-[26rem]">
        <PlannerPanel />
      </div>
      <main className="relative min-h-0 flex-1">
        {!dataReady && !error && (
          <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-slate-950 text-slate-400">
            Loading node & recipe data…
          </div>
        )}
        <MapView />
      </main>
    </div>
  );
}

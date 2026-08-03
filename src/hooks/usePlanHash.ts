import { useEffect, useRef } from "react";
import { decodePlanHash, encodePlanHash, mapSeedsEqual, type PlanHashSource } from "@/lib/planHash";
import { getActiveSavedSeed, loadSeedLibrary, persistSeedLibrary } from "@/lib/savedSeeds";
import { useAppStore } from "@/store/useAppStore";

function pickPlanSource(): PlanHashSource {
  const s = useAppStore.getState();
  return {
    mode: s.mode,
    rawDemand: s.rawDemand,
    productTargets: s.productTargets,
    miner: s.miner,
    scoringMode: s.scoringMode,
    scoringOptions: s.scoringOptions,
    seed: s.seed,
    externalItems: s.externalItems,
  };
}

function writeHash(body: string) {
  const next = body ? `#${body}` : "";
  if (window.location.hash === next) return;
  // replaceState avoids flooding history while typing rates / dragging knobs
  const url = `${window.location.pathname}${window.location.search}${next}`;
  window.history.replaceState(null, "", url);
}

/**
 * Bidirectional sync: store plan fields ↔ `location.hash` (`#v1.<payload>`).
 *
 * - On load (after zustand rehydrate): hash wins if present.
 * - On store change: rewrite hash (debounced).
 * - On hashchange (back/forward / pasted edit): apply into store.
 */
export function usePlanHash(writeDebounceMs = 200) {
  const applyingHash = useRef(false);
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let unsubStore: (() => void) | undefined;
    let started = false;

    const applyHashString = (hash: string) => {
      const snap = decodePlanHash(hash);
      if (!snap) return false;
      applyingHash.current = true;

      // Shared URL: stay on active saved seed only if seed matches; else ephemeral
      const lib = loadSeedLibrary();
      const active = getActiveSavedSeed(lib);
      const hashSeed = snap.seed ?? null;
      if (active && mapSeedsEqual(active.seed, hashSeed)) {
        useAppStore.getState().applyPlanSnapshot(snap, { applySeed: true });
      } else if (active && !mapSeedsEqual(active.seed, hashSeed)) {
        // Ephemeral: clear active saved seed so we don't rewrite its shelf
        persistSeedLibrary({ ...lib, activeId: null });
        useAppStore.getState().applyPlanSnapshot(snap, { applySeed: true });
      } else {
        useAppStore.getState().applyPlanSnapshot(snap, { applySeed: true });
      }

      queueMicrotask(() => {
        applyingHash.current = false;
      });
      return true;
    };

    const onHashChange = () => {
      applyHashString(window.location.hash);
    };

    const startSync = () => {
      if (started) return;
      started = true;

      // Hash overrides localStorage when the user opened a shared link
      const hadHash = applyHashString(window.location.hash);
      if (!hadHash) {
        // Publish current (persisted) plan so the URL becomes shareable immediately
        writeHash(encodePlanHash(pickPlanSource()));
      }

      unsubStore = useAppStore.subscribe(() => {
        if (applyingHash.current) return;
        if (writeTimer.current) clearTimeout(writeTimer.current);
        writeTimer.current = setTimeout(() => {
          if (applyingHash.current) return;
          writeHash(encodePlanHash(pickPlanSource()));
        }, writeDebounceMs);
      });

      window.addEventListener("hashchange", onHashChange);
    };

    const stopSync = () => {
      unsubStore?.();
      unsubStore = undefined;
      window.removeEventListener("hashchange", onHashChange);
      if (writeTimer.current) clearTimeout(writeTimer.current);
    };

    const persistApi = useAppStore.persist;
    if (persistApi.hasHydrated()) {
      startSync();
      return stopSync;
    }

    const unsubHydrate = persistApi.onFinishHydration(() => {
      startSync();
    });
    return () => {
      unsubHydrate();
      stopSync();
    };
  }, [writeDebounceMs]);
}

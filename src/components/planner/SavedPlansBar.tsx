import {
  type FormEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { autoSaveSeed, commitSaveSeed, SeedPopover } from "@/components/planner/SeedPopover";
import { formatRate } from "@/lib/mining";
import { decodePlanHash, encodePlanHash, mapSeedsEqual, type PlanHashSource } from "@/lib/planHash";
import {
  buildSavedPlan,
  planSnapshotFromSaved,
  removePlan,
  type SavedPlan,
  upsertPlan,
} from "@/lib/savedPlans";
import {
  defaultNameForSeed,
  ensureDefaultSavedSeed,
  findSavedSeedByMapSeed,
  gcEmptyAutoNamed,
  getActiveSavedSeed,
  isMapSeedSaved,
  loadSeedLibrary,
  persistSeedLibrary,
  type SavedSeed,
  type SeedLibrary,
  subscribeSeedLibrary,
  upsertSavedSeed,
} from "@/lib/savedSeeds";
import { isDefaultSeed, randomMapSeed } from "@/lib/seed";
import { newLineId, useAppStore } from "@/store/useAppStore";
import { DEFAULT_SCORING_OPTIONS } from "@/types";

/**
 * Attach the right shelf for the current URL / empty library.
 * Seed button amber is derived later: any non-Default map seed.
 */
function resolveLibraryForSession(): SeedLibrary {
  let lib = loadSeedLibrary();
  const hashSnap = typeof window !== "undefined" ? decodePlanHash(window.location.hash) : null;

  if (hashSnap) {
    const hashSeed = hashSnap.seed ?? null;
    const active = getActiveSavedSeed(lib);
    if (active && mapSeedsEqual(active.seed, hashSeed)) {
      return lib;
    }
    const owned = findSavedSeedByMapSeed(lib, hashSeed);
    if (owned) {
      lib = { ...lib, activeId: owned.id };
      persistSeedLibrary(lib);
      return lib;
    }
    // Vanilla Default is always attachable
    if (hashSeed === null) {
      lib = ensureDefaultSavedSeed(lib);
      persistSeedLibrary(lib);
      return lib;
    }
    // Unsaved numeric seed → detach so plan chips don't rewrite a shelf
    if (lib.activeId) {
      lib = { ...lib, activeId: null };
      persistSeedLibrary(lib);
    }
    return lib;
  }

  // Normal visit: always sit on a shelf. Prefer existing active; else Default.
  if (!lib.activeId) {
    lib = ensureDefaultSavedSeed(lib);
    persistSeedLibrary(lib);
  }
  return lib;
}

/** Local chips prefer full snapshot; hash is fallback (imports / legacy). */
function snapFromPlan(plan: SavedPlan) {
  return planSnapshotFromSaved(plan, decodePlanHash);
}

const TIP_W = 224;
const TIP_PAD = 8;

/** Showcase HMF plan (Default world) under current string-product hash encoding. */
const HASH_PLACEHOLDER = "v1.CfpHAxARTW9kdWxhckZyYW1lSGVhdnkKAA";

type TipPos = { left: number; top: number };

function clampTipBox(anchor: DOMRect, boxW: number, boxH: number, vw: number, vh: number): TipPos {
  const width = Math.min(boxW, vw - TIP_PAD * 2);
  let left = anchor.left + anchor.width / 2 - width / 2;
  left = Math.min(vw - TIP_PAD - width, Math.max(TIP_PAD, left));

  const spaceBelow = vh - anchor.bottom - TIP_PAD;
  const spaceAbove = anchor.top - TIP_PAD;
  const placeBelow = spaceBelow >= boxH || spaceBelow >= spaceAbove;
  let top = placeBelow ? anchor.bottom + 6 : anchor.top - 6 - boxH;
  top = Math.min(vh - TIP_PAD - boxH, Math.max(TIP_PAD, top));

  return { left, top };
}

function planSourceFromStore(): PlanHashSource {
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
    recipeOverrides: s.recipeOverrides,
  };
}

function labelSourceFromStore() {
  const s = useAppStore.getState();
  return {
    mode: s.mode,
    rawDemand: s.rawDemand,
    productTargets: s.productTargets,
    items: s.items,
    recipes: s.recipes,
    externalItems: s.externalItems,
    recipeOverrides: s.recipeOverrides,
  };
}

function writeUrlHash(hashBody: string) {
  const next = hashBody ? `#${hashBody}` : "";
  if (window.location.hash === next) return;
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}${next}`,
  );
}

/**
 * Write the live store plan into the active saved seed's shelf (while seed is still current).
 * Creates a new chip when the shelf is empty or has no active plan id.
 */
function snapshotActiveIntoLibrary(lib: SeedLibrary): SeedLibrary {
  const active = getActiveSavedSeed(lib);
  if (!active) return lib;
  const id =
    active.activePlanId && active.plans.some((p) => p.id === active.activePlanId)
      ? active.activePlanId
      : null;
  const plan = buildSavedPlan(id, planSourceFromStore(), labelSourceFromStore());
  const shelf = upsertPlan({ plans: active.plans, activeId: active.activePlanId }, plan);
  const updated: SavedSeed = {
    ...active,
    plans: shelf.plans,
    activePlanId: shelf.activeId,
    updatedAt: Date.now(),
  };
  return upsertSavedSeed(lib, updated);
}

function startBlankBuild() {
  useAppStore.setState({
    mode: "product",
    productTargets: [
      {
        id: newLineId(),
        productId: "Desc_IronPlate_C",
        itemsPerMinute: 0,
      },
    ],
    scoringMode: useAppStore.getState().scoringMode,
    scoringOptions: {
      ...useAppStore.getState().scoringOptions,
      centerPower: DEFAULT_SCORING_OPTIONS.centerPower,
      topN: DEFAULT_SCORING_OPTIONS.topN,
      siteSepFraction: DEFAULT_SCORING_OPTIONS.siteSepFraction,
    },
    selectedSiteIndex: null,
    heatmap: null,
    error: null,
  });
  useAppStore.getState().recomputeActiveDemand();
}

/**
 * Compact multi-plan switcher scoped to the active saved seed + Seed control.
 */
export function SavedPlansBar() {
  const [library, setLibrary] = useState<SeedLibrary>(resolveLibraryForSession);
  /** Plan chips while detached from any named shelf (unsaved seed / Random). */
  const [ephemeralPlans, setEphemeralPlans] = useState<SavedPlan[]>([]);
  const [ephemeralActiveId, setEphemeralActiveId] = useState<string | null>(null);
  const skipPersistActive = useRef(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importValue, setImportValue] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const seedBtnRef = useRef<HTMLButtonElement>(null);
  const [seedOpen, setSeedOpen] = useState(false);
  const applyPlanSnapshot = useAppStore((s) => s.applyPlanSnapshot);
  const setSeed = useAppStore((s) => s.setSeed);
  const mapSeed = useAppStore((s) => s.seed);

  const activePt = getActiveSavedSeed(library);
  /** Detached from any named shelf (unsaved seed, or Random before Save). */
  const detached = library.activeId === null;
  /** Popover Save CTA: current map seed is not owned by any library entry. */
  const ephemeral = !isMapSeedSaved(library, mapSeed);
  /** Seed button highlight: any randomized world (not vanilla Default). */
  const nonDefaultMap = !isDefaultSeed(mapSeed);
  const plans = detached ? ephemeralPlans : (activePt?.plans ?? []);
  const activePlanId = detached ? ephemeralActiveId : (activePt?.activePlanId ?? null);

  const persistLib = useCallback((next: SeedLibrary) => {
    setLibrary(next);
    persistSeedLibrary(next);
  }, []);

  const snapshotActiveShelf = useCallback((): SeedLibrary => {
    return snapshotActiveIntoLibrary(loadSeedLibrary());
  }, []);

  // Keep React library state in sync when hash sync (or another path) writes storage.
  useEffect(() => {
    return subscribeSeedLibrary(() => {
      setLibrary(loadSeedLibrary());
    });
  }, []);

  // Keep active chip hash in sync when live plan changes (library only when activeId set)
  useEffect(() => {
    const unsub = useAppStore.subscribe(() => {
      if (skipPersistActive.current) return;
      const lib = loadSeedLibrary();
      if (!lib.activeId) return;
      const active = getActiveSavedSeed(lib);
      if (!active?.activePlanId) return;
      const updated = buildSavedPlan(
        active.activePlanId,
        planSourceFromStore(),
        labelSourceFromStore(),
      );
      const prev = active.plans.find((p) => p.id === active.activePlanId);
      if (prev && prev.hash === updated.hash && prev.abbrev === updated.abbrev) return;
      const shelf = upsertPlan({ plans: active.plans, activeId: active.activePlanId }, updated);
      persistLib(
        upsertSavedSeed(lib, {
          ...active,
          plans: shelf.plans,
          activePlanId: shelf.activeId,
          updatedAt: Date.now(),
        }),
      );
    });
    return unsub;
  }, [persistLib]);

  // On mount: if attached to a shelf, align store seed with that shelf
  useEffect(() => {
    const lib = loadSeedLibrary();
    const active = getActiveSavedSeed(lib);
    if (!active) return;
    const cur = useAppStore.getState().seed;
    if (mapSeedsEqual(cur, active.seed)) return;
    // Don't clobber an unsaved seed (shared link / Random) while detached
    if (lib.activeId === null) return;
    skipPersistActive.current = true;
    setSeed(active.seed);
    if (active.activePlanId) {
      const plan = active.plans.find((p) => p.id === active.activePlanId);
      if (plan) {
        const snap = snapFromPlan(plan);
        if (snap) applyPlanSnapshot(snap, { applySeed: false });
      }
    }
    queueMicrotask(() => {
      skipPersistActive.current = false;
    });
  }, [applyPlanSnapshot, setSeed]);

  useEffect(() => {
    if (!importOpen) return;
    const t = window.setTimeout(() => importInputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [importOpen]);

  const ensureSavedSeedForPlanSave = (): SeedLibrary | null => {
    let lib = loadSeedLibrary();
    if (lib.activeId) return snapshotActiveIntoLibrary(lib);
    // Detached (unsaved seed / Random): auto-save so + still works
    const mapSeed = useAppStore.getState().seed;
    const result = commitSaveSeed(lib, mapSeed, defaultNameForSeed(mapSeed), null);
    const pt = {
      ...result.saved,
      plans: ephemeralPlans,
      activePlanId: ephemeralActiveId,
    };
    lib = upsertSavedSeed(result.library, pt);
    persistLib(lib);
    setEphemeralPlans([]);
    setEphemeralActiveId(null);
    return lib;
  };

  /**
   * + button: always lock the current live plan as a chip, then start a blank
   * Iron Plate 0/min build as a new selected chip. Edits after this must not
   * rewrite the chip that was just locked (including the first save on a saved seed).
   */
  const onAdd = () => {
    let lib = ensureSavedSeedForPlanSave();
    if (!lib) return;

    skipPersistActive.current = true;

    // 1) Lock current live plan (BS, etc.) onto the shelf — creates chip if empty
    lib = snapshotActiveIntoLibrary(lib);
    const afterLock = getActiveSavedSeed(lib);
    if (!afterLock) {
      skipPersistActive.current = false;
      return;
    }

    // 2) Blank editor, then 3) new chip selected as active
    startBlankBuild();
    const fresh = buildSavedPlan(null, planSourceFromStore(), labelSourceFromStore());
    const withFresh = upsertPlan(
      { plans: afterLock.plans, activeId: afterLock.activePlanId },
      fresh,
    );
    persistLib(
      upsertSavedSeed(lib, {
        ...afterLock,
        plans: withFresh.plans,
        activePlanId: withFresh.activeId,
        updatedAt: Date.now(),
      }),
    );
    writeUrlHash(fresh.hash);
    queueMicrotask(() => {
      skipPersistActive.current = false;
    });
  };

  const selectPlan = (plan: SavedPlan) => {
    if (plan.id === activePlanId) return;

    const snap = snapFromPlan(plan);
    if (!snap) return;

    if (detached) {
      skipPersistActive.current = true;
      applyPlanSnapshot(snap, { applySeed: false });
      writeUrlHash(encodePlanHash(planSourceFromStore()));
      setEphemeralActiveId(plan.id);
      queueMicrotask(() => {
        skipPersistActive.current = false;
      });
      return;
    }

    // Snapshot current live plan into the *outgoing* chip before switching
    let lib = loadSeedLibrary();
    lib = snapshotActiveIntoLibrary(lib);
    const active = getActiveSavedSeed(lib);
    if (!active) return;

    // Re-read target plan from library (may have been refreshed only for active chip)
    const target = active.plans.find((p) => p.id === plan.id) ?? plan;
    const targetSnap = snapFromPlan(target);
    if (!targetSnap) return;

    skipPersistActive.current = true;
    // Chip select: demand/knobs only — keep saved seed seed
    applyPlanSnapshot(targetSnap, { applySeed: false });
    writeUrlHash(encodePlanHash(planSourceFromStore()));
    persistLib(
      upsertSavedSeed(lib, {
        ...active,
        activePlanId: plan.id,
        updatedAt: Date.now(),
      }),
    );
    queueMicrotask(() => {
      skipPersistActive.current = false;
    });
  };

  const deletePlan = (id: string, e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (detached) {
      const next = removePlan({ plans: ephemeralPlans, activeId: ephemeralActiveId }, id);
      setEphemeralPlans(next.plans);
      setEphemeralActiveId(next.activeId);
      if (next.activeId) {
        const plan = next.plans.find((p) => p.id === next.activeId);
        if (plan) {
          const snap = snapFromPlan(plan);
          if (snap) {
            skipPersistActive.current = true;
            applyPlanSnapshot(snap, { applySeed: false });
            writeUrlHash(encodePlanHash(planSourceFromStore()));
            queueMicrotask(() => {
              skipPersistActive.current = false;
            });
          }
        }
      }
      return;
    }

    const wasActive = activePlanId === id;
    let lib = loadSeedLibrary();
    const active = getActiveSavedSeed(lib);
    if (!active) return;
    const shelf = removePlan({ plans: active.plans, activeId: active.activePlanId }, id);
    const updated: SavedSeed = {
      ...active,
      plans: shelf.plans,
      activePlanId: shelf.activeId,
      updatedAt: Date.now(),
    };
    lib = upsertSavedSeed(lib, updated);
    persistLib(lib);

    if (wasActive && shelf.activeId) {
      const plan = shelf.plans.find((p) => p.id === shelf.activeId);
      if (plan) {
        const snap = snapFromPlan(plan);
        if (snap) {
          skipPersistActive.current = true;
          applyPlanSnapshot(snap, { applySeed: false });
          writeUrlHash(encodePlanHash(planSourceFromStore()));
          queueMicrotask(() => {
            skipPersistActive.current = false;
          });
        }
      }
    }
  };

  const openImport = () => {
    setImportValue("");
    setImportError(null);
    setImportOpen((v) => !v);
  };

  const onImportHash = (e: FormEvent) => {
    e.preventDefault();
    const raw = importValue.trim();
    if (!raw) {
      setImportError("Paste a plan hash (v1.…)");
      return;
    }

    let hashBody = raw;
    const hashIdx = raw.lastIndexOf("#");
    if (hashIdx >= 0) hashBody = raw.slice(hashIdx + 1);
    hashBody = hashBody.trim();

    const snap = decodePlanHash(hashBody);
    if (!snap) {
      setImportError("Not a valid plan hash.");
      return;
    }

    const hashSeed = snap.seed ?? null;
    const curSeed = useAppStore.getState().seed;

    // Matching current map seed + attached shelf → import onto that shelf
    if (mapSeedsEqual(hashSeed, curSeed) && library.activeId) {
      const lib = snapshotActiveIntoLibrary(loadSeedLibrary());
      const active = getActiveSavedSeed(lib);
      if (!active) return;
      skipPersistActive.current = true;
      applyPlanSnapshot(snap, { applySeed: false });
      const imported = buildSavedPlan(null, planSourceFromStore(), labelSourceFromStore());
      const plan: SavedPlan = { ...imported, hash: encodePlanHash(planSourceFromStore()) };
      const shelf = upsertPlan({ plans: active.plans, activeId: active.activePlanId }, plan);
      persistLib(
        upsertSavedSeed(lib, {
          ...active,
          plans: shelf.plans,
          activePlanId: shelf.activeId,
          updatedAt: Date.now(),
        }),
      );
      writeUrlHash(plan.hash);
      setImportOpen(false);
      setImportValue("");
      setImportError(null);
      queueMicrotask(() => {
        skipPersistActive.current = false;
      });
      return;
    }

    // Seed already in library (or Default) → attach + import chip
    let lib = loadSeedLibrary();
    let owned = findSavedSeedByMapSeed(lib, hashSeed);
    if (!owned && hashSeed === null) {
      lib = ensureDefaultSavedSeed(lib);
      owned = getActiveSavedSeed(lib);
    }
    if (owned) {
      if (lib.activeId && lib.activeId !== owned.id) lib = snapshotActiveIntoLibrary(lib);
      lib = { ...lib, activeId: owned.id };
      const active = getActiveSavedSeed(lib) ?? owned;
      skipPersistActive.current = true;
      applyPlanSnapshot(snap, { applySeed: true });
      const imported = buildSavedPlan(null, planSourceFromStore(), labelSourceFromStore());
      const plan: SavedPlan = { ...imported, hash: encodePlanHash(planSourceFromStore()) };
      const shelf = upsertPlan({ plans: active.plans, activeId: active.activePlanId }, plan);
      persistLib(
        upsertSavedSeed(lib, {
          ...active,
          plans: shelf.plans,
          activePlanId: shelf.activeId,
          updatedAt: Date.now(),
        }),
      );
      writeUrlHash(plan.hash);
      setImportOpen(false);
      setImportValue("");
      setImportError(null);
      setEphemeralPlans([]);
      setEphemeralActiveId(null);
      queueMicrotask(() => {
        skipPersistActive.current = false;
      });
      return;
    }

    // Numeric seed not in library → detach (amber derives from unsaved seed)
    if (lib.activeId) {
      lib = snapshotActiveIntoLibrary(lib);
      lib = { ...lib, activeId: null };
      lib = gcEmptyAutoNamed(lib);
      persistLib(lib);
    }

    skipPersistActive.current = true;
    applyPlanSnapshot(snap, { applySeed: true });
    const imported = buildSavedPlan(null, planSourceFromStore(), labelSourceFromStore());
    const plan: SavedPlan = { ...imported, hash: hashBody };
    setEphemeralPlans([plan]);
    setEphemeralActiveId(plan.id);
    writeUrlHash(hashBody);
    setImportOpen(false);
    setImportValue("");
    setImportError(null);
    queueMicrotask(() => {
      skipPersistActive.current = false;
    });
  };

  const onPasteSeed = (pasted: number) => {
    skipPersistActive.current = true;
    let lib = loadSeedLibrary();
    if (lib.activeId) {
      lib = snapshotActiveIntoLibrary(lib);
      lib = gcEmptyAutoNamed({ ...lib, activeId: null });
    }
    setSeed(pasted);
    const { library: next } = autoSaveSeed(lib, pasted);
    persistLib(next);
    setEphemeralPlans([]);
    setEphemeralActiveId(null);
    writeUrlHash(encodePlanHash(planSourceFromStore()));
    queueMicrotask(() => {
      skipPersistActive.current = false;
    });
  };

  /** Detach from the active shelf (plan chips leave the named shelf). */
  const leaveActiveShelfDetached = () => {
    let lib = loadSeedLibrary();
    if (lib.activeId) {
      lib = snapshotActiveIntoLibrary(lib);
      lib = gcEmptyAutoNamed({ ...lib, activeId: null });
      persistLib(lib);
    }
  };

  const onRandomSeed = () => {
    skipPersistActive.current = true;
    leaveActiveShelfDetached();
    setSeed(randomMapSeed());
    setEphemeralPlans([]);
    setEphemeralActiveId(null);
    // Random is temporary until Save — amber until this seed is in the library.
    writeUrlHash(encodePlanHash(planSourceFromStore()));
    queueMicrotask(() => {
      skipPersistActive.current = false;
    });
  };

  const onDefaultMap = () => {
    skipPersistActive.current = true;
    let lib = loadSeedLibrary();
    if (lib.activeId) {
      lib = snapshotActiveIntoLibrary(lib);
    }
    lib = ensureDefaultSavedSeed(lib);
    lib = gcEmptyAutoNamed(lib, lib.activeId);
    lib = ensureDefaultSavedSeed(lib);
    const def = getActiveSavedSeed(lib);
    persistLib(lib);
    setSeed(null);
    setEphemeralPlans([]);
    setEphemeralActiveId(null);
    // Restore Default shelf's active plan when present; otherwise keep live demand.
    if (def?.activePlanId) {
      const plan = def.plans.find((p) => p.id === def.activePlanId);
      if (plan) {
        const snap = snapFromPlan(plan);
        if (snap) applyPlanSnapshot(snap, { applySeed: false });
      }
    }
    writeUrlHash(encodePlanHash(planSourceFromStore()));
    queueMicrotask(() => {
      skipPersistActive.current = false;
    });
  };

  const onSaveSeed = (name: string) => {
    let lib = loadSeedLibrary();
    if (lib.activeId) {
      lib = snapshotActiveIntoLibrary(lib);
    }
    const mapSeed = useAppStore.getState().seed;
    const desired = name.trim() || defaultNameForSeed(mapSeed);
    const active = getActiveSavedSeed(lib);
    // Update in place only when re-saving the *same named* active shelf.
    // Same map seed + a different name (e.g. two Defaults: "Test A" then "Test B")
    // must create a new Saved Seed — not rename/overwrite the first.
    const existing =
      active &&
      !detached &&
      mapSeedsEqual(active.seed, mapSeed) &&
      active.name.toLowerCase() === desired.toLowerCase()
        ? active
        : null;
    const result = commitSaveSeed(lib, mapSeed, desired, existing);
    let pt = result.saved;
    if (!existing && ephemeralPlans.length > 0) {
      pt = {
        ...pt,
        plans: ephemeralPlans,
        activePlanId: ephemeralActiveId,
      };
    }
    persistLib(upsertSavedSeed(result.library, pt));
    setEphemeralPlans([]);
    setEphemeralActiveId(null);
  };

  const onSelectSavedSeed = (pt: SavedSeed, opts?: { keepOpen?: boolean }) => {
    const lib0 = loadSeedLibrary();
    if (pt.id === lib0.activeId) {
      if (!opts?.keepOpen) setSeedOpen(false);
      return;
    }

    skipPersistActive.current = true;
    // 1–3: snapshot A while seed still A's
    let lib = snapshotActiveIntoLibrary(lib0);
    lib = gcEmptyAutoNamed(lib, pt.id);
    // 4: activeId = B
    lib = { ...lib, activeId: pt.id };
    persistLib(lib);
    // 5: setSeed B
    setSeed(pt.seed);
    // 6: apply B's active plan without re-applying seed from hash
    if (pt.activePlanId) {
      const plan = pt.plans.find((p) => p.id === pt.activePlanId);
      if (plan) {
        const snap = snapFromPlan(plan);
        if (snap) {
          applyPlanSnapshot(snap, { applySeed: false });
          writeUrlHash(encodePlanHash(planSourceFromStore()));
        }
      }
    } else {
      writeUrlHash(encodePlanHash(planSourceFromStore()));
    }
    setEphemeralPlans([]);
    setEphemeralActiveId(null);
    if (!opts?.keepOpen) setSeedOpen(false);
    queueMicrotask(() => {
      skipPersistActive.current = false;
    });
  };

  const iconBtn =
    "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-700 bg-slate-900 text-slate-400 transition hover:border-slate-500 hover:bg-slate-800 hover:text-slate-200";

  return (
    <section className="space-y-1.5">
      {/* Header: label left, Seed pinned right — chips wrap on the row below */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 text-[10px] font-medium tracking-wide text-slate-500 uppercase">
          Plans
          {plans.length > 0 && (
            <span className="font-normal normal-case text-slate-600"> ({plans.length})</span>
          )}
        </div>
        <button
          ref={seedBtnRef}
          type="button"
          onClick={() => setSeedOpen((v) => !v)}
          title={
            nonDefaultMap
              ? `Map seed ${mapSeed} (not Default) — click to change`
              : "Map seed (Default world)"
          }
          aria-label={
            nonDefaultMap ? `Map seed ${mapSeed}, not Default` : "Map seed, Default world"
          }
          aria-expanded={seedOpen}
          className={`inline-flex h-8 shrink-0 items-center justify-center rounded-md border px-2.5 text-xs font-medium transition ${
            nonDefaultMap
              ? seedOpen
                ? "border-amber-400 bg-amber-500/30 text-amber-100 ring-1 ring-amber-400/50"
                : "border-amber-500/70 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
              : seedOpen
                ? "border-slate-500 bg-slate-800 text-slate-200"
                : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500 hover:bg-slate-800 hover:text-slate-200"
          }`}
        >
          Seed
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {plans.map((plan) => (
          <PlanChip
            key={plan.id}
            plan={plan}
            active={plan.id === activePlanId}
            onSelect={() => selectPlan(plan)}
            onDelete={(e) => deletePlan(plan.id, e)}
          />
        ))}
        <button
          type="button"
          onClick={onAdd}
          title="Save current & start a new plan"
          aria-label="Save current and start a new plan"
          className={iconBtn}
        >
          <PlusIcon />
        </button>
        <button
          type="button"
          onClick={openImport}
          title="Import plan hash"
          aria-label="Import plan hash"
          aria-expanded={importOpen}
          className={`${iconBtn} ${importOpen ? "border-slate-500 bg-slate-800 text-slate-200" : ""}`}
        >
          <ImportIcon />
        </button>
      </div>

      <SeedPopover
        open={seedOpen}
        onClose={() => setSeedOpen(false)}
        anchorRef={seedBtnRef}
        library={library}
        onLibraryChange={persistLib}
        snapshotActiveShelf={snapshotActiveShelf}
        ephemeral={ephemeral}
        onSaveSeed={onSaveSeed}
        onPasteSeed={onPasteSeed}
        onRandomSeed={onRandomSeed}
        onDefaultMap={onDefaultMap}
        onSelectSavedSeed={onSelectSavedSeed}
      />

      {importOpen && (
        <form
          onSubmit={onImportHash}
          className="rounded-md border border-slate-700 bg-slate-900/80 p-2 space-y-1.5"
        >
          <div className="flex gap-1.5">
            <label className="min-w-0 flex-1 space-y-1">
              <span className="block text-[10px] font-medium tracking-wide text-slate-500 uppercase">
                Paste plan hash
              </span>
              <input
                ref={importInputRef}
                type="text"
                value={importValue}
                onChange={(ev) => {
                  setImportValue(ev.target.value);
                  if (importError) setImportError(null);
                }}
                placeholder={HASH_PLACEHOLDER}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={importError ? true : undefined}
                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-[11px] text-slate-200 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none"
              />
            </label>
            <button
              type="submit"
              className="mt-auto shrink-0 rounded-md bg-amber-500 px-2.5 py-1.5 text-xs font-medium text-slate-950 hover:bg-amber-400"
            >
              Load
            </button>
          </div>
          {importError && <p className="text-[11px] text-red-400">{importError}</p>}
        </form>
      )}
    </section>
  );
}

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="stroke-current"
    >
      <path d="M8 3v10M3 8h10" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="stroke-current"
    >
      <path
        d="M8 2v7M5.5 6.5 8 9l2.5-2.5"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 10.5V12a1.5 1.5 0 0 0 1.5 1.5h7A1.5 1.5 0 0 0 13 12v-1.5"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlanChip({
  plan,
  active,
  onSelect,
  onDelete,
}: {
  plan: SavedPlan;
  active: boolean;
  onSelect: () => void;
  onDelete: (e: MouseEvent) => void;
}) {
  const tipId = useId();
  const tipRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [tipPos, setTipPos] = useState<TipPos | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const showTip = () => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    tipTimer.current = setTimeout(() => {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setTipPos(clampTipBox(r, TIP_W, 120, vw, vh));
      setHover(true);

      requestAnimationFrame(() => {
        const tip = tipRef.current;
        if (!tip) return;
        const tr = tip.getBoundingClientRect();
        setTipPos(clampTipBox(r, tr.width || TIP_W, tr.height || 120, vw, vh));
      });
    }, 280);
  };

  const hideTip = () => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    setHover(false);
    setTipPos(null);
  };

  useEffect(
    () => () => {
      if (tipTimer.current) clearTimeout(tipTimer.current);
    },
    [],
  );

  return (
    <div className="group relative">
      <button
        ref={btnRef}
        type="button"
        onClick={onSelect}
        onMouseEnter={showTip}
        onMouseLeave={hideTip}
        onFocus={showTip}
        onBlur={hideTip}
        aria-pressed={active}
        aria-describedby={hover ? tipId : undefined}
        className={`inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 font-mono text-xs font-semibold tracking-wide transition ${
          active
            ? "bg-amber-500 text-slate-950 ring-1 ring-amber-300"
            : "bg-slate-900 text-slate-300 ring-1 ring-slate-700 hover:bg-slate-800 hover:text-white"
        }`}
      >
        {plan.abbrev}
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${plan.title}`}
        className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-800 text-[10px] leading-none text-slate-400 opacity-0 ring-1 ring-slate-600 transition group-hover:opacity-100 focus:opacity-100 hover:bg-red-950 hover:text-red-300 hover:ring-red-800"
      >
        ×
      </button>
      {hover &&
        tipPos &&
        createPortal(
          <div
            ref={tipRef}
            id={tipId}
            role="tooltip"
            className="pointer-events-none fixed z-[10000] rounded-md border border-slate-600 bg-slate-900 px-2.5 py-2 text-left text-[11px] leading-snug text-slate-200 shadow-xl"
            style={{
              left: tipPos.left,
              top: tipPos.top,
              width: TIP_W,
              maxWidth: `calc(100vw - ${TIP_PAD * 2}px)`,
            }}
          >
            <div className="font-medium text-slate-100">{plan.title}</div>
            <div className="mt-0.5 text-[10px] text-slate-500">
              {plan.mode === "product" ? "Products" : "Raw resources"}
            </div>
            <ul className="mt-1.5 space-y-0.5 border-t border-slate-800 pt-1.5">
              {plan.lines.map((l) => (
                <li key={`in-${l.label}`} className="flex justify-between gap-2">
                  <span className="truncate text-slate-300">{l.label}</span>
                  <span className="shrink-0 font-mono text-slate-400">
                    {formatRate(l.rate)}/min
                  </span>
                </li>
              ))}
            </ul>
            {plan.demand.length > 0 && (
              <>
                <div className="mt-2 text-[10px] font-medium tracking-wide text-slate-500 uppercase">
                  Raw demand
                </div>
                <ul className="mt-1 space-y-0.5">
                  {plan.demand.map((d) => (
                    <li key={`d-${d.label}`} className="flex justify-between gap-2">
                      <span className="truncate text-slate-400">{d.label}</span>
                      <span className="shrink-0 font-mono text-slate-500">
                        {formatRate(d.rate)}/min
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

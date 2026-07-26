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
import { formatRate } from "@/lib/mining";
import { decodePlanHash, type PlanHashSource } from "@/lib/planHash";
import {
  buildSavedPlan,
  loadSavedPlansState,
  persistSavedPlansState,
  removePlan,
  type SavedPlan,
  type SavedPlansState,
  upsertPlan,
} from "@/lib/savedPlans";
import { newLineId, useAppStore } from "@/store/useAppStore";
import { DEFAULT_SCORING_OPTIONS } from "@/types";

const TIP_W = 224;
const TIP_PAD = 8;

/** Showcase HMF plan hash (default product seed). */
const HASH_PLACEHOLDER = "v1.CfpHBhAfHgA";

type TipPos = { left: number; top: number };

/** Clamp a fixed tooltip box to the viewport (left/top = box origin, no centering transform). */
function clampTipBox(anchor: DOMRect, boxW: number, boxH: number, vw: number, vh: number): TipPos {
  const width = Math.min(boxW, vw - TIP_PAD * 2);
  // Prefer centered on anchor, then clamp so the full box stays on-screen
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

function snapshotLivePlan(state: SavedPlansState): SavedPlansState {
  const id =
    state.activeId && state.plans.some((p) => p.id === state.activeId) ? state.activeId : null;
  const plan = buildSavedPlan(id, planSourceFromStore(), labelSourceFromStore());
  return upsertPlan(state, plan);
}

/** Fresh product build — not the app's HMF showcase default. */
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
    // keep rawDemand as secondary tab content
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
 * Compact multi-plan switcher: chips + add/import.
 * Each plan stores the same computation hash as the URL.
 */
export function SavedPlansBar() {
  const [state, setState] = useState<SavedPlansState>(() => loadSavedPlansState());
  const skipPersistActive = useRef(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importValue, setImportValue] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const applyPlanSnapshot = useAppStore((s) => s.applyPlanSnapshot);

  const persist = useCallback((next: SavedPlansState) => {
    setState(next);
    persistSavedPlansState(next);
  }, []);

  // Keep the active chip’s hash in sync when the live plan changes
  useEffect(() => {
    const unsub = useAppStore.subscribe(() => {
      if (skipPersistActive.current) return;
      const { activeId, plans } = loadSavedPlansState();
      if (!activeId || plans.length === 0) return;
      const updated = buildSavedPlan(activeId, planSourceFromStore(), labelSourceFromStore());
      const prev = plans.find((p) => p.id === activeId);
      if (prev && prev.hash === updated.hash && prev.abbrev === updated.abbrev) return;
      persist(upsertPlan({ plans, activeId }, updated));
    });
    return unsub;
  }, [persist]);

  useEffect(() => {
    if (!importOpen) return;
    const t = window.setTimeout(() => importInputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [importOpen]);

  /**
   * + button:
   * - No builds yet → save current only (stay on it; one chip). Never inject a second plan.
   * - Already have builds → shelf current, start a blank Iron Plate 0/min build, select that chip.
   */
  const onAdd = () => {
    // localStorage is source of truth (avoids stale React state after prior saves)
    const shelf = loadSavedPlansState();
    let next = snapshotLivePlan(shelf);

    if (shelf.plans.length === 0) {
      // First save: one chip for the live plan, remain selected on it
      persist(next);
      writeUrlHash(next.plans[0]?.hash ?? "");
      return;
    }

    skipPersistActive.current = true;
    startBlankBuild();
    const fresh = buildSavedPlan(null, planSourceFromStore(), labelSourceFromStore());
    next = upsertPlan(next, fresh);
    persist(next);
    writeUrlHash(fresh.hash);
    queueMicrotask(() => {
      skipPersistActive.current = false;
    });
  };

  const selectPlan = (plan: SavedPlan) => {
    if (plan.id === state.activeId) return;

    let next = loadSavedPlansState();
    if (next.activeId) {
      next = snapshotLivePlan(next);
    }

    const snap = decodePlanHash(plan.hash);
    if (!snap) return;

    skipPersistActive.current = true;
    applyPlanSnapshot(snap);
    writeUrlHash(plan.hash);
    persist({ ...next, activeId: plan.id });
    queueMicrotask(() => {
      skipPersistActive.current = false;
    });
  };

  const deletePlan = (id: string, e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const wasActive = state.activeId === id;
    const next = removePlan(loadSavedPlansState(), id);
    persist(next);

    if (wasActive && next.activeId) {
      const plan = next.plans.find((p) => p.id === next.activeId);
      if (plan) {
        const snap = decodePlanHash(plan.hash);
        if (snap) {
          skipPersistActive.current = true;
          applyPlanSnapshot(snap);
          writeUrlHash(plan.hash);
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

    // Accept bare hash, #hash, or a full URL containing #v1.…
    let hashBody = raw;
    const hashIdx = raw.lastIndexOf("#");
    if (hashIdx >= 0) hashBody = raw.slice(hashIdx + 1);
    hashBody = hashBody.trim();

    const snap = decodePlanHash(hashBody);
    if (!snap) {
      setImportError("Not a valid plan hash.");
      return;
    }

    const shelf = loadSavedPlansState();
    // Shelf live plan first if we already have builds (or an active chip)
    let next = shelf.plans.length > 0 || shelf.activeId ? snapshotLivePlan(shelf) : shelf;

    skipPersistActive.current = true;
    applyPlanSnapshot(snap);
    const imported = buildSavedPlan(null, planSourceFromStore(), labelSourceFromStore());
    // Keep the shared hash body on the chip (decode/encode is stable for valid pastes)
    const plan: SavedPlan = { ...imported, hash: hashBody };
    next = upsertPlan(next, plan);
    persist(next);
    writeUrlHash(plan.hash);
    setImportOpen(false);
    setImportValue("");
    setImportError(null);
    queueMicrotask(() => {
      skipPersistActive.current = false;
    });
  };

  const iconBtn =
    "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-700 bg-slate-900 text-slate-400 transition hover:border-slate-500 hover:bg-slate-800 hover:text-slate-200";

  return (
    <section className="space-y-1.5">
      {state.plans.length > 0 && (
        <div className="flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-slate-500 uppercase">
          Heatmaps
          <span className="font-normal normal-case text-slate-600">({state.plans.length})</span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {state.plans.map((plan) => (
          <PlanChip
            key={plan.id}
            plan={plan}
            active={plan.id === state.activeId}
            onSelect={() => selectPlan(plan)}
            onDelete={(e) => deletePlan(plan.id, e)}
          />
        ))}
        <button
          type="button"
          onClick={onAdd}
          title={
            state.plans.length === 0 ? "Save current heatmap" : "Save current & start new heatmap"
          }
          aria-label={
            state.plans.length === 0 ? "Save current heatmap" : "Save current and start new heatmap"
          }
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

/** Tray with arrow from above into the box (import). */
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
      // Initial estimate before measuring real tip height
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
                  Active raw demand
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

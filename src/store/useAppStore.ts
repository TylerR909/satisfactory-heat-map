import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  clampHeatRender,
  DEFAULT_HEAT_RENDER,
  type HeatRenderOptions,
} from "@/lib/heatmap/heatRender";
import type { PlanSnapshot } from "@/lib/planHash";
import { canonicalizeProductId } from "@/lib/productIdAliases";
import { DEFAULT_EXTERNAL_ITEM_IDS, solveProductsToRaw } from "@/lib/production/solve";
import { RAW_RESOURCE_OPTIONS } from "@/lib/resources";
import { clearNodeSeedCache, getNodesForSeed, type MapSeed } from "@/lib/seed";
import type {
  HeatmapResult,
  InputMode,
  ItemDef,
  MapMeta,
  MinerSettings,
  OpenWaterData,
  ProductTargetLine,
  RawDemand,
  RawDemandLine,
  Recipe,
  ResourceNode,
  ScoringMode,
  ScoringOptions,
  SiteScore,
} from "@/types";
import { DEFAULT_HEAT_OPACITY, DEFAULT_MINER_SETTINGS, DEFAULT_SCORING_OPTIONS } from "@/types";

let lineId = 0;
export function newLineId(): string {
  lineId += 1;
  return `line-${lineId}-${Date.now()}`;
}

/** Mode B expand row: on-site intermediate or off-site (external) input. */
export type ExpansionRow = {
  itemId: string;
  itemsPerMinute: number;
  /** True when this item is treated as imported / not expanded into map raws. */
  external: boolean;
};

export type AppState = {
  mode: InputMode;
  rawDemand: RawDemandLine[];
  /** Mode B: one or more co-located product targets (rates stack). */
  productTargets: ProductTargetLine[];
  /**
   * Mode B: item ids treated as off-site (stop expand / omit from heatmap).
   * Crafted intermediates + Water. Share-hash + plan intent.
   */
  externalItems: string[];
  miner: MinerSettings;
  scoringMode: ScoringMode;
  scoringOptions: ScoringOptions;
  /** Display-only heat paint (not in URL hash). */
  heatRender: HeatRenderOptions;
  heatPaintOpen: boolean;
  extractorsOpen: boolean;
  advancedOpen: boolean;
  /** Mode B Expansion accordion (off-site intermediate toggles). */
  expansionOpen: boolean;
  heatOpacity: number;
  showNodes: boolean;
  selectedSiteIndex: number | null;
  activeDemand: RawDemand[];
  /**
   * Mode B: intermediates from the last expand (on-site + external), for the
   * Resource Toggle UI. Empty in raw mode.
   */
  expansionRows: ExpansionRow[];
  heatmap: HeatmapResult | null;
  /**
   * Last main-thread canvas PNG bake for the heat overlay (not part of badge ms).
   * Ephemeral — not persisted.
   */
  lastRasterizeMs: number | null;
  computing: boolean;
  error: string | null;
  /** Vanilla slot template (positions + default types/purities). */
  baseSlots: ResourceNode[];
  /** null = Default/vanilla; number (incl. 0) = randomized map seed. */
  seed: MapSeed;
  /** Effective nodes for map + heatmap (cached from baseSlots + seed). */
  nodes: ResourceNode[];
  /** Basemap open-water bodies (map:generate); null until load. */
  openWater: OpenWaterData | null;
  items: Record<string, ItemDef>;
  recipes: Recipe[];
  meta: MapMeta | null;
  dataReady: boolean;

  setMode: (mode: InputMode) => void;
  setRawDemand: (d: RawDemandLine[]) => void;
  updateRawLine: (id: string, patch: Partial<RawDemand>) => void;
  addRawLine: () => void;
  removeRawLine: (id: string) => void;
  updateProductLine: (id: string, patch: Partial<Omit<ProductTargetLine, "id">>) => void;
  addProductLine: () => void;
  removeProductLine: (id: string) => void;
  /** Mark / unmark an Expansion item as off-site for Mode B expand (incl. Water). */
  setItemExternal: (itemId: string, external: boolean) => void;
  setMiner: (m: Partial<MinerSettings>) => void;
  setScoringMode: (mode: ScoringMode) => void;
  setScoringOptions: (patch: Partial<ScoringOptions>) => void;
  setHeatRender: (patch: Partial<HeatRenderOptions>) => void;
  setHeatPaintOpen: (v: boolean) => void;
  setExtractorsOpen: (v: boolean) => void;
  setAdvancedOpen: (v: boolean) => void;
  setExpansionOpen: (v: boolean) => void;
  setHeatOpacity: (n: number) => void;
  setShowNodes: (v: boolean) => void;
  setSelectedSiteIndex: (i: number | null) => void;
  setHeatmap: (h: HeatmapResult | null) => void;
  setLastRasterizeMs: (ms: number | null) => void;
  setComputing: (v: boolean) => void;
  setError: (e: string | null) => void;
  /** Reset heat/site knobs (+ opacity) to factory defaults. */
  resetKnobs: () => void;
  /**
   * Reset extractors, scoring modes, and knobs — keeps mode, raw demand, and
   * product targets as the user left them.
   */
  resetAllDefaults: () => void;
  /** Expand current product targets into raw demand lines and switch to raw mode. */
  sendProductsToRaw: () => void;
  /**
   * Replace shareable plan fields from a decoded URL hash / saved plan.
   * Does not touch baseSlots / recipes / meta.
   * @param options.applySeed when false, keep current seed (chip select within a saved seed).
   */
  applyPlanSnapshot: (snap: PlanSnapshot, options?: { applySeed?: boolean }) => void;
  /** Set map seed and recompute effective nodes from cache. */
  setSeed: (seed: MapSeed) => void;
  loadGameData: () => Promise<void>;
  recomputeActiveDemand: () => void;
  selectSite: (site: SiteScore | null, index: number | null) => void;
};

function recompute(
  state: Pick<
    AppState,
    "mode" | "rawDemand" | "productTargets" | "externalItems" | "items" | "recipes"
  >,
): { demand: RawDemand[]; expansionRows: ExpansionRow[] } {
  if (state.mode === "raw") {
    return {
      demand: state.rawDemand
        .filter((d) => d.itemsPerMinute > 0 && d.resource)
        .map(({ resource, itemsPerMinute }) => ({ resource, itemsPerMinute })),
      expansionRows: [],
    };
  }
  const targets = state.productTargets
    .filter((t) => t.productId && t.itemsPerMinute > 0)
    .map((t) => ({ productId: t.productId, itemsPerMinute: t.itemsPerMinute }));
  if (targets.length === 0) return { demand: [], expansionRows: [] };
  const { demand, expansion } = solveProductsToRaw(targets, state.recipes, state.items, {
    externalItems: state.externalItems,
  });
  // Solver already orders deep → … → direct inputs → targets (min-depth merge)
  const expansionRows: ExpansionRow[] = expansion.map((e) => ({
    itemId: e.itemId,
    itemsPerMinute: e.itemsPerMinute,
    external: e.external,
  }));
  return { demand, expansionRows };
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // First-time defaults: showcase Mode B with a multi-raw HMF plan
      mode: "product",
      rawDemand: [
        { id: "seed-oil", resource: "Desc_LiquidOil_C", itemsPerMinute: 600 },
        { id: "seed-coal", resource: "Desc_Coal_C", itemsPerMinute: 300 },
        { id: "seed-sulfur", resource: "Desc_Sulfur_C", itemsPerMinute: 200 },
      ],
      productTargets: [
        {
          id: "seed-hmf",
          productId: "Desc_ModularFrameHeavy_C",
          itemsPerMinute: 10,
        },
      ],
      // Packaging vessels: fair default for packaged recipes (user can re-enable)
      externalItems: [...DEFAULT_EXTERNAL_ITEM_IDS],
      miner: { ...DEFAULT_MINER_SETTINGS },
      scoringMode: "centered",
      scoringOptions: { ...DEFAULT_SCORING_OPTIONS },
      heatRender: { ...DEFAULT_HEAT_RENDER },
      heatPaintOpen: false,
      extractorsOpen: false,
      advancedOpen: false,
      expansionOpen: false,
      heatOpacity: DEFAULT_HEAT_OPACITY,
      showNodes: true,
      selectedSiteIndex: null,
      activeDemand: [],
      expansionRows: [],
      heatmap: null,
      lastRasterizeMs: null,
      computing: false,
      error: null,
      baseSlots: [],
      seed: null,
      nodes: [],
      openWater: null,
      items: {},
      recipes: [],
      meta: null,
      dataReady: false,

      setMode: (mode) => {
        set({ mode });
        get().recomputeActiveDemand();
      },
      setRawDemand: (rawDemand) => {
        set({ rawDemand });
        get().recomputeActiveDemand();
      },
      updateRawLine: (id, patch) => {
        const rawDemand = get().rawDemand.map((line) =>
          line.id === id ? { ...line, ...patch } : line,
        );
        set({ rawDemand });
        get().recomputeActiveDemand();
      },
      addRawLine: () => {
        const used = new Set(get().rawDemand.map((l) => l.resource));
        const nextResource = RAW_RESOURCE_OPTIONS.find((id) => !used.has(id));
        if (!nextResource) return;
        set({
          rawDemand: [
            ...get().rawDemand,
            { id: newLineId(), resource: nextResource, itemsPerMinute: 60 },
          ],
        });
        get().recomputeActiveDemand();
      },
      removeRawLine: (id) => {
        set({ rawDemand: get().rawDemand.filter((line) => line.id !== id) });
        get().recomputeActiveDemand();
      },
      updateProductLine: (id, patch) => {
        const productTargets = get().productTargets.map((line) =>
          line.id === id ? { ...line, ...patch } : line,
        );
        set({ productTargets });
        get().recomputeActiveDemand();
      },
      addProductLine: () => {
        const craftable = Object.values(get().items)
          .filter((i) => !i.raw && i.automatable)
          .sort((a, b) => a.name.localeCompare(b.name));
        const used = new Set(get().productTargets.map((t) => t.productId));
        const next = craftable.find((i) => !used.has(i.id)) ??
          craftable[0] ?? { id: "Desc_IronPlate_C" };
        set({
          productTargets: [
            ...get().productTargets,
            { id: newLineId(), productId: next.id, itemsPerMinute: 60 },
          ],
        });
        get().recomputeActiveDemand();
      },
      removeProductLine: (id) => {
        set({ productTargets: get().productTargets.filter((line) => line.id !== id) });
        get().recomputeActiveDemand();
      },
      setItemExternal: (itemId, external) => {
        const id = canonicalizeProductId(itemId);
        if (!id) return;
        // Product targets always expand one level — external only applies to inputs
        if (get().productTargets.some((t) => t.productId === id)) return;
        const prev = get().externalItems;
        const has = prev.includes(id);
        if (external && has) return;
        if (!external && !has) return;
        const externalItems = external
          ? [...prev, id].sort((a, b) => a.localeCompare(b))
          : prev.filter((x) => x !== id);
        set({ externalItems });
        get().recomputeActiveDemand();
      },
      setMiner: (m) => {
        const prev = get().miner;
        const next = { ...prev, ...m };
        // Overclock UI: 50–250% continuous (soft snap applied in the slider)
        const clampClock = (n: unknown, fallback: number) => {
          if (typeof n === "number" && Number.isFinite(n)) {
            return Math.round(Math.min(250, Math.max(50, n)));
          }
          return fallback;
        };
        next.clockPercent = clampClock(next.clockPercent, DEFAULT_MINER_SETTINGS.clockPercent);
        next.oilClockPercent = clampClock(
          next.oilClockPercent,
          DEFAULT_MINER_SETTINGS.oilClockPercent,
        );
        next.waterClockPercent = clampClock(
          next.waterClockPercent,
          DEFAULT_MINER_SETTINGS.waterClockPercent,
        );
        next.wellClockPercent = clampClock(
          next.wellClockPercent,
          DEFAULT_MINER_SETTINGS.wellClockPercent,
        );
        if (typeof next.resourceWellsEnabled !== "boolean") {
          next.resourceWellsEnabled = DEFAULT_MINER_SETTINGS.resourceWellsEnabled;
        }
        // Skip no-op writes (avoids heatmap thrash when slider re-commits same value)
        if (
          next.minerMk === prev.minerMk &&
          next.clockPercent === prev.clockPercent &&
          next.oilClockPercent === prev.oilClockPercent &&
          next.waterClockPercent === prev.waterClockPercent &&
          next.wellClockPercent === prev.wellClockPercent &&
          next.resourceWellsEnabled === prev.resourceWellsEnabled
        ) {
          return;
        }
        set({ miner: next });
      },
      setScoringMode: (scoringMode) => set({ scoringMode }),
      setScoringOptions: (patch) => set({ scoringOptions: { ...get().scoringOptions, ...patch } }),
      setHeatRender: (patch) =>
        set({ heatRender: clampHeatRender({ ...get().heatRender, ...patch }) }),
      setHeatPaintOpen: (heatPaintOpen) => set({ heatPaintOpen }),
      setExtractorsOpen: (extractorsOpen) => set({ extractorsOpen }),
      setAdvancedOpen: (advancedOpen) => set({ advancedOpen }),
      setExpansionOpen: (expansionOpen) => set({ expansionOpen }),
      setHeatOpacity: (heatOpacity) => set({ heatOpacity }),
      setShowNodes: (showNodes) => set({ showNodes }),
      setSelectedSiteIndex: (selectedSiteIndex) => set({ selectedSiteIndex }),
      setHeatmap: (heatmap) =>
        set({ heatmap, selectedSiteIndex: heatmap?.topSites.length ? 0 : null }),
      setLastRasterizeMs: (lastRasterizeMs) => set({ lastRasterizeMs }),
      setComputing: (computing) => set({ computing }),
      setError: (error) => set({ error }),
      resetKnobs: () =>
        set({
          scoringOptions: { ...DEFAULT_SCORING_OPTIONS },
          heatRender: { ...DEFAULT_HEAT_RENDER },
          heatOpacity: DEFAULT_HEAT_OPACITY,
          showNodes: true,
        }),
      resetAllDefaults: () => {
        set({
          miner: { ...DEFAULT_MINER_SETTINGS },
          scoringMode: "centered",
          scoringOptions: { ...DEFAULT_SCORING_OPTIONS },
          heatRender: { ...DEFAULT_HEAT_RENDER },
          extractorsOpen: false,
          advancedOpen: false,
          expansionOpen: false,
          heatPaintOpen: false,
          heatOpacity: DEFAULT_HEAT_OPACITY,
          showNodes: true,
          selectedSiteIndex: null,
          heatmap: null,
          error: null,
        });
        get().recomputeActiveDemand();
      },
      sendProductsToRaw: () => {
        const state = get();
        const targets = state.productTargets
          .filter((t) => t.productId && t.itemsPerMinute > 0)
          .map((t) => ({ productId: t.productId, itemsPerMinute: t.itemsPerMinute }));
        if (targets.length === 0) {
          set({ error: "No product rates to send — add products first." });
          return;
        }
        const { demand } = solveProductsToRaw(targets, state.recipes, state.items, {
          externalItems: state.externalItems,
        });
        if (demand.length === 0) {
          set({ error: "Could not expand products to raw demand." });
          return;
        }
        const rawDemand: RawDemandLine[] = demand.map((d) => ({
          id: newLineId(),
          resource: d.resource,
          itemsPerMinute: d.itemsPerMinute,
        }));
        set({
          mode: "raw",
          rawDemand,
          activeDemand: demand,
          expansionRows: [],
          error: null,
        });
      },
      applyPlanSnapshot: (snap, options) => {
        // Compact hash only carries the *active* mode's demand lines. Keep the
        // other tab's existing rows only when the snapshot has no lines for that mode
        // AND we're not applying a product/raw mode switch with empty active lines.
        // Empty productTargets in product mode must not keep the previous plan (chip switch).
        const prev = get();
        const applySeed = options?.applySeed !== false;
        const rawDemand: RawDemandLine[] =
          snap.mode === "raw"
            ? snap.rawDemand.length > 0
              ? snap.rawDemand.map((d) => ({
                  id: newLineId(),
                  resource: d.resource,
                  itemsPerMinute: d.itemsPerMinute,
                }))
              : [{ id: newLineId(), resource: "Desc_OreIron_C", itemsPerMinute: 0 }]
            : prev.rawDemand;
        const productTargets: ProductTargetLine[] =
          snap.mode === "product"
            ? snap.productTargets.length > 0
              ? snap.productTargets.map((d) => ({
                  id: newLineId(),
                  productId: canonicalizeProductId(d.productId),
                  itemsPerMinute: d.itemsPerMinute,
                }))
              : [{ id: newLineId(), productId: "Desc_IronPlate_C", itemsPerMinute: 0 }]
            : prev.productTargets;

        const nextSeed = applySeed ? (snap.seed ?? null) : prev.seed;
        const nodes =
          applySeed && prev.baseSlots.length > 0
            ? getNodesForSeed(prev.baseSlots, nextSeed)
            : prev.nodes;

        // Older hashes omit externalItems → []; prefer snapshot list when present
        const externalItems = (snap.externalItems ?? []).map((id) => canonicalizeProductId(id));

        set({
          mode: snap.mode,
          rawDemand,
          productTargets,
          externalItems,
          miner: {
            ...DEFAULT_MINER_SETTINGS,
            ...snap.miner,
          },
          scoringMode: snap.scoringMode,
          // Hash is computation-only — keep local display knobs (opacity, paint, peak emphasis)
          scoringOptions: {
            ...prev.scoringOptions,
            centerPower: snap.scoringOptions.centerPower,
            topN: snap.scoringOptions.topN,
            siteSepFraction: snap.scoringOptions.siteSepFraction,
            includeElevation: snap.scoringOptions.includeElevation,
          },
          seed: nextSeed,
          nodes,
          selectedSiteIndex: null,
          heatmap: null,
          error: null,
        });
        get().recomputeActiveDemand();
      },
      setSeed: (seed) => {
        const prev = get();
        const next = seed === null ? null : seed | 0;
        if (prev.seed === next && prev.nodes.length > 0) return;
        const nodes =
          prev.baseSlots.length > 0 ? getNodesForSeed(prev.baseSlots, next) : prev.nodes;
        set({
          seed: next,
          nodes,
          selectedSiteIndex: null,
          heatmap: null,
        });
      },
      selectSite: (_site, index) => set({ selectedSiteIndex: index }),
      recomputeActiveDemand: () => {
        const { demand, expansionRows } = recompute(get());
        set({ activeDemand: demand, expansionRows });
      },
      loadGameData: async () => {
        try {
          const [nodesRes, itemsRes, recipesRes, metaRes, waterRes] = await Promise.all([
            fetch("/data/nodes/default-nodes.json"),
            fetch("/data/recipes/items.json"),
            fetch("/data/recipes/recipes.json"),
            fetch("/data/meta.json"),
            fetch("/data/water/open-water.json"),
          ]);
          if (!nodesRes.ok || !itemsRes.ok || !recipesRes.ok || !metaRes.ok) {
            throw new Error("Failed to load game data JSON");
          }
          const baseSlots = (await nodesRes.json()) as ResourceNode[];
          const items = (await itemsRes.json()) as Record<string, ItemDef>;
          const recipes = (await recipesRes.json()) as Recipe[];
          const meta = (await metaRes.json()) as MapMeta;
          // Open water is optional for older deploys; empty bodies → wells only
          let openWater: OpenWaterData | null = null;
          if (waterRes.ok) {
            openWater = (await waterRes.json()) as OpenWaterData;
          }
          clearNodeSeedCache();
          const seed = get().seed;
          const nodes = getNodesForSeed(baseSlots, seed);
          set({
            baseSlots,
            nodes,
            openWater,
            items,
            recipes,
            meta,
            dataReady: true,
            error: null,
          });
          get().recomputeActiveDemand();
        } catch (e) {
          set({
            error: e instanceof Error ? e.message : String(e),
            dataReady: false,
          });
        }
      },
    }),
    {
      // v9: externalItems (Mode B off-site prune); seed still null = Default
      name: "sf-heatmap-v9",
      partialize: (s) => ({
        mode: s.mode,
        rawDemand: s.rawDemand,
        productTargets: s.productTargets,
        externalItems: s.externalItems,
        miner: s.miner,
        scoringMode: s.scoringMode,
        scoringOptions: s.scoringOptions,
        heatRender: s.heatRender,
        heatPaintOpen: s.heatPaintOpen,
        extractorsOpen: s.extractorsOpen,
        advancedOpen: s.advancedOpen,
        expansionOpen: s.expansionOpen,
        heatOpacity: s.heatOpacity,
        showNodes: s.showNodes,
        seed: s.seed,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState> & {
          scoringMode?: string;
          productId?: string;
          productRate?: number;
          heatRender?: Partial<HeatRenderOptions>;
        };
        const rawDemand = (p.rawDemand ?? current.rawDemand).map((line, i) => ({
          id: "id" in line && typeof line.id === "string" ? line.id : `migrated-${i}`,
          resource: line.resource,
          itemsPerMinute: line.itemsPerMinute,
        }));
        let productTargets = p.productTargets ?? current.productTargets;
        if ((!productTargets || productTargets.length === 0) && p.productId) {
          productTargets = [
            {
              id: "migrated-product",
              productId: p.productId,
              itemsPerMinute: p.productRate ?? 10,
            },
          ];
        }
        productTargets = productTargets.map((line, i) => ({
          id: line.id ?? `prod-${i}`,
          productId: canonicalizeProductId(line.productId),
          itemsPerMinute: line.itemsPerMinute,
        }));
        // Pre-v9 localStorage has no externalItems → keep packaging vessel defaults
        const externalItems = Array.isArray(p.externalItems)
          ? p.externalItems.map((id) => canonicalizeProductId(id)).filter(Boolean)
          : [...DEFAULT_EXTERNAL_ITEM_IDS];
        const rawMode = String(p.scoringMode ?? current.scoringMode);
        const scoringMode: ScoringMode =
          rawMode === "weighted" || rawMode === "volume" ? "weighted" : "centered";
        const rawOpts = {
          ...DEFAULT_SCORING_OPTIONS,
          ...current.scoringOptions,
          ...p.scoringOptions,
        };
        const scoringOptions: ScoringOptions = {
          centerPower: rawOpts.centerPower,
          heatContrast: rawOpts.heatContrast,
          topN: rawOpts.topN,
          siteSepFraction: rawOpts.siteSepFraction,
          includeElevation: rawOpts.includeElevation !== false,
        };
        const heatRender = clampHeatRender({
          ...DEFAULT_HEAT_RENDER,
          ...current.heatRender,
          ...p.heatRender,
        });
        const minerIn = p.miner ?? current.miner;
        const clampClock = (n: unknown, fallback: number) => {
          const raw = typeof n === "number" && Number.isFinite(n) ? n : fallback;
          return Math.round(Math.min(250, Math.max(50, raw)));
        };
        const miner = {
          ...DEFAULT_MINER_SETTINGS,
          ...minerIn,
          clockPercent: clampClock(minerIn.clockPercent, DEFAULT_MINER_SETTINGS.clockPercent),
          oilClockPercent: clampClock(
            minerIn.oilClockPercent,
            DEFAULT_MINER_SETTINGS.oilClockPercent,
          ),
          waterClockPercent: clampClock(
            minerIn.waterClockPercent,
            DEFAULT_MINER_SETTINGS.waterClockPercent,
          ),
          wellClockPercent: clampClock(
            minerIn.wellClockPercent,
            DEFAULT_MINER_SETTINGS.wellClockPercent,
          ),
          resourceWellsEnabled:
            typeof minerIn.resourceWellsEnabled === "boolean"
              ? minerIn.resourceWellsEnabled
              : DEFAULT_MINER_SETTINGS.resourceWellsEnabled,
        };
        const rawSeed = (p as { seed?: MapSeed }).seed;
        const seed: MapSeed =
          rawSeed === null || rawSeed === undefined
            ? null
            : typeof rawSeed === "number" && Number.isFinite(rawSeed)
              ? rawSeed | 0
              : null;
        return {
          ...current,
          ...p,
          rawDemand,
          productTargets,
          externalItems,
          miner,
          scoringMode,
          scoringOptions,
          heatRender,
          seed,
        };
      },
    },
  ),
);

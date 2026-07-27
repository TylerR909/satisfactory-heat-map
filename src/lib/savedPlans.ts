import { encodePlanHash, type PlanHashSource, type PlanSnapshot, toSnapshot } from "@/lib/planHash";
import { solveProductsToRaw } from "@/lib/production/solve";
import { resourceLabel } from "@/lib/resources";
import type {
  InputMode,
  ItemDef,
  ProductTargetLine,
  RawDemand,
  RawDemandLine,
  Recipe,
} from "@/types";

const STORAGE_KEY = "sf-heatmap-saved-plans-v1";

export type SavedPlan = {
  id: string;
  /** Short chip label, e.g. RIP / M / IO */
  abbrev: string;
  /** Human title for tooltip */
  title: string;
  /** Plan hash body without leading `#` (share / URL; may be lossy for rare products) */
  hash: string;
  /**
   * Full computation snapshot for reliable local chip restore.
   * Prefer this over decoding `hash` when switching heatmaps.
   */
  snapshot: PlanSnapshot;
  mode: InputMode;
  /** Input lines (products or raw as entered) */
  lines: Array<{ label: string; rate: number }>;
  /** Expanded raw demand for tooltip */
  demand: Array<{ label: string; rate: number }>;
  updatedAt: number;
};

export type SavedPlansState = {
  plans: SavedPlan[];
  activeId: string | null;
};

export type PlanLabelSource = {
  mode: InputMode;
  rawDemand: RawDemandLine[];
  productTargets: ProductTargetLine[];
  items: Record<string, ItemDef>;
  recipes: Recipe[];
};

function newId(): string {
  return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Chip abbreviation: multi-word → initials (Reinforced Iron Plate → RIP);
 * single word → first letter (Motor → M). Duplicates allowed.
 */
export function planAbbrev(name: string): string {
  const words = name
    .replace(/[^a-zA-Z0-9\s.-]/g, " ")
    .split(/[\s.-]+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return (words[0]?.[0] ?? "?").toUpperCase();
  return words
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 4)
    .toUpperCase();
}

export function primaryPlanLabel(src: PlanLabelSource): { abbrev: string; title: string } {
  if (src.mode === "product") {
    // Prefer a positive-rate product; otherwise still label from the first product
    // line so blank builds don't fall through to leftover raw-tab seed rows.
    const first =
      src.productTargets.find((t) => t.productId && t.itemsPerMinute > 0) ??
      src.productTargets.find((t) => t.productId);
    if (first) {
      const title =
        src.items[first.productId]?.name ??
        first.productId.replace(/^Desc_/, "").replace(/_C$/, "");
      return { abbrev: planAbbrev(title), title };
    }
    return { abbrev: "?", title: "Empty plan" };
  }

  const firstRaw =
    src.rawDemand.find((t) => t.resource && t.itemsPerMinute > 0) ??
    src.rawDemand.find((t) => t.resource);
  if (firstRaw) {
    const title = resourceLabel(firstRaw.resource, src.items);
    return { abbrev: planAbbrev(title), title };
  }
  return { abbrev: "?", title: "Empty plan" };
}

function expandDemand(src: PlanLabelSource): RawDemand[] {
  if (src.mode === "raw") {
    return src.rawDemand
      .filter((d) => d.resource && d.itemsPerMinute > 0)
      .map(({ resource, itemsPerMinute }) => ({ resource, itemsPerMinute }));
  }
  const targets = src.productTargets
    .filter((t) => t.productId && t.itemsPerMinute > 0)
    .map((t) => ({ productId: t.productId, itemsPerMinute: t.itemsPerMinute }));
  if (targets.length === 0) return [];
  return solveProductsToRaw(targets, src.recipes, src.items).demand;
}

export function buildSavedPlan(
  id: string | null,
  hashSource: PlanHashSource,
  labelSrc: PlanLabelSource,
): SavedPlan {
  const { abbrev, title } = primaryPlanLabel(labelSrc);
  const hash = encodePlanHash(hashSource);
  // Full snapshot (not lossy) so chip switch always restores the real plan
  const snapshot = toSnapshot(hashSource);
  const lines =
    labelSrc.mode === "product"
      ? labelSrc.productTargets
          .filter((t) => t.productId && t.itemsPerMinute > 0)
          .map((t) => ({
            label: labelSrc.items[t.productId]?.name ?? t.productId,
            rate: t.itemsPerMinute,
          }))
      : labelSrc.rawDemand
          .filter((t) => t.resource && t.itemsPerMinute > 0)
          .map((t) => ({
            label: resourceLabel(t.resource, labelSrc.items),
            rate: t.itemsPerMinute,
          }));
  const demand = expandDemand(labelSrc).map((d) => ({
    label: resourceLabel(d.resource, labelSrc.items),
    rate: d.itemsPerMinute,
  }));

  return {
    id: id ?? newId(),
    abbrev,
    title,
    hash,
    snapshot,
    mode: labelSrc.mode,
    lines,
    demand,
    updatedAt: Date.now(),
  };
}

/** Prefer full local snapshot; fall back to hash decode for older shelves / imports. */
export function planSnapshotFromSaved(
  plan: SavedPlan,
  decodeHash: (hash: string) => PlanSnapshot | null,
): PlanSnapshot | null {
  if (plan.snapshot && typeof plan.snapshot === "object" && plan.snapshot.mode) {
    return plan.snapshot;
  }
  return decodeHash(plan.hash);
}

export function loadSavedPlansState(): SavedPlansState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { plans: [], activeId: null };
    const parsed = JSON.parse(raw) as SavedPlansState;
    if (!Array.isArray(parsed.plans)) return { plans: [], activeId: null };
    return {
      plans: parsed.plans,
      activeId: typeof parsed.activeId === "string" ? parsed.activeId : null,
    };
  } catch {
    return { plans: [], activeId: null };
  }
}

export function persistSavedPlansState(state: SavedPlansState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode / quota exceeded — shelf is best-effort only
  }
}

export function upsertPlan(state: SavedPlansState, plan: SavedPlan): SavedPlansState {
  const idx = state.plans.findIndex((p) => p.id === plan.id);
  const plans =
    idx >= 0 ? state.plans.map((p, i) => (i === idx ? plan : p)) : [...state.plans, plan];
  return { plans, activeId: plan.id };
}

export function removePlan(state: SavedPlansState, id: string): SavedPlansState {
  const plans = state.plans.filter((p) => p.id !== id);
  let activeId = state.activeId;
  if (activeId === id) {
    activeId = plans[0]?.id ?? null;
  }
  return { plans, activeId };
}

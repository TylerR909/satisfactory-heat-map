/**
 * Greedy pack: pick non-default recipes to minimize distinct map-raw input types.
 *
 * Only accepts changes that **strictly reduce** the unique map-raw count on a
 * full expand. Same-type efficiency swaps (Tempered Caterium: still Caterium,
 * oil already on the plan) are rejected — lower tonnage alone is not a win.
 *
 * Partial “almost Removes” (Iron Pipe while Black Powder still needs Coal) do
 * not reduce unique count, so they are skipped. Real Removes that zero a raw
 * globally (Plastic AI Limiter → no Copper) stick. If two alts must combine to
 * zero a raw, a later pair-search pass tries two simultaneous changes.
 */

import { listProductionRecipes, solveProductsToRaw } from "@/lib/production/solve";
import type { ItemDef, Recipe } from "@/types";

const EPS = 1e-6;
const MAX_ROUNDS = 24;

export type MinimizeInputTypesInput = {
  recipes: Recipe[];
  items: Record<string, ItemDef>;
  /** Active product targets (rates matter for expand paths). */
  productTargets: Array<{ productId: string; itemsPerMinute: number }>;
  externalItems?: readonly string[];
};

export type MinimizeInputTypesResult = {
  overrides: Record<string, string>;
  /** Unique map-raw types under all-defaults. */
  baselineUnique: number;
  /** Unique map-raw types under chosen overrides. */
  finalUnique: number;
};

function demandStats(demand: Array<{ resource: string; itemsPerMinute: number }>): {
  unique: Set<string>;
  total: number;
} {
  const unique = new Set<string>();
  let total = 0;
  for (const d of demand) {
    if (d.itemsPerMinute > EPS) {
      unique.add(d.resource);
      total += d.itemsPerMinute;
    }
  }
  return { unique, total };
}

type Stats = { unique: Set<string>; total: number };

/** Strict unique-type win only (tonnage is tie-break among equal unique counts). */
function reducesUniqueTypes(trial: Stats, current: Stats): boolean {
  return trial.unique.size < current.unique.size;
}

/** Prefer fewer unique types; among equals, lower total raw; then stable recipe id. */
function preferTrial(
  trial: Stats,
  trialRecipeId: string | null,
  best: Stats,
  bestRecipeId: string | null,
): boolean {
  if (trial.unique.size < best.unique.size) return true;
  if (trial.unique.size > best.unique.size) return false;
  if (trial.total < best.total - EPS) return true;
  if (trial.total > best.total + EPS) return false;
  return (trialRecipeId ?? "").localeCompare(bestRecipeId ?? "") < 0;
}

type Candidate = {
  /** Patch applied on top of current overrides (null recipeId = clear that product). */
  patch: Array<{ productId: string; recipeId: string | null }>;
  stats: Stats;
  /** Stable sort key */
  key: string;
};

function applyPatch(
  overrides: Record<string, string>,
  patch: Array<{ productId: string; recipeId: string | null }>,
): Record<string, string> {
  const next = { ...overrides };
  for (const { productId, recipeId } of patch) {
    if (recipeId == null) delete next[productId];
    else next[productId] = recipeId;
  }
  return next;
}

function listInPlayRecipes(
  recipes: Recipe[],
  inPlay: Iterable<string>,
): Array<{ productId: string; recipeId: string | null; recipeKey: string }> {
  const out: Array<{ productId: string; recipeId: string | null; recipeKey: string }> = [];
  for (const productId of [...inPlay].sort((a, b) => a.localeCompare(b))) {
    const list = listProductionRecipes(recipes, productId);
    if (list.length <= 1) continue;
    const defaultId = list[0]?.id;
    if (!defaultId) continue;
    for (const recipe of list) {
      const recipeId = recipe.id === defaultId ? null : recipe.id;
      out.push({ productId, recipeId, recipeKey: recipeId ?? `default:${defaultId}` });
    }
  }
  return out;
}

/**
 * Greedy multi-round search over in-play production recipes.
 * Starts from defaults (empty overrides); returns productId → recipeId picks.
 */
export function minimizeInputTypeOverrides(
  input: MinimizeInputTypesInput,
): MinimizeInputTypesResult {
  const targets = input.productTargets
    .map((t) => ({
      productId: t.productId,
      itemsPerMinute: t.itemsPerMinute,
    }))
    .filter((t) => t.productId && t.itemsPerMinute > EPS);

  if (targets.length === 0) {
    return { overrides: {}, baselineUnique: 0, finalUnique: 0 };
  }

  const expand = (overrides: Record<string, string>) =>
    solveProductsToRaw(targets, input.recipes, input.items, {
      recipeOverrides: overrides,
      externalItems: input.externalItems,
    });

  const baselineStats = demandStats(expand({}).demand);
  let overrides: Record<string, string> = {};
  let currentStats = baselineStats;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const solved = expand(overrides);
    const inPlay = new Set<string>([
      ...targets.map((t) => t.productId),
      ...Object.keys(solved.intermediates).filter((id) => (solved.intermediates[id] ?? 0) > EPS),
    ]);

    const options = listInPlayRecipes(input.recipes, inPlay);
    let best: Candidate | null = null;

    // Singles: one recipe change that strictly cuts unique raw types
    for (const opt of options) {
      const curPick = overrides[opt.productId] ?? null;
      if (curPick === opt.recipeId) continue;
      const patch = [{ productId: opt.productId, recipeId: opt.recipeId }];
      const stats = demandStats(expand(applyPatch(overrides, patch)).demand);
      if (!reducesUniqueTypes(stats, currentStats)) continue;
      const key = opt.recipeKey;
      if (!best || preferTrial(stats, opt.recipeId, best.stats, best.patch[0]?.recipeId ?? null)) {
        best = { patch, stats, key };
      }
    }

    // Pairs: two simultaneous changes (synergy when neither alone zeros a raw)
    if (!best) {
      for (let i = 0; i < options.length; i++) {
        const a = options[i];
        if (!a) continue;
        if ((overrides[a.productId] ?? null) === a.recipeId) continue;
        for (let j = i + 1; j < options.length; j++) {
          const b = options[j];
          if (!b) continue;
          if (a.productId === b.productId) continue;
          if ((overrides[b.productId] ?? null) === b.recipeId) continue;
          const patch = [
            { productId: a.productId, recipeId: a.recipeId },
            { productId: b.productId, recipeId: b.recipeId },
          ];
          const stats = demandStats(expand(applyPatch(overrides, patch)).demand);
          if (!reducesUniqueTypes(stats, currentStats)) continue;
          const key = `${a.recipeKey}|${b.recipeKey}`;
          if (
            !best ||
            preferTrial(stats, key, best.stats, best.key) ||
            (stats.unique.size === best.stats.unique.size &&
              Math.abs(stats.total - best.stats.total) < EPS &&
              key.localeCompare(best.key) < 0)
          ) {
            best = { patch, stats, key };
          }
        }
      }
    }

    if (!best) break;
    overrides = applyPatch(overrides, best.patch);
    currentStats = best.stats;
  }

  return {
    overrides,
    baselineUnique: baselineStats.unique.size,
    finalUnique: currentStats.unique.size,
  };
}

/**
 * Cheap applicability: true if any single non-default pick cuts unique raw types.
 */
export function canMinimizeInputTypes(input: MinimizeInputTypesInput): boolean {
  const targets = input.productTargets
    .map((t) => ({
      productId: t.productId,
      itemsPerMinute: t.itemsPerMinute,
    }))
    .filter((t) => t.productId && t.itemsPerMinute > EPS);
  if (targets.length === 0) return false;

  const expand = (overrides: Record<string, string>) =>
    solveProductsToRaw(targets, input.recipes, input.items, {
      recipeOverrides: overrides,
      externalItems: input.externalItems,
    });

  const baseline = demandStats(expand({}).demand);
  const solved = expand({});
  const inPlay = new Set<string>([
    ...targets.map((t) => t.productId),
    ...Object.keys(solved.intermediates).filter((id) => (solved.intermediates[id] ?? 0) > EPS),
  ]);

  for (const productId of inPlay) {
    const list = listProductionRecipes(input.recipes, productId);
    if (list.length <= 1) continue;
    const defaultId = list[0]?.id;
    for (const recipe of list) {
      if (!defaultId || recipe.id === defaultId) continue;
      const stats = demandStats(expand({ [productId]: recipe.id }).demand);
      if (reducesUniqueTypes(stats, baseline)) return true;
    }
  }
  return false;
}

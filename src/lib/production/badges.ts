/**
 * Deterministic alternate-recipe badges for Mode B.
 *
 * Tags are pure functions of the recipe catalog + expander: force one alternate
 * for its primary product, expand with defaults elsewhere, compare to an
 * all-default baseline at the same product rate.
 */

import {
  isMapRawResource,
  listAlternateRecipes,
  listProductionRecipes,
  primaryProductId,
  recipeShortName,
  resolveProductionRecipe,
  solveProductsToRaw,
} from "@/lib/production/solve";
import { resourceLabel, WATER_RESOURCE_ID } from "@/lib/resources";
import type { ItemDef, Recipe } from "@/types";

/** Rate used for comparative expansions (cancels in relative metrics). */
const BADGE_RATE = 60;

/** Relative total-raw reduction to earn Resource Efficient (≥8% less overall). */
const RESOURCE_EFFICIENT_THRESHOLD = 0.08;

/**
 * Primary product items/min multiplier vs default recipe for High Throughput.
 * 2× = twice as many finished items per minute from one machine at 100%.
 */
const HIGH_THROUGHPUT_THRESHOLD = 2;

const EPS = 1e-6;

const SCREW_ID = "Desc_IronScrew_C";

/** Primary product output rate (items/min at 100% clock). */
export function primaryOutputPerMin(recipe: Recipe, productId?: string): number {
  const pid = productId ?? primaryProductId(recipe);
  if (!pid || recipe.durationSec <= 0) return 0;
  const line = recipe.products.find((p) => p.item === pid) ?? recipe.products[0];
  if (!line || line.amount <= 0) return 0;
  return (line.amount * 60) / recipe.durationSec;
}

function rawRate(
  demand: Array<{ resource: string; itemsPerMinute: number }>,
  resourceId: string,
): number {
  return demand.find((d) => d.resource === resourceId)?.itemsPerMinute ?? 0;
}

/**
 * Minimum achievable rate of `resourceId` while keeping `forcedAlt` on `productId`,
 * allowing greedy alternate picks on other intermediates.
 * Used to gate "Adds X" to raws that cannot be fully avoided.
 */
function minRawUnderForcedAlt(
  productId: string,
  forcedAltId: string,
  resourceId: string,
  recipes: Recipe[],
  items: Record<string, ItemDef>,
  rate: number,
  intermediateIds: string[],
): number {
  const expand = (overrides: Record<string, string>) =>
    solveProductsToRaw([{ productId, itemsPerMinute: rate }], recipes, items, {
      recipeOverrides: overrides,
    });

  let overrides: Record<string, string> = { [productId]: forcedAltId };
  let best = rawRate(expand(overrides).demand, resourceId);
  if (best <= EPS) return 0;

  // One greedy pass over intermediates (stable order) — enough for badge honesty
  const candidates = [...intermediateIds]
    .filter((id) => id !== productId)
    .sort((a, b) => a.localeCompare(b));

  for (const itemId of candidates) {
    const alts = listAlternateRecipes(recipes, itemId);
    if (alts.length === 0) continue;

    let localBest = best;
    let localPick: string | null = null;

    // Default (no override for this item)
    if (overrides[itemId]) {
      const without = { ...overrides };
      delete without[itemId];
      const amt = rawRate(expand(without).demand, resourceId);
      if (amt < localBest - EPS) {
        localBest = amt;
        localPick = null; // clear
      }
    }

    for (const alt of alts) {
      if (overrides[itemId] === alt.id) continue;
      const amt = rawRate(expand({ ...overrides, [itemId]: alt.id }).demand, resourceId);
      if (amt < localBest - EPS) {
        localBest = amt;
        localPick = alt.id;
      }
    }

    if (localBest < best - EPS) {
      best = localBest;
      if (localPick === null) {
        const next = { ...overrides };
        delete next[itemId];
        overrides = next;
      } else {
        overrides = { ...overrides, [itemId]: localPick };
      }
      if (best <= EPS) return 0;
    }
  }

  return best;
}

export type RecipeBadgeKind =
  | "resource-efficient"
  | "high-throughput"
  | "removes"
  | "skips"
  | "introduces"
  | "screw-free"
  | "pure"
  | "alloy"
  | "alt-input"
  | "shorter-chain"
  /** Alt uses a lower-tier solid crafter than default (Manufacturer → Assembler → Constructor). */
  | "simpler-machine"
  /** Alt needs a higher-tier solid crafter than default. */
  | "heavier-machine"
  /** Alt uses a different building family (Foundry, Refinery, Blender, …). */
  | "machine-change";

export type RecipeBadge = {
  kind: RecipeBadgeKind;
  /** Short UI label, e.g. "Resource Efficient", "Removes Quartz". */
  label: string;
  /** Optional resource/item id for removes / introduces. */
  itemId?: string;
  /** Optional quantitative score (e.g. fraction raw savings 0–1). */
  score?: number;
  /** Optional tooltip detail (e.g. Alt Input "Swaps Coal for Crude Oil"). */
  detail?: string;
};

/**
 * Normalize Docs `producedIn` ClassName (`Build_OilRefinery_C`) for comparison.
 * Strips Mk ranks so FoundryMk1 ≡ Foundry.
 */
export function normalizeProducedIn(producedIn: string | undefined | null): string | null {
  if (!producedIn) return null;
  let s = producedIn.trim();
  if (!s) return null;
  s = s.replace(/^Build_/, "").replace(/_C$/, "");
  s = s.replace(/Mk\d+$/i, "");
  return s || null;
}

/** Short UI label for a building ClassName or normalized key. */
export function machineDisplayName(producedIn: string | undefined | null): string | null {
  const key = normalizeProducedIn(producedIn);
  if (!key) return null;
  const map: Record<string, string> = {
    Constructor: "Constructor",
    Assembler: "Assembler",
    Manufacturer: "Manufacturer",
    Smelter: "Smelter",
    Foundry: "Foundry",
    OilRefinery: "Refinery",
    Blender: "Blender",
    Packager: "Packager",
    HadronCollider: "Particle Accelerator",
    ParticleAccelerator: "Particle Accelerator",
    Converter: "Converter",
    QuantumEncoder: "Quantum Encoder",
  };
  if (map[key]) return map[key];
  // Fallback: split CamelCase
  return key.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/**
 * Solid part-crafter ladder only (ingredient count is irrelevant).
 * Lower index = simpler building.
 */
const SOLID_CRAFTER_LADDER = ["Constructor", "Assembler", "Manufacturer"] as const;

function solidCrafterRank(normalized: string): number | null {
  const i = (SOLID_CRAFTER_LADDER as readonly string[]).indexOf(normalized);
  return i >= 0 ? i : null;
}

/**
 * Badge when alt recipe runs in a different factory building than the default.
 * Uses Docs `producedIn` — never ingredient counts (Refinery ≠ Assembler).
 */
export function machineChangeBadge(defaultRecipe: Recipe, altRecipe: Recipe): RecipeBadge | null {
  const defKey = normalizeProducedIn(defaultRecipe.producedIn);
  const altKey = normalizeProducedIn(altRecipe.producedIn);
  if (!defKey || !altKey || defKey === altKey) return null;

  const defName = machineDisplayName(defaultRecipe.producedIn) ?? defKey;
  const altName = machineDisplayName(altRecipe.producedIn) ?? altKey;
  const detail = `Uses a ${altName} instead of a ${defName}.`;

  const defRank = solidCrafterRank(defKey);
  const altRank = solidCrafterRank(altKey);
  if (defRank != null && altRank != null) {
    if (altRank < defRank) {
      return { kind: "simpler-machine", label: altName, score: defRank - altRank, detail };
    }
    if (altRank > defRank) {
      return { kind: "heavier-machine", label: altName, score: altRank - defRank, detail };
    }
  }

  return { kind: "machine-change", label: altName, detail };
}

/** Tailwind classes for badge pills (alt picker + quick selects). Never I-beam/text cursor. */
export function recipeBadgeClassName(kind: RecipeBadgeKind): string {
  const base = "cursor-default select-none";
  switch (kind) {
    case "removes":
      return `${base} border-emerald-500/40 bg-emerald-500/15 text-emerald-300`;
    case "skips":
      return `${base} border-lime-500/40 bg-lime-500/15 text-lime-300`;
    case "shorter-chain":
      return `${base} border-lime-500/40 bg-lime-500/15 text-lime-300`;
    case "simpler-machine":
      return `${base} border-teal-500/40 bg-teal-500/15 text-teal-300`;
    case "screw-free":
      return `${base} border-sky-500/40 bg-sky-500/15 text-sky-300`;
    case "resource-efficient":
      return `${base} border-amber-500/40 bg-amber-500/15 text-amber-300`;
    case "high-throughput":
      return `${base} border-rose-500/40 bg-rose-500/15 text-rose-300`;
    case "pure":
      return `${base} border-cyan-500/40 bg-cyan-500/15 text-cyan-300`;
    case "alloy":
      return `${base} border-violet-500/40 bg-violet-500/15 text-violet-300`;
    case "machine-change":
      return `${base} border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-300`;
    case "alt-input":
      return `${base} border-orange-500/40 bg-orange-500/15 text-orange-300`;
    case "heavier-machine":
      return `${base} border-red-500/35 bg-red-500/10 text-red-300/90`;
    case "introduces":
      return `${base} border-slate-600/50 bg-slate-900/60 text-slate-400`;
    default:
      return `${base} border-slate-600 bg-slate-800 text-slate-400`;
  }
}

export type BadgeCompareResult = {
  badges: RecipeBadge[];
  /** Sum of absolute map-raw rates under baseline. */
  baselineRawTotal: number;
  /** Sum under the alternate. */
  altRawTotal: number;
  baselineDemand: Record<string, number>;
  altDemand: Record<string, number>;
};

function demandToRecord(
  demand: Array<{ resource: string; itemsPerMinute: number }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of demand) {
    if (d.itemsPerMinute > EPS) out[d.resource] = d.itemsPerMinute;
  }
  return out;
}

function totalRaw(rec: Record<string, number>): number {
  let s = 0;
  for (const v of Object.values(rec)) s += v;
  return s;
}

function patternBadges(recipe: Recipe): RecipeBadge[] {
  const out: RecipeBadge[] = [];
  const name = recipe.name;
  const id = recipe.id;
  const blob = `${name} ${id}`;

  if (/\bPure\b/i.test(blob) || /Wet Concrete|Diluted/i.test(blob)) {
    out.push({ kind: "pure", label: "Pure" });
  }
  if (/\bAlloy\b/i.test(blob)) {
    out.push({ kind: "alloy", label: "Alloy" });
  } else {
    // Two distinct ore inputs → ingot-style alloy without "Alloy" in the name
    const ores = recipe.ingredients.filter((ing) =>
      /Desc_Ore|Desc_Coal|Desc_Stone|Desc_RawQuartz|Desc_Sulfur|Desc_SAM/i.test(ing.item),
    );
    const oreIds = new Set(ores.map((o) => o.item));
    if (oreIds.size >= 2 && /Ingot/i.test(blob)) {
      out.push({ kind: "alloy", label: "Alloy" });
    }
  }
  return out;
}

/**
 * Compare one alternate (forced for its primary product) against all-default
 * expansion of that product at {@link BADGE_RATE}/min.
 * Works for hard-drive alts and other non-default production paths (e.g. Residual Plastic).
 */
export function compareAlternateToDefault(
  altRecipe: Recipe,
  recipes: Recipe[],
  items: Record<string, ItemDef>,
  rate: number = BADGE_RATE,
): BadgeCompareResult | null {
  const productId = primaryProductId(altRecipe);
  if (!productId) return null;

  const catalogDefault = listProductionRecipes(recipes, productId)[0];
  if (!catalogDefault || catalogDefault.id === altRecipe.id) return null;

  const baseline = solveProductsToRaw([{ productId, itemsPerMinute: rate }], recipes, items);
  const withAlt = solveProductsToRaw([{ productId, itemsPerMinute: rate }], recipes, items, {
    recipeOverrides: { [productId]: altRecipe.id },
  });

  const baselineDemand = demandToRecord(baseline.demand);
  const altDemand = demandToRecord(withAlt.demand);
  const baselineRawTotal = totalRaw(baselineDemand);
  const altRawTotal = totalRaw(altDemand);

  const badges: RecipeBadge[] = [...patternBadges(altRecipe)];

  // Real Docs producedIn — never ingredient-count proxies (Refinery ≠ Assembler).
  const machineBadge = machineChangeBadge(catalogDefault, altRecipe);
  if (machineBadge) badges.push(machineBadge);

  // High Throughput — machine spit out finished product much faster than default
  {
    const defRate = primaryOutputPerMin(catalogDefault, productId);
    const altRate = primaryOutputPerMin(altRecipe, productId);
    if (defRate > EPS && altRate / defRate >= HIGH_THROUGHPUT_THRESHOLD) {
      badges.push({
        kind: "high-throughput",
        label: "High Throughput",
        score: altRate / defRate,
      });
    }
  }

  // Removes: raws gone under this alt + defaults elsewhere (still useful callout)
  const baseKeys = new Set(Object.keys(baselineDemand));
  const altKeys = new Set(Object.keys(altDemand));

  // Resource Efficient — overall raw tonnage down, without swapping in new ores
  // (Water-only introductions still OK — Pure paths). Coke Steel (oil) / Compacted
  // (sulfur) no longer get RE just because unweighted sum dropped.
  if (baselineRawTotal > EPS) {
    const savings = (baselineRawTotal - altRawTotal) / baselineRawTotal;
    const newRaws = [...altKeys].filter((k) => !baseKeys.has(k));
    const onlyWaterNew = newRaws.length === 0 || newRaws.every((k) => k === WATER_RESOURCE_ID);
    if (savings >= RESOURCE_EFFICIENT_THRESHOLD && onlyWaterNew) {
      badges.push({
        kind: "resource-efficient",
        label: "Resource Efficient",
        score: savings,
      });
    }
  }
  for (const res of baseKeys) {
    if ((baselineDemand[res] ?? 0) > EPS && (altDemand[res] ?? 0) <= EPS) {
      badges.push({
        kind: "removes",
        label: `Removes ${resourceLabel(res, items)}`,
        itemId: res,
      });
    }
  }

  // Adds: only raws that appear under alt+defaults AND cannot be zeroed by
  // picking other intermediates' alts (unavoidable given this recipe).
  const candidateAdds = [...altKeys].filter(
    (res) => (altDemand[res] ?? 0) > EPS && (baselineDemand[res] ?? 0) <= EPS,
  );
  const intermediateIds = Object.keys(withAlt.intermediates);
  for (const res of candidateAdds) {
    const minRate = minRawUnderForcedAlt(
      productId,
      altRecipe.id,
      res,
      recipes,
      items,
      rate,
      intermediateIds,
    );
    if (minRate > EPS) {
      badges.push({
        kind: "introduces",
        label: `Adds ${resourceLabel(res, items)}`,
        itemId: res,
        score: minRate,
      });
    }
  }

  // Alt Input: raw set changes under default-elsewhere expand (path swap signal)
  const goneRaws = [...baseKeys].filter((k) => (altDemand[k] ?? 0) <= EPS);
  const cameRaws = [...altKeys].filter((k) => (baselineDemand[k] ?? 0) <= EPS);
  if (goneRaws.length > 0 && cameRaws.length > 0) {
    if (!badges.some((b) => b.kind === "alt-input")) {
      const from = goneRaws.map((k) => resourceLabel(k, items)).join(", ");
      const to = cameRaws.map((k) => resourceLabel(k, items)).join(", ");
      badges.push({
        kind: "alt-input",
        label: "Alt Input",
        detail: `Swaps ${from} for ${to}`,
      });
    }
  }

  // Screw-Free: intermediate screw demand eliminated (downstream of other products)
  const baseScrews = baseline.intermediates[SCREW_ID] ?? 0;
  const altScrews = withAlt.intermediates[SCREW_ID] ?? 0;
  if (productId !== SCREW_ID && baseScrews > EPS && altScrews <= EPS) {
    badges.push({ kind: "screw-free", label: "Screw-Free" });
  }

  /**
   * Skips step — only for *same-chain shortcuts*, not full path swaps.
   *
   * Good: Cast Screws (Ingot is already on the default rod→screws chain) → Skips Iron Rod.
   * Good: Pure Aluminum (Scrap is still on the default chain) → Skips Silica.
   * Bad:  Steel Screws (Steel Beam is off the default iron-rod chain) — must NOT claim
   *       "Skips Iron Ingot"; that path still burns iron ore via Steel Ingot.
   *
   * Rules:
   * 1. At least one alt ingredient must already appear on the default expand
   *    (intermediate or map-raw demand) — the alt is a shortcut on the same tree.
   * 2. Only badge **direct crafted ingredients of the default recipe** that vanish
   *    under the alt (not every deeper intermediate that happens to drop out).
   */
  const defaultRecipe = resolveProductionRecipe(productId, recipes);
  const onBaselineChain = (itemId: string): boolean => {
    if (itemId === productId) return true;
    if ((baseline.intermediates[itemId] ?? 0) > EPS) return true;
    if ((baselineDemand[itemId] ?? 0) > EPS) return true;
    return false;
  };
  const altSharesBaselineChain = altRecipe.ingredients.some((ing) => onBaselineChain(ing.item));

  const skipped: Array<{ itemId: string; rate: number }> = [];
  if (altSharesBaselineChain && defaultRecipe) {
    for (const ing of defaultRecipe.ingredients) {
      if (isMapRawResource(ing.item, items)) continue;
      const baseRate = baseline.intermediates[ing.item] ?? 0;
      if (baseRate <= EPS) continue;
      if ((withAlt.intermediates[ing.item] ?? 0) > EPS) continue;
      skipped.push({ itemId: ing.item, rate: baseRate });
    }
  }
  skipped.sort((a, b) => b.rate - a.rate || a.itemId.localeCompare(b.itemId));
  for (const s of skipped.slice(0, 3)) {
    badges.push({
      kind: "skips",
      label: `Skips ${resourceLabel(s.itemId, items)}`,
      itemId: s.itemId,
      score: s.rate,
    });
  }

  // Shorter chain only when we already have a real Skips badge (same-chain shortcut)
  if (skipped.length > 0) {
    const maxDepth = (expansion: Array<{ depth: number }>) =>
      expansion.reduce((m, e) => Math.max(m, e.depth), 0);
    const baseDepth = maxDepth(baseline.expansion);
    const altDepth = maxDepth(withAlt.expansion);
    if (baseDepth > 0 && altDepth < baseDepth) {
      badges.push({
        kind: "shorter-chain",
        label: "Shorter Chain",
        score: baseDepth - altDepth,
      });
    }
  }

  // Stable order for UI
  const order: Record<RecipeBadgeKind, number> = {
    removes: 0,
    skips: 1,
    "shorter-chain": 2,
    "simpler-machine": 3,
    "screw-free": 4,
    "resource-efficient": 5,
    "high-throughput": 6,
    pure: 7,
    alloy: 8,
    "machine-change": 9,
    "alt-input": 10,
    "heavier-machine": 11,
    introduces: 12,
  };
  badges.sort(
    (a, b) => (order[a.kind] ?? 50) - (order[b.kind] ?? 50) || a.label.localeCompare(b.label),
  );

  return { badges, baselineRawTotal, altRawTotal, baselineDemand, altDemand };
}

/** Convenience: badges only. */
export function badgeAlternate(
  altRecipe: Recipe,
  recipes: Recipe[],
  items: Record<string, ItemDef>,
  rate: number = BADGE_RATE,
): RecipeBadge[] {
  return compareAlternateToDefault(altRecipe, recipes, items, rate)?.badges ?? [];
}

/**
 * Among alts for `productId`, pick the Resource Efficient one with the highest
 * raw-savings score (for quick-select when multiple RE recipes exist).
 */
export function bestResourceEfficientAlt(
  productId: string,
  recipes: Recipe[],
  items: Record<string, ItemDef>,
): Recipe | undefined {
  const alts = listAlternateRecipes(recipes, productId);
  let best: { recipe: Recipe; savings: number } | undefined;
  for (const alt of alts) {
    const re = badgeAlternate(alt, recipes, items).find((b) => b.kind === "resource-efficient");
    if (re?.score == null) continue;
    if (!best || re.score > best.savings) best = { recipe: alt, savings: re.score };
  }
  return best?.recipe;
}

/**
 * Hover copy for badges that need a one-liner.
 * Item-named badges that are already clear (Screw-Free, Alloy, Adds X) omit tips.
 */
export function badgeTooltip(badge: RecipeBadge): string | undefined {
  switch (badge.kind) {
    case "alt-input":
      return badge.detail ?? "Different raw resources than the default recipe.";
    case "resource-efficient":
      return badge.score != null
        ? `About ${Math.round(badge.score * 100)}% less total raw demand than default (same raw set, water OK).`
        : "Less total raw demand than the default recipe.";
    case "high-throughput":
      return badge.score != null
        ? `${badge.score.toFixed(1)}× primary output rate vs default (items/min per machine).`
        : "Much higher primary output rate than the default recipe.";
    case "pure":
      return "Water-boosted yield — more product per ore; plan for water.";
    case "shorter-chain":
      return "Fewer crafting steps from this product to raws.";
    case "simpler-machine":
      return badge.detail ?? `Simpler building than the default recipe (${badge.label}).`;
    case "heavier-machine":
      return badge.detail ?? `Larger building than the default recipe (${badge.label}).`;
    case "machine-change":
      return badge.detail ?? `Different building than the default recipe (${badge.label}).`;
    // removes / skips / introduces: label is self-explanatory
    default:
      return undefined;
  }
}

/** Format ingredient/product lines for popover recipe breakdown. */
export function formatRecipeIoLine(
  io: { item: string; amount: number },
  durationSec: number,
  items: Record<string, ItemDef>,
): string {
  const perMin = durationSec > 0 ? (io.amount * 60) / durationSec : io.amount;
  const name = resourceLabel(io.item, items);
  const amt =
    Math.abs(perMin - Math.round(perMin)) < 1e-6 ? String(Math.round(perMin)) : perMin.toFixed(1);
  return `${amt}/min ${name}`;
}

export function formatRecipeSummary(recipe: Recipe, items: Record<string, ItemDef>): string {
  const ins = recipe.ingredients
    .map((ing) => formatRecipeIoLine(ing, recipe.durationSec, items))
    .join(" + ");
  const outs = recipe.products
    .map((p) => formatRecipeIoLine(p, recipe.durationSec, items))
    .join(" + ");
  return `${ins} → ${outs}`;
}

export { isMapRawResource, recipeShortName };

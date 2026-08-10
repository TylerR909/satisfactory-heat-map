import { RAW_RESOURCE_OPTIONS, WATER_RESOURCE_ID } from "@/lib/resources";
import type { ItemDef, RawDemand, Recipe } from "@/types";

export type ProductTarget = {
  productId: string;
  itemsPerMinute: number;
};

export type SolveOptions = {
  /**
   * Items treated as off-site / imported / recycled — expansion stops here
   * (their ingredient subtrees never become map raw demand).
   * Usually crafted intermediates; **Water** is also allowed so product plans can
   * import water without heatmap pressure.
   * Does not apply to top-level product targets (those always expand one level).
   */
  externalItems?: ReadonlySet<string> | readonly string[];
  /**
   * Mode B recipe picks: product itemId → recipe ClassName.
   * Only applied when the recipe primarily produces that item; invalid ids fall
   * back to the default production recipe. Defaults (no override) use the
   * preference-scored non-alternate when one exists.
   */
  recipeOverrides?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
};

/** One row in the Mode B Intermediates list (crafted only — map raws stay on Raw demand). */
export type ExpansionEntry = {
  itemId: string;
  itemsPerMinute: number;
  /** True when expansion stopped here (off-site / imported). */
  external: boolean;
  /**
   * Graph distance from a product target (0 = target). Used for UI order:
   * deeper precursors first, targets last.
   */
  depth: number;
};

export type SolveResult = {
  demand: RawDemand[];
  /** Intermediate craft rates for on-site expansion (item → items/min). */
  intermediates: Record<string, number>;
  /**
   * Items that were needed but marked external — rates for UI, not heatmap demand.
   */
  external: Record<string, number>;
  /**
   * Intermediates UI rows: deep precursors → … → direct recipe inputs → targets.
   * Duplicates are merged; position uses the **minimum** depth (bottom-most / closest to target).
   */
  expansion: ExpansionEntry[];
  /**
   * Net excess secondary outputs from expanded recipes (HOR, Polymer Resin, Silica, …)
   * after subtracting amounts consumed back into the chain. Display-only — not heatmap demand.
   */
  byproducts: Array<{ itemId: string; itemsPerMinute: number }>;
  /**
   * Crafted items we could not expand to map raws (missing recipe / alt not chosen).
   * Not placed on the heatmap as node demand.
   */
  unresolved: Array<{ itemId: string; itemsPerMinute: number; reason: string }>;
};

/** Dedicated Polymer Resin recipe (~130/min at 100%) + oil-chain byproduct paths. */
export const POLYMER_RESIN_ID = "Desc_PolymerResin_C";
export const POLYMER_RESIN_DEFAULT_RECIPE_ID = "Recipe_Alternate_PolymerResin_C";

/** Packaging vessels usually produced/recycled off the factory site. */
export const DEFAULT_EXTERNAL_ITEM_IDS = ["Desc_FluidCanister_C", "Desc_GasTank_C"] as const;

export function toExternalItemSet(
  items?: ReadonlySet<string> | readonly string[] | null,
): Set<string> {
  if (!items) return new Set();
  if (items instanceof Set) return items;
  return new Set(items);
}

const MAP_RAW_IDS = new Set<string>(RAW_RESOURCE_OPTIONS);

/** True if this item is a map resource node (heatmap can assign extractors). */
export function isMapRawResource(itemId: string, items: Record<string, ItemDef>): boolean {
  if (items[itemId]?.raw) return true;
  return MAP_RAW_IDS.has(itemId);
}

/**
 * Primary product of a recipe = first product line (Docs convention).
 * Secondary byproducts (silica from alumina, HOR from plastic) must not steal
 * the default recipe slot for that byproduct item.
 */
export function primaryProductId(r: Recipe): string | null {
  return r.products[0]?.item ?? null;
}

export function isUnpackageRecipe(r: Recipe): boolean {
  return /Unpackage/i.test(r.id) || /Unpackage/i.test(r.name);
}

/** Polymer-resin Residual Plastic / Residual Rubber (preferred over crude→plastic). */
export function isResidualPlasticOrRubber(r: Recipe): boolean {
  return (
    /ResidualPlastic|ResidualRubber/i.test(r.id) || /^Residual (Plastic|Rubber)$/i.test(r.name)
  );
}

/**
 * Score candidate recipes for a given product (higher wins).
 * Prefer mainline production over unpackaging / residual / alien-remains paths.
 *
 * Residual Plastic/Rubber is a first-class selectable path (Polymer plastics
 * quick-select) but is **not** preferred over crude-oil Plastic/Rubber for the
 * catalog default — so Defaults = game crude recipe and Residual lights up when
 * picked. Cycle-breaking still prefers Residual via {@link pickCycleBreakerRecipe}.
 */
export function recipePreferenceScore(r: Recipe): number {
  let s = 0;
  if (isUnpackageRecipe(r)) s -= 100;
  // Residual Plastic/Rubber: no penalty (selectable non-HD path). Other Residual/
  // Recycled names still demoted vs mainline.
  if (!isResidualPlasticOrRubber(r) && /Residual|Recycled/i.test(r.id + r.name)) {
    s -= 25;
  }
  // Prefer non-alternate when both are candidates
  if (r.alternate) s -= 15;
  const ingBlob = r.ingredients.map((i) => i.item).join(" ");
  if (/Parts_C|Hog|Spitter|Stinger|Hatcher|AlienProtein/i.test(ingBlob + r.id)) s -= 40;
  if (/Leaves|Wood|Mycelia/i.test(ingBlob)) s += 15;
  for (const ing of r.ingredients) {
    if (
      /Desc_Ore|Desc_Coal|Desc_Stone|Desc_Water|Desc_LiquidOil|Desc_Sulfur|Desc_RawQuartz|Desc_OreBauxite|Desc_OreGold|Desc_OreUranium|Desc_SAM|Desc_Nitrogen/i.test(
        ing.item,
      )
    ) {
      s += 30;
    }
  }
  s -= r.ingredients.length;
  return s;
}

/**
 * When a craft cycle is hit (e.g. Recycled Plastic ↔ Recycled Rubber), pick a
 * different recipe for this product whose ingredients are not already on the
 * visit stack — Residual Plastic/Rubber preferred (polymer seed into the loop).
 */
export function pickCycleBreakerRecipe(
  itemId: string,
  recipes: Recipe[],
  visiting: ReadonlySet<string>,
  avoidRecipeId?: string | null,
): Recipe | undefined {
  const list = recipesForProduction(recipes, itemId).filter((r) => !isUnpackageRecipe(r));
  const usable = list.filter((r) => {
    if (avoidRecipeId && r.id === avoidRecipeId) return false;
    // All ingredients free of the active cycle stack
    return r.ingredients.every((ing) => !visiting.has(ing.item));
  });
  if (usable.length === 0) return undefined;
  usable.sort(
    (a, b) =>
      // Residual polymer path first, then general preference
      (isResidualPlasticOrRubber(b) ? 100 : 0) - (isResidualPlasticOrRubber(a) ? 100 : 0) ||
      recipePreferenceScore(b) - recipePreferenceScore(a) ||
      a.id.localeCompare(b.id),
  );
  return usable[0];
}

/** All recipes whose primary product is `itemId` (includes unpackage). */
export function recipesForPrimaryProduct(recipes: Recipe[], itemId: string): Recipe[] {
  return recipes.filter((r) => primaryProductId(r) === itemId);
}

/** True if any product line is `itemId` (primary or byproduct). */
export function recipeProducesItem(r: Recipe, itemId: string): boolean {
  return r.products.some((p) => p.item === itemId);
}

/**
 * Recipes that can supply `itemId` for expand / picker:
 * - Prefer recipes where it is the **primary** product (Docs first product line)
 * - If none exist (byproduct-only items, e.g. Dissolved Silica), fall back to any
 *   recipe that outputs it in a secondary product slot
 * - **Polymer Resin** special case: primary dedicated recipe plus Fuel / HOR
 *   byproduct paths (selectable alts) — without promoting Fuel to default
 *
 * This keeps Silica from using Alumina Solution (byproduct) when a primary Silica
 * recipe exists, while still expanding Distilled Silica → Dissolved Silica via
 * Quartz Purification.
 */
export function recipesForProduction(recipes: Recipe[], itemId: string): Recipe[] {
  const asPrimary = recipesForPrimaryProduct(recipes, itemId);
  if (asPrimary.length === 0) {
    return recipes.filter((r) => recipeProducesItem(r, itemId) && !isUnpackageRecipe(r));
  }
  if (itemId === POLYMER_RESIN_ID) {
    const asByproduct = recipes.filter(
      (r) =>
        recipeProducesItem(r, itemId) && primaryProductId(r) !== itemId && !isUnpackageRecipe(r),
    );
    const seen = new Set(asPrimary.map((r) => r.id));
    return [...asPrimary, ...asByproduct.filter((r) => !seen.has(r.id))];
  }
  return asPrimary;
}

/**
 * Production recipes a user may pick for an intermediate/product:
 * default (preference-scored) first, then alternates. Unpackage paths are
 * omitted unless they are the only way to make the item.
 * Default is always chosen among **primary** producers when any exist (so
 * Polymer Resin defaults to the dedicated 130/min recipe, not Fuel-as-byproduct).
 */
export function listProductionRecipes(recipes: Recipe[], itemId: string): Recipe[] {
  const list = recipesForProduction(recipes, itemId);
  if (list.length === 0) return [];

  const nonUnpkg = list.filter((r) => !isUnpackageRecipe(r));
  const pool = nonUnpkg.length > 0 ? nonUnpkg : list;
  const primaryOnly = pool.filter((r) => primaryProductId(r) === itemId);
  const defaultRecipe = pickDefaultRecipe(primaryOnly.length > 0 ? primaryOnly : pool);
  if (!defaultRecipe) return [];

  const alts = pool
    .filter((r) => r.id !== defaultRecipe.id)
    .sort(
      (a, b) => recipePreferenceScore(b) - recipePreferenceScore(a) || a.name.localeCompare(b.name),
    );
  return [defaultRecipe, ...alts];
}

/** Alternates only (excludes the default production recipe). */
export function listAlternateRecipes(recipes: Recipe[], itemId: string): Recipe[] {
  const all = listProductionRecipes(recipes, itemId);
  if (all.length <= 1) return [];
  return all.slice(1);
}

function pickDefaultRecipe(pool: Recipe[]): Recipe | undefined {
  const nonAlt = pool.filter((r) => !r.alternate && !isUnpackageRecipe(r));
  const nonUnpkg = pool.filter((r) => !isUnpackageRecipe(r));
  const candidates = nonAlt.length > 0 ? nonAlt : nonUnpkg.length > 0 ? nonUnpkg : pool;
  const sorted = [...candidates].sort(
    (a, b) => recipePreferenceScore(b) - recipePreferenceScore(a) || a.id.localeCompare(b.id),
  );
  return sorted[0];
}

/**
 * Map itemId → best recipe that produces it (primary preferred; byproduct-only fallback).
 * Includes alternates only when no suitable non-alt recipe exists (e.g. turbofuel).
 * Byproduct-only items (Dissolved Silica) resolve to the recipe that outputs them.
 */
export function indexProductionRecipes(recipes: Recipe[]): Map<string, Recipe> {
  /** itemId → recipes where this item is the primary product */
  const byPrimary = new Map<string, Recipe[]>();
  /** itemId → recipes that output it in any product slot */
  const byAny = new Map<string, Recipe[]>();

  for (const r of recipes) {
    for (let i = 0; i < r.products.length; i++) {
      const item = r.products[i]?.item;
      if (!item) continue;
      const anyList = byAny.get(item) ?? [];
      anyList.push(r);
      byAny.set(item, anyList);
      if (i === 0) {
        const primList = byPrimary.get(item) ?? [];
        primList.push(r);
        byPrimary.set(item, primList);
      }
    }
  }

  const byProduct = new Map<string, Recipe>();
  for (const item of byAny.keys()) {
    const pool = byPrimary.get(item) ?? byAny.get(item) ?? [];
    const best = pickDefaultRecipe(pool);
    if (best) byProduct.set(item, best);
  }
  return byProduct;
}

/** recipe ClassName → Recipe */
export function indexRecipesById(recipes: Recipe[]): Map<string, Recipe> {
  const m = new Map<string, Recipe>();
  for (const r of recipes) m.set(r.id, r);
  return m;
}

function toOverrideMap(
  overrides?: ReadonlyMap<string, string> | Readonly<Record<string, string>> | null,
): Map<string, string> {
  if (!overrides) return new Map();
  if (overrides instanceof Map) return new Map(overrides);
  return new Map(Object.entries(overrides));
}

/**
 * Resolve the production recipe for a product item, honoring an optional override.
 * Invalid overrides (recipe does not output the item) fall back to default.
 * Accepts primary or byproduct product lines.
 */
export function resolveProductionRecipe(
  itemId: string,
  recipes: Recipe[],
  byProduct?: Map<string, Recipe>,
  byId?: Map<string, Recipe>,
  overrideRecipeId?: string | null,
): Recipe | undefined {
  const defaults = byProduct ?? indexProductionRecipes(recipes);
  const recipeById = byId ?? indexRecipesById(recipes);
  if (overrideRecipeId) {
    const forced = recipeById.get(overrideRecipeId);
    if (forced && recipeProducesItem(forced, itemId) && !isUnpackageRecipe(forced)) {
      return forced;
    }
    // Allow unpackage override only when it is the default path
    if (forced && recipeProducesItem(forced, itemId)) {
      const def = defaults.get(itemId);
      if (def?.id === forced.id) return forced;
    }
  }
  return defaults.get(itemId);
}

/** Short display name for alt UI: strip "Alternate: " prefix. */
export function recipeShortName(r: Recipe): string {
  return r.name.replace(/^Alternate:\s*/i, "").trim() || r.name;
}

/** Max chars drawn inside the 28px alt picker button (hard cut, no ellipsis). */
const RECIPE_BUTTON_LABEL_MAX = 4;

function cutButtonToken(word: string): string {
  if (word.length <= RECIPE_BUTTON_LABEL_MAX) return word;
  return word.slice(0, RECIPE_BUTTON_LABEL_MAX);
}

/**
 * Candidate 4-char tokens for a recipe button.
 * Default order: first word first (Pure, Slop). When `skipSharedFirst`, later
 * words lead so peer collisions like Heavy Flexible / Heavy Encased → Flex / Enca.
 */
function buttonLabelCandidates(r: Recipe, skipSharedFirst = false): string[] {
  const short = recipeShortName(r);
  const words = short.split(/\s+/).filter(Boolean);
  if (words.length === 0) return ["Alt"];
  const firstWord = words[0];
  const ordered =
    skipSharedFirst && words.length > 1 && firstWord ? [...words.slice(1), firstWord] : words;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of ordered) {
    const t = cutButtonToken(w);
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  // Sliding 4-char windows on compacted name as last resort (disambiguation)
  const compact = short.replace(/\s+/g, "");
  for (let i = 0; i + RECIPE_BUTTON_LABEL_MAX <= compact.length; i++) {
    const t = compact.slice(i, i + RECIPE_BUTTON_LABEL_MAX);
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.length > 0 ? out : ["Alt"];
}

/**
 * Assign non-colliding button labels for a peer group (alts for one product).
 * Stable by recipe id so the same set always maps the same way.
 */
export function recipeButtonLabels(peers: readonly Recipe[]): Map<string, string> {
  // First words that appear more than once among peers → skip them as primary pick
  const firstCounts = new Map<string, number>();
  for (const r of peers) {
    const w = recipeShortName(r).split(/\s+/).find(Boolean)?.toLowerCase();
    if (!w) continue;
    firstCounts.set(w, (firstCounts.get(w) ?? 0) + 1);
  }
  const sharedFirst = new Set([...firstCounts.entries()].filter(([, n]) => n > 1).map(([w]) => w));

  const used = new Set<string>();
  const out = new Map<string, string>();
  const sorted = [...peers].sort((a, b) => a.id.localeCompare(b.id));
  for (const r of sorted) {
    const first = recipeShortName(r).split(/\s+/).find(Boolean)?.toLowerCase() ?? "";
    const cands = buttonLabelCandidates(r, sharedFirst.has(first));
    let pick = cands.find((c) => !used.has(c.toLowerCase())) ?? cands[0] ?? "Alt";
    // Last ditch: pad with unique suffix char from id
    if (used.has(pick.toLowerCase())) {
      for (let n = 0; n < 36; n++) {
        const suffix = n.toString(36);
        const trial = `${pick.slice(0, RECIPE_BUTTON_LABEL_MAX - 1)}${suffix}`;
        if (!used.has(trial.toLowerCase())) {
          pick = trial;
          break;
        }
      }
    }
    used.add(pick.toLowerCase());
    out.set(r.id, pick);
  }
  return out;
}

/**
 * Compact label for the squarish alt button.
 * Pass `peers` (other alts for the same product) so collisions like
 * "Heavy Flexible" / "Heavy Encased" become Flex / Enca instead of both Heav.
 */
export function recipeButtonLabel(r: Recipe, peers?: readonly Recipe[]): string {
  if (peers && peers.length > 0) {
    const group = peers.some((p) => p.id === r.id) ? peers : [r, ...peers];
    return recipeButtonLabels(group).get(r.id) ?? buttonLabelCandidates(r)[0] ?? "Alt";
  }
  return buttonLabelCandidates(r)[0] ?? "Alt";
}

/**
 * Expand one or more product targets into **map raw** demand for heatmap scoring.
 * Intermediate crafted items never appear as node demand unless they are true map raws.
 *
 * `externalItems` stops expansion at those crafted ids (import / off-site / recycled) —
 * their ingredient subtrees never become map demand. **Water** is the one map raw also
 * listed under Intermediates so it can be marked off-site (piped / extracted elsewhere);
 * other ores stay heatmap-only (off-site via their ingot/intermediate instead).
 * Top-level product targets always expand at least one recipe level so a product
 * row is never a no-op.
 */
export function solveProductsToRaw(
  targets: ProductTarget[],
  recipes: Recipe[],
  items: Record<string, ItemDef>,
  options?: SolveOptions,
): SolveResult {
  const externalSet = toExternalItemSet(options?.externalItems);
  const overrideMap = toOverrideMap(options?.recipeOverrides);
  const byProduct = indexProductionRecipes(recipes);
  const byId = indexRecipesById(recipes);
  const rawNeed = new Map<string, number>();
  const intermediates: Record<string, number> = {};
  /** On-site map raws that also appear under Intermediates (currently Water only). */
  const expansionRaws = new Map<string, number>();
  const externalNeed = new Map<string, number>();
  /** Secondary outputs emitted while expanding (before netting consumption). */
  const byproductOut = new Map<string, number>();
  /** Total non-raw need() rates (for netting excess byproducts). */
  const totalNeed = new Map<string, number>();
  const unresolvedMap = new Map<string, { rate: number; reason: string }>();
  const visiting = new Set<string>();
  /**
   * Placement for Intermediates UI: min depth (closer to target = lower on screen) and
   * visit seq at that depth (recipe ingredient order among siblings).
   */
  const place = new Map<string, { depth: number; seq: number }>();
  let visitSeq = 0;

  function notePlace(itemId: string, depth: number) {
    const prev = place.get(itemId);
    // Bottom-most wins: smaller depth (nearer product target). Re-seq when depth improves.
    if (prev === undefined || depth < prev.depth) {
      place.set(itemId, { depth, seq: visitSeq++ });
    }
  }

  function addRaw(itemId: string, rate: number) {
    rawNeed.set(itemId, (rawNeed.get(itemId) ?? 0) + rate);
  }

  function addExternal(itemId: string, rate: number, depth: number) {
    externalNeed.set(itemId, (externalNeed.get(itemId) ?? 0) + rate);
    notePlace(itemId, depth);
  }

  function addUnresolved(itemId: string, rate: number, reason: string) {
    const prev = unresolvedMap.get(itemId);
    unresolvedMap.set(itemId, {
      rate: (prev?.rate ?? 0) + rate,
      reason: prev?.reason ?? reason,
    });
  }

  /**
   * @param asTarget when true, ignore externalItems so product rows always expand.
   * @param depth 0 = product target; +1 per recipe hop toward raws.
   */
  function need(itemId: string, rate: number, asTarget = false, depth = 0) {
    if (rate <= 1e-9) return;

    // Map raws stop expansion (heatmap node demand). Water is special: listed in
    // Intermediates so the user can mark it off-site without inventing a fake intermediate.
    if (isMapRawResource(itemId, items)) {
      totalNeed.set(itemId, (totalNeed.get(itemId) ?? 0) + rate);
      if (itemId === WATER_RESOURCE_ID) {
        if (!asTarget && externalSet.has(itemId)) {
          addExternal(itemId, rate, depth);
          return;
        }
        addRaw(itemId, rate);
        expansionRaws.set(itemId, (expansionRaws.get(itemId) ?? 0) + rate);
        notePlace(itemId, depth);
        return;
      }
      addRaw(itemId, rate);
      return;
    }

    totalNeed.set(itemId, (totalNeed.get(itemId) ?? 0) + rate);

    // Off-site / imported crafted input — do not pull ingredient raws into the site
    if (!asTarget && externalSet.has(itemId)) {
      addExternal(itemId, rate, depth);
      return;
    }

    if (visiting.has(itemId)) {
      // Cycle (classic: Recycled Plastic ↔ Recycled Rubber). Try a seed recipe
      // whose inputs are not on the stack (Residual Plastic/Rubber from polymer).
      const cyclingRecipeId = overrideMap.get(itemId) ?? byProduct.get(itemId)?.id;
      const breaker = pickCycleBreakerRecipe(itemId, recipes, visiting, cyclingRecipeId);
      if (breaker) {
        expandWithRecipe(itemId, rate, breaker, depth);
        return;
      }
      addUnresolved(itemId, rate, "recipe cycle");
      return;
    }

    const recipe = resolveProductionRecipe(
      itemId,
      recipes,
      byProduct,
      byId,
      overrideMap.get(itemId),
    );
    if (!recipe) {
      // Crafted item with no production recipe we accept — not a map raw
      addUnresolved(itemId, rate, "no production recipe");
      return;
    }

    visiting.add(itemId);
    expandWithRecipe(itemId, rate, recipe, depth);
    visiting.delete(itemId);
  }

  /** Expand one recipe hop; caller owns `visiting` for the product item. */
  function expandWithRecipe(itemId: string, rate: number, recipe: Recipe, depth: number) {
    intermediates[itemId] = (intermediates[itemId] ?? 0) + rate;
    notePlace(itemId, depth);

    const productLine = recipe.products.find((p) => p.item === itemId);
    if (!productLine || productLine.amount <= 0) {
      addUnresolved(itemId, rate, "recipe missing product line");
      return;
    }

    const craftsPerMin = rate / productLine.amount;
    // Secondary product slots = byproducts relative to the item we're expanding for
    for (const p of recipe.products) {
      if (p.item === itemId || p.amount <= 0) continue;
      byproductOut.set(p.item, (byproductOut.get(p.item) ?? 0) + craftsPerMin * p.amount);
    }
    for (const ing of recipe.ingredients) {
      need(ing.item, craftsPerMin * ing.amount, false, depth + 1);
    }
  }

  for (const t of targets) {
    if (!t.productId || t.itemsPerMinute <= 0) continue;
    need(t.productId, t.itemsPerMinute, true, 0);
  }

  const demand: RawDemand[] = [...rawNeed.entries()]
    .map(([resource, itemsPerMinute]) => ({ resource, itemsPerMinute }))
    .sort((a, b) => b.itemsPerMinute - a.itemsPerMinute);

  const external: Record<string, number> = Object.fromEntries(externalNeed.entries());

  // Deep precursors first (high depth), targets last (depth 0); ties by recipe visit seq
  const expansion: ExpansionEntry[] = [...place.entries()]
    .map(([itemId, { depth, seq }]) => {
      const extRate = externalNeed.get(itemId);
      const onSite = intermediates[itemId] ?? expansionRaws.get(itemId);
      const isExt = extRate != null && extRate > 1e-9 && !(onSite != null && onSite > 1e-9);
      const itemsPerMinute = isExt ? (extRate ?? 0) : (onSite ?? extRate ?? 0);
      return {
        itemId,
        itemsPerMinute,
        external: isExt,
        depth,
        seq,
      };
    })
    .filter((e) => e.itemsPerMinute > 1e-9)
    .sort((a, b) => b.depth - a.depth || a.seq - b.seq || a.itemId.localeCompare(b.itemId))
    .map(({ itemId, itemsPerMinute, external: ext, depth }) => ({
      itemId,
      itemsPerMinute,
      external: ext,
      depth,
    }));

  const unresolved = [...unresolvedMap.entries()]
    .map(([itemId, v]) => ({
      itemId,
      itemsPerMinute: v.rate,
      reason: v.reason,
    }))
    .sort((a, b) => b.itemsPerMinute - a.itemsPerMinute);

  // Net excess byproducts: emitted as secondary outputs minus chain consumption
  const byproducts: Array<{ itemId: string; itemsPerMinute: number }> = [];
  for (const [itemId, produced] of byproductOut) {
    const consumed = totalNeed.get(itemId) ?? 0;
    const excess = produced - consumed;
    if (excess > 1e-6) byproducts.push({ itemId, itemsPerMinute: excess });
  }
  byproducts.sort(
    (a, b) => b.itemsPerMinute - a.itemsPerMinute || a.itemId.localeCompare(b.itemId),
  );

  return { demand, intermediates, external, expansion, byproducts, unresolved };
}

/** @deprecated Prefer {@link solveProductsToRaw} for multi-target plans. */
export function solveProductToRaw(
  productId: string,
  itemsPerMinute: number,
  recipes: Recipe[],
  items: Record<string, ItemDef>,
  options?: SolveOptions,
): SolveResult {
  return solveProductsToRaw([{ productId, itemsPerMinute }], recipes, items, options);
}

import { RAW_RESOURCE_OPTIONS } from "@/lib/resources";
import type { ItemDef, RawDemand, Recipe } from "@/types";

export type ProductTarget = {
  productId: string;
  itemsPerMinute: number;
};

export type SolveOptions = {
  /**
   * Crafted items treated as off-site / imported / recycled — expansion stops here
   * (their ingredient subtrees never become map raw demand).
   * Does not apply to top-level product targets (those always expand one level).
   */
  externalItems?: ReadonlySet<string> | readonly string[];
};

/** One row in the Mode B Expansion list (crafted only — map raws stay on Active raw demand). */
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
   * Expansion UI rows: deep precursors → … → direct recipe inputs → targets.
   * Duplicates are merged; position uses the **minimum** depth (bottom-most / closest to target).
   */
  expansion: ExpansionEntry[];
  /**
   * Crafted items we could not expand to map raws (missing recipe / alt not chosen).
   * Not placed on the heatmap as node demand.
   */
  unresolved: Array<{ itemId: string; itemsPerMinute: number; reason: string }>;
};

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
function primaryProductId(r: Recipe): string | null {
  return r.products[0]?.item ?? null;
}

/**
 * Score candidate recipes for a given product (higher wins).
 * Prefer mainline production over unpackaging / residual / alien-remains paths.
 */
function recipePreferenceScore(r: Recipe): number {
  let s = 0;
  if (/Unpackage/i.test(r.id) || /Unpackage/i.test(r.name)) s -= 100;
  if (/Residual|Recycled/i.test(r.id + r.name)) s -= 25;
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
 * Map itemId → best recipe that **primarily** produces it.
 * Includes alternates only when no suitable non-alt recipe exists (e.g. turbofuel).
 */
export function indexProductionRecipes(recipes: Recipe[]): Map<string, Recipe> {
  /** itemId → recipes where this item is the primary product */
  const byPrimary = new Map<string, Recipe[]>();

  for (const r of recipes) {
    const primary = primaryProductId(r);
    if (!primary) continue;
    // Skip pure unpackage as primary production unless nothing else exists (handled in pick)
    const list = byPrimary.get(primary) ?? [];
    list.push(r);
    byPrimary.set(primary, list);
  }

  const byProduct = new Map<string, Recipe>();
  for (const [item, list] of byPrimary) {
    const nonAlt = list.filter((r) => !r.alternate && !/Unpackage/i.test(r.id));
    const nonUnpkg = list.filter((r) => !/Unpackage/i.test(r.id));
    const pool = nonAlt.length > 0 ? nonAlt : nonUnpkg.length > 0 ? nonUnpkg : list;
    pool.sort(
      (a, b) => recipePreferenceScore(b) - recipePreferenceScore(a) || a.id.localeCompare(b.id),
    );
    const best = pool[0];
    if (best) byProduct.set(item, best);
  }
  return byProduct;
}

/**
 * Expand one or more product targets into **map raw** demand for heatmap scoring.
 * Intermediate crafted items never appear as node demand unless they are true map raws.
 *
 * `externalItems` stops expansion at those crafted ids (import / off-site / recycled) —
 * their ingredient subtrees never become map demand. Top-level product targets always
 * expand at least one recipe level so a product row is never a no-op.
 */
export function solveProductsToRaw(
  targets: ProductTarget[],
  recipes: Recipe[],
  items: Record<string, ItemDef>,
  options?: SolveOptions,
): SolveResult {
  const externalSet = toExternalItemSet(options?.externalItems);
  const byProduct = indexProductionRecipes(recipes);
  const rawNeed = new Map<string, number>();
  const intermediates: Record<string, number> = {};
  const externalNeed = new Map<string, number>();
  const unresolvedMap = new Map<string, { rate: number; reason: string }>();
  const visiting = new Set<string>();
  /**
   * Placement for Expansion UI: min depth (closer to target = lower on screen) and
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

    // Map raws stop expansion (heatmap node demand) — not listed in Expansion UI
    if (isMapRawResource(itemId, items)) {
      addRaw(itemId, rate);
      return;
    }

    // Off-site / imported crafted input — do not pull ingredient raws into the site
    if (!asTarget && externalSet.has(itemId)) {
      addExternal(itemId, rate, depth);
      return;
    }

    if (visiting.has(itemId)) {
      // Cycle in crafted chain — do not invent map nodes for intermediates
      addUnresolved(itemId, rate, "recipe cycle");
      return;
    }

    const recipe = byProduct.get(itemId);
    if (!recipe) {
      // Crafted item with no production recipe we accept — not a map raw
      addUnresolved(itemId, rate, "no production recipe");
      return;
    }

    visiting.add(itemId);
    intermediates[itemId] = (intermediates[itemId] ?? 0) + rate;
    notePlace(itemId, depth);

    const productLine = recipe.products.find((p) => p.item === itemId);
    if (!productLine || productLine.amount <= 0) {
      visiting.delete(itemId);
      addUnresolved(itemId, rate, "recipe missing product line");
      return;
    }

    const craftsPerMin = rate / productLine.amount;
    // Recipe ingredient order → sibling seq among the next depth band
    for (const ing of recipe.ingredients) {
      need(ing.item, craftsPerMin * ing.amount, false, depth + 1);
    }
    visiting.delete(itemId);
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
      const onSite = intermediates[itemId];
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

  return { demand, intermediates, external, expansion, unresolved };
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

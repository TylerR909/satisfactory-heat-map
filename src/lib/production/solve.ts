import { RAW_RESOURCE_OPTIONS } from "@/lib/resources";
import type { ItemDef, RawDemand, Recipe } from "@/types";

export type ProductTarget = {
  productId: string;
  itemsPerMinute: number;
};

export type SolveResult = {
  demand: RawDemand[];
  /** Intermediate craft rates for UI debug (item → items/min). */
  intermediates: Record<string, number>;
  /**
   * Crafted items we could not expand to map raws (missing recipe / alt not chosen).
   * Not placed on the heatmap as node demand.
   */
  unresolved: Array<{ itemId: string; itemsPerMinute: number; reason: string }>;
};

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
 */
export function solveProductsToRaw(
  targets: ProductTarget[],
  recipes: Recipe[],
  items: Record<string, ItemDef>,
): SolveResult {
  const byProduct = indexProductionRecipes(recipes);
  const rawNeed = new Map<string, number>();
  const intermediates: Record<string, number> = {};
  const unresolvedMap = new Map<string, { rate: number; reason: string }>();
  const visiting = new Set<string>();

  function addRaw(itemId: string, rate: number) {
    rawNeed.set(itemId, (rawNeed.get(itemId) ?? 0) + rate);
  }

  function addUnresolved(itemId: string, rate: number, reason: string) {
    const prev = unresolvedMap.get(itemId);
    unresolvedMap.set(itemId, {
      rate: (prev?.rate ?? 0) + rate,
      reason: prev?.reason ?? reason,
    });
  }

  function need(itemId: string, rate: number) {
    if (rate <= 1e-9) return;

    // Map raws stop expansion (heatmap node demand)
    if (isMapRawResource(itemId, items)) {
      addRaw(itemId, rate);
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

    const productLine = recipe.products.find((p) => p.item === itemId);
    if (!productLine || productLine.amount <= 0) {
      visiting.delete(itemId);
      addUnresolved(itemId, rate, "recipe missing product line");
      return;
    }

    const craftsPerMin = rate / productLine.amount;
    for (const ing of recipe.ingredients) {
      need(ing.item, craftsPerMin * ing.amount);
    }
    visiting.delete(itemId);
  }

  for (const t of targets) {
    if (!t.productId || t.itemsPerMinute <= 0) continue;
    need(t.productId, t.itemsPerMinute);
  }

  const demand: RawDemand[] = [...rawNeed.entries()]
    .map(([resource, itemsPerMinute]) => ({ resource, itemsPerMinute }))
    .sort((a, b) => b.itemsPerMinute - a.itemsPerMinute);

  const unresolved = [...unresolvedMap.entries()]
    .map(([itemId, v]) => ({
      itemId,
      itemsPerMinute: v.rate,
      reason: v.reason,
    }))
    .sort((a, b) => b.itemsPerMinute - a.itemsPerMinute);

  return { demand, intermediates, unresolved };
}

/** @deprecated Prefer {@link solveProductsToRaw} for multi-target plans. */
export function solveProductToRaw(
  productId: string,
  itemsPerMinute: number,
  recipes: Recipe[],
  items: Record<string, ItemDef>,
): SolveResult {
  return solveProductsToRaw([{ productId, itemsPerMinute }], recipes, items);
}

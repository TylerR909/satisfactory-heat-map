/**
 * Mode B quick-select presets for alternate recipes.
 * Only applies to items currently in the expand (or product targets).
 */
import { bestResourceEfficientAlt } from "@/lib/production/badges";
import {
  canMinimizeInputTypes,
  minimizeInputTypeOverrides,
} from "@/lib/production/minimizeInputTypes";
import { listAlternateRecipes, primaryProductId, recipeShortName } from "@/lib/production/solve";
import type { ItemDef, Recipe } from "@/types";

export type QuickSelectContext = {
  recipes: Recipe[];
  items: Record<string, ItemDef>;
  /** Item ids currently listed under Intermediates & Alternates */
  expansionItemIds: ReadonlySet<string>;
  /** Active product target ids */
  productTargetIds: ReadonlySet<string>;
  /**
   * Product targets with rates — required for expand-based presets
   * (Minimize Input Types). Optional for fixed packs.
   */
  productTargets?: ReadonlyArray<{ productId: string; itemsPerMinute: number }>;
  /** Off-site intermediates (and Water) for expand scoring. */
  externalItems?: readonly string[];
};

export type QuickSelectResult =
  | { kind: "clear" }
  | { kind: "merge"; overrides: Record<string, string> }
  /** Replace all overrides (clear then set) — used by expand optimizers. */
  | { kind: "replace"; overrides: Record<string, string> };

/** Visual chip in the quick-select list — mirrors alt-recipe badges when applicable. */
export type QuickSelectChip =
  | {
      kind: "badge";
      badgeKind:
        | "pure"
        | "screw-free"
        | "alloy"
        | "resource-efficient"
        | "high-throughput"
        | "removes";
      text: string;
    }
  | { kind: "diamond" }; // empty alt button glyph (Defaults)

export type QuickSelect = {
  id: string;
  label: string;
  /** Short blurb for the popover */
  description: string;
  /** Optional pill / diamond matching Intermediates alt UX */
  chip?: QuickSelectChip;
  /** True when at least one of this preset's picks is in-play */
  applicable: (ctx: QuickSelectContext) => boolean;
  resolve: (ctx: QuickSelectContext) => QuickSelectResult;
};

function minimizeInput(ctx: QuickSelectContext) {
  const productTargets =
    ctx.productTargets?.filter((t) => t.productId && t.itemsPerMinute > 0) ??
    [...ctx.productTargetIds].map((productId) => ({ productId, itemsPerMinute: 10 }));
  return minimizeInputTypeOverrides({
    recipes: ctx.recipes,
    items: ctx.items,
    productTargets,
    externalItems: ctx.externalItems,
  });
}

function inPlay(ctx: QuickSelectContext, itemId: string): boolean {
  return ctx.expansionItemIds.has(itemId) || ctx.productTargetIds.has(itemId);
}

/** Count how many of the given product ids are in-play. */
function inPlayCount(ctx: QuickSelectContext, itemIds: string[]): number {
  return itemIds.filter((id) => inPlay(ctx, id)).length;
}

function findRecipe(recipes: Recipe[], id: string): Recipe | undefined {
  return recipes.find((r) => r.id === id);
}

/**
 * Fixed product → recipe override, only if product is in-play and recipe exists.
 */
function fixedOverrides(
  ctx: QuickSelectContext,
  pairs: Array<{ productId: string; recipeId: string }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { productId, recipeId } of pairs) {
    if (!inPlay(ctx, productId)) continue;
    const r = findRecipe(ctx.recipes, recipeId);
    if (!r || primaryProductId(r) !== productId) continue;
    out[productId] = recipeId;
  }
  return out;
}

/** Prefer a single screw-free alt per product (stable pick). */
function preferredScrewFreeAlt(recipes: Recipe[], productId: string): Recipe | undefined {
  const alts = listAlternateRecipes(recipes, productId);
  const screwFree = alts.filter((r) => !r.ingredients.some((i) => i.item === "Desc_IronScrew_C"));
  if (screwFree.length === 0) return undefined;
  // Prefer Encased HMF / Stitched RIP / Steel Rotor by name, else first by id
  screwFree.sort((a, b) => {
    const score = (r: Recipe) => {
      let s = 0;
      if (/Stitched|Encased|Steel Rotor|Cast Screw/i.test(r.name)) s += 5;
      if (/Adhered|Bolted/i.test(r.name)) s -= 1;
      return s;
    };
    return score(b) - score(a) || a.id.localeCompare(b.id);
  });
  return screwFree[0];
}

/**
 * All Pure-* alternate recipes in the catalog (primary product → recipe).
 */
export function pureAltByProduct(recipes: Recipe[]): Map<string, Recipe> {
  const m = new Map<string, Recipe>();
  for (const r of recipes) {
    if (!r.alternate) continue;
    if (!/\bPure\b/i.test(r.name) && !/PureAluminum/i.test(r.id)) continue;
    const p = primaryProductId(r);
    if (!p) continue;
    // One pure per product — prefer id with Pure in name
    const prev = m.get(p);
    if (!prev || recipeShortName(r).localeCompare(recipeShortName(prev)) < 0) {
      m.set(p, r);
    }
  }
  return m;
}

export const QUICK_SELECTS: QuickSelect[] = [
  {
    id: "defaults",
    label: "Defaults",
    description: "Clear all alternate picks — every step uses its default recipe.",
    chip: { kind: "diamond" },
    applicable: () => true,
    resolve: () => ({ kind: "clear" }),
  },
  {
    id: "all-pure",
    label: "All Pure",
    description: "Pick every Pure-* alt for items in this expand (water-boosted ingots/crystals).",
    chip: { kind: "badge", badgeKind: "pure", text: "Pure" },
    applicable: (ctx) => {
      const pure = pureAltByProduct(ctx.recipes);
      for (const productId of pure.keys()) {
        if (inPlay(ctx, productId)) return true;
      }
      return false;
    },
    resolve: (ctx) => {
      const pure = pureAltByProduct(ctx.recipes);
      const overrides: Record<string, string> = {};
      for (const [productId, r] of pure) {
        if (inPlay(ctx, productId)) overrides[productId] = r.id;
      }
      return { kind: "merge", overrides };
    },
  },
  {
    id: "no-screws",
    label: "No Screws",
    description:
      "Prefer screw-free alts for in-play steps (Stitched RIP, Steel Rotor, Heavy Encased, …).",
    chip: { kind: "badge", badgeKind: "screw-free", text: "Screw-Free" },
    applicable: (ctx) => {
      for (const id of [...ctx.expansionItemIds, ...ctx.productTargetIds]) {
        if (preferredScrewFreeAlt(ctx.recipes, id)) return true;
      }
      return false;
    },
    resolve: (ctx) => {
      const overrides: Record<string, string> = {};
      const ids = new Set([...ctx.expansionItemIds, ...ctx.productTargetIds]);
      for (const productId of ids) {
        const alt = preferredScrewFreeAlt(ctx.recipes, productId);
        if (alt) overrides[productId] = alt.id;
      }
      return { kind: "merge", overrides };
    },
  },
  {
    id: "resource-efficient",
    label: "Resource Efficient",
    description:
      "Per in-play product, the alt with the best raw-savings score (skips swaps that only look efficient by introducing new ores).",
    chip: { kind: "badge", badgeKind: "resource-efficient", text: "Resource Efficient" },
    applicable: (ctx) => {
      for (const id of [...ctx.expansionItemIds, ...ctx.productTargetIds]) {
        if (bestResourceEfficientAlt(id, ctx.recipes, ctx.items)) return true;
      }
      return false;
    },
    resolve: (ctx) => {
      const overrides: Record<string, string> = {};
      const ids = new Set([...ctx.expansionItemIds, ...ctx.productTargetIds]);
      for (const productId of ids) {
        const alt = bestResourceEfficientAlt(productId, ctx.recipes, ctx.items);
        if (alt) overrides[productId] = alt.id;
      }
      return { kind: "merge", overrides };
    },
  },
  {
    id: "minimize-input-types",
    label: "Minimize Input Types",
    description:
      "Greedy expand search: only keeps alts that strictly cut distinct map raws (not tonnage-only swaps like Tempered Caterium). Partial Removes that leave a raw elsewhere are skipped.",
    chip: { kind: "badge", badgeKind: "removes", text: "Fewer Raws" },
    applicable: (ctx) => {
      if (
        ctx.productTargetIds.size === 0 &&
        !(ctx.productTargets && ctx.productTargets.length > 0)
      ) {
        return false;
      }
      return canMinimizeInputTypes({
        recipes: ctx.recipes,
        items: ctx.items,
        productTargets:
          ctx.productTargets?.filter((t) => t.productId && t.itemsPerMinute > 0) ??
          [...ctx.productTargetIds].map((productId) => ({ productId, itemsPerMinute: 10 })),
        externalItems: ctx.externalItems,
      });
    },
    resolve: (ctx) => {
      const { overrides } = minimizeInput(ctx);
      return { kind: "replace", overrides };
    },
  },
  {
    id: "sloppy-pure-al",
    label: "Sloppy + Pure Al",
    description: "Sloppy Alumina + Pure Aluminum Ingot — drops Silica/Quartz from aluminum.",
    applicable: (ctx) =>
      inPlay(ctx, "Desc_AluminaSolution_C") || inPlay(ctx, "Desc_AluminumIngot_C"),
    resolve: (ctx) => ({
      kind: "merge",
      overrides: fixedOverrides(ctx, [
        { productId: "Desc_AluminaSolution_C", recipeId: "Recipe_Alternate_SloppyAlumina_C" },
        { productId: "Desc_AluminumIngot_C", recipeId: "Recipe_PureAluminumIngot_C" },
      ]),
    }),
  },
  {
    id: "polymer-plastics",
    label: "Polymer plastics",
    description:
      "Residual Plastic + Residual Rubber — polymer resin path (usual early swap off crude→plastic).",
    applicable: (ctx) => inPlay(ctx, "Desc_Plastic_C") || inPlay(ctx, "Desc_Rubber_C"),
    resolve: (ctx) => ({
      kind: "merge",
      overrides: fixedOverrides(ctx, [
        { productId: "Desc_Plastic_C", recipeId: "Recipe_ResidualPlastic_C" },
        { productId: "Desc_Rubber_C", recipeId: "Recipe_ResidualRubber_C" },
      ]),
    }),
  },
  {
    id: "recycled-loop",
    label: "Recycled loop",
    description:
      "Recycled Plastic + Recycled Rubber (fuel loop). Expand seeds the cycle via Residual polymer when needed.",
    applicable: (ctx) => inPlay(ctx, "Desc_Plastic_C") || inPlay(ctx, "Desc_Rubber_C"),
    resolve: (ctx) => ({
      kind: "merge",
      overrides: fixedOverrides(ctx, [
        { productId: "Desc_Plastic_C", recipeId: "Recipe_Alternate_Plastic_1_C" },
        { productId: "Desc_Rubber_C", recipeId: "Recipe_Alternate_RecycledRubber_C" },
      ]),
    }),
  },
  {
    id: "oil-recycled-max",
    label: "Oil → recycled",
    description:
      "HOR + Diluted Fuel + Recycled Plastic/Rubber — max oil plastics; polymer seed breaks the recycle cycle.",
    applicable: (ctx) =>
      inPlayCount(ctx, [
        "Desc_HeavyOilResidue_C",
        "Desc_LiquidFuel_C",
        "Desc_Plastic_C",
        "Desc_Rubber_C",
      ]) >= 1,
    resolve: (ctx) => ({
      kind: "merge",
      overrides: fixedOverrides(ctx, [
        { productId: "Desc_HeavyOilResidue_C", recipeId: "Recipe_Alternate_HeavyOilResidue_C" },
        { productId: "Desc_LiquidFuel_C", recipeId: "Recipe_Alternate_DilutedFuel_C" },
        { productId: "Desc_Plastic_C", recipeId: "Recipe_Alternate_Plastic_1_C" },
        { productId: "Desc_Rubber_C", recipeId: "Recipe_Alternate_RecycledRubber_C" },
      ]),
    }),
  },
  {
    id: "iron-copper-alloy",
    label: "Iron + Copper Alloy",
    description: "Iron Alloy + Copper Alloy ingots — share ore between the two metals.",
    chip: { kind: "badge", badgeKind: "alloy", text: "Alloy" },
    applicable: (ctx) => inPlay(ctx, "Desc_IronIngot_C") || inPlay(ctx, "Desc_CopperIngot_C"),
    resolve: (ctx) => ({
      kind: "merge",
      overrides: fixedOverrides(ctx, [
        { productId: "Desc_IronIngot_C", recipeId: "Recipe_Alternate_IngotIron_C" },
        { productId: "Desc_CopperIngot_C", recipeId: "Recipe_Alternate_CopperAlloyIngot_C" },
      ]),
    }),
  },
];

/**
 * Presets that currently apply.
 * Order: Defaults → All Pure → No Screws → remaining packs (array order).
 */
export function applicableQuickSelects(ctx: QuickSelectContext): QuickSelect[] {
  return QUICK_SELECTS.filter((q) => q.id === "defaults" || q.applicable(ctx));
}

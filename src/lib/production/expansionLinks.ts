/**
 * Intermediates hover links: predicate/consumer detection + rate attribution.
 *
 * Expand-aware:
 * - On-site producers that list H as an ingredient actually pull H (green consumers + ↑rate).
 * - Off-site rows do not run their recipe — they do not pull ingredients on-site.
 * - Hovering an off-site import never lights its recipe ingredients (no predicates).
 * - Off-site rows that list H as an ingredient light red with 0/total when H is hovered
 *   (site H does not feed that import’s factory — e.g. Copper → disabled Heat Sink).
 *   Red 0, not emerald: makes clear nothing is feeding into the disabled step.
 * - Off-site / disabled consumers always compare against the **default** recipe so a
 *   hidden Caterium Computer alt does not light Rubber while Computer is imported.
 */
import type { Recipe } from "@/types";

const EPS = 1e-9;

export type ExpansionLinkKind = "none" | "self" | "predicate" | "consumer" | "ghost-consumer";

export type ExpansionLinkInfo = {
  kind: ExpansionLinkKind;
  /**
   * For predicate: how much of this row’s rate is used by the hovered product.
   * For consumer / ghost-consumer: how much of the hovered item flows into this row
   * (0 for ghost).
   */
  attributed: number | null;
};

export type LinkRow = {
  itemId: string;
  itemsPerMinute: number;
  /** True when this row is an off-site import (recipe not expanded on-site). */
  external: boolean;
};

/** Rate of `ingredientId` consumed per minute to produce `productRate` of `productId`. */
export function ingredientInflowPerMin(
  productRate: number,
  recipe: Recipe | undefined,
  productId: string,
  ingredientId: string,
  outputMultiplier = 1,
): number {
  if (!recipe || productRate <= EPS) return 0;
  const productLine = recipe.products.find((p) => p.item === productId);
  if (!productLine || productLine.amount <= 0) return 0;
  const ing = recipe.ingredients.find((i) => i.item === ingredientId);
  if (!ing || ing.amount <= 0) return 0;
  const mult = outputMultiplier > 0 ? outputMultiplier : 1;
  return (productRate / (productLine.amount * mult)) * ing.amount;
}

/**
 * Classify `row` relative to the hovered item, with rate attribution.
 *
 * @param rowRecipe — active (override) recipe for on-site production
 * @param rowDefaultRecipe — catalog default; used for off-site ghost links
 */
export function classifyExpansionLink(opts: {
  row: LinkRow;
  hoveredItemId: string;
  hoveredRate: number;
  hoveredOnSite: boolean;
  hoveredRecipe: Recipe | undefined;
  rowRecipe: Recipe | undefined;
  /** Default production recipe for the row (required for correct off-site ghosts). */
  rowDefaultRecipe?: Recipe | undefined;
  /** Somersloop output multiplier on the hovered step (1 or 2). */
  hoveredOutputMultiplier?: number;
  /** Somersloop output multiplier on this row (1 or 2). */
  rowOutputMultiplier?: number;
}): ExpansionLinkInfo {
  const {
    row,
    hoveredItemId,
    hoveredRate,
    hoveredOnSite,
    hoveredRecipe,
    rowRecipe,
    rowDefaultRecipe,
    hoveredOutputMultiplier = 1,
    rowOutputMultiplier = 1,
  } = opts;

  if (row.itemId === hoveredItemId) {
    return { kind: "self", attributed: row.itemsPerMinute };
  }

  // On-site: selected alt. Off-site: always default (alt is hidden / not expanded here).
  const consumerRecipe = row.external ? (rowDefaultRecipe ?? rowRecipe) : rowRecipe;
  const usesHover = consumerRecipe?.ingredients.some((ing) => ing.item === hoveredItemId) ?? false;

  if (usesHover) {
    if (!row.external) {
      // Consumer inflow uses **this row's** sloop (not the hovered item's).
      // Slooping the producer does not change how much output consumers take.
      const inflow = ingredientInflowPerMin(
        row.itemsPerMinute,
        rowRecipe,
        row.itemId,
        hoveredItemId,
        rowOutputMultiplier,
      );
      if (inflow > EPS) {
        return { kind: "consumer", attributed: inflow };
      }
      return { kind: "none", attributed: null };
    }
    // Off-site: recipe not run here. Red 0 = site H does not feed that import’s factory.
    return { kind: "ghost-consumer", attributed: 0 };
  }

  // Predicates: direct ingredients of the hovered item — only when hover is on-site
  // (off-site imports do not expand their ingredient tree here).
  // Hovered-step sloop halves these inflows (same as expand).
  if (hoveredOnSite && hoveredRecipe?.ingredients.some((ing) => ing.item === row.itemId)) {
    const portion = ingredientInflowPerMin(
      hoveredRate,
      hoveredRecipe,
      hoveredItemId,
      row.itemId,
      hoveredOutputMultiplier,
    );
    return { kind: "predicate", attributed: portion };
  }

  return { kind: "none", attributed: null };
}

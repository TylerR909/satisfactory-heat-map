import {
  annotateSiteCapacity,
  normalizeScoresForDisplay,
  prepareNodes,
  relocateSiteToAssignment,
  scoreSite,
} from "@/lib/heatmap/score";
import type { HeatmapGrid, HeatmapResult, ScoreGridInput, SiteScore } from "@/types";

function emptyGrid(bounds: ScoreGridInput["bounds"], cols: number, rows: number): HeatmapGrid {
  const cellW = (bounds.maxX - bounds.minX) / cols;
  const cellH = (bounds.maxY - bounds.minY) / rows;
  return {
    originX: bounds.minX,
    originY: bounds.minY,
    cellW,
    cellH,
    cols,
    rows,
    scores: new Array(cols * rows).fill(0),
    satisfiable: new Array(cols * rows).fill(false),
  };
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function tryPickDiverse(candidates: SiteScore[], topN: number, minSep: number): SiteScore[] {
  const minSep2 = minSep * minSep;
  const sorted = [...candidates].sort((a, b) => {
    if (a.satisfiable !== b.satisfiable) return a.satisfiable ? -1 : 1;
    return b.score - a.score;
  });
  const picked: SiteScore[] = [];
  for (const s of sorted) {
    if (picked.length >= topN) break;
    if (picked.every((p) => dist2(p.x, p.y, s.x, s.y) >= minSep2)) {
      picked.push(s);
    }
  }
  return picked;
}

/**
 * Pick up to topN sites with at least `minSep` pairwise distance.
 *
 * **Strict separation** — never collapses spacing just to fill topN.
 * Wider Site spread → fewer, farther pins (may return less than topN).
 */
export function pickDiverseSites(
  candidates: SiteScore[],
  topN: number,
  minSep: number,
): SiteScore[] {
  if (candidates.length === 0 || topN <= 0) return [];
  return tryPickDiverse(candidates, topN, Math.max(0, minSep));
}

/**
 * Hierarchical capacity heatmap + diverse top-N sites.
 * Always scores the user's exact demand. Top sites get inferred capacity tags
 * (Limited / OK / Abundant / shortfall) from local extract rates.
 */
export function computeHierarchicalHeatmap(input: ScoreGridInput): HeatmapResult {
  const t0 = performance.now();
  const { options } = input;
  const demand = input.demand;

  const demandRes = new Set(demand.map((d) => d.resource));
  const nodesByResource = prepareNodes(input.nodes, input.miner, demandRes, input.openWater);

  const grid = emptyGrid(input.bounds, input.coarseCols, input.coarseRows);
  const mapSpan = Math.hypot(
    input.bounds.maxX - input.bounds.minX,
    input.bounds.maxY - input.bounds.minY,
  );
  // Site spread: fraction of map diagonal (UI ~4%–40%). Wider = fewer, farther pins.
  const sepFrac = Math.min(0.42, Math.max(0.04, options.siteSepFraction));
  const cellDiag = Math.hypot(grid.cellW, grid.cellH);
  // Primary spacing for final pins — driven by the Site spread knob
  const minSiteSep = Math.max(mapSpan * sepFrac, cellDiag * 1.5);
  // Need enough seeds to cover the map at this spread (not just topN×4 in one region)
  const seedCount = Math.max(
    options.topN * 6,
    input.refineTopK,
    Math.min(48, Math.ceil(mapSpan / Math.max(minSiteSep * 0.85, cellDiag)) + 4),
  );
  // Coarse seeds nearly match pin separation so the refine pool is already diverse
  const minCoarseSep = Math.max(minSiteSep * 0.85, cellDiag * 1.25);

  const scoreAt = (x: number, y: number) =>
    scoreSite(
      x,
      y,
      demand,
      nodesByResource,
      input.caveDeltaZCm,
      input.scoringMode,
      options.centerPower,
      options.includeElevation,
    );

  const coarseSites: { site: SiteScore; col: number; row: number }[] = [];

  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const cx = grid.originX + (col + 0.5) * grid.cellW;
      const cy = grid.originY + (row + 0.5) * grid.cellH;
      const site = scoreAt(cx, cy);
      const idx = row * grid.cols + col;
      grid.scores[idx] = site.score;
      grid.satisfiable[idx] = site.satisfiable;
      coarseSites.push({ site, col, row });
    }
  }

  coarseSites.sort((a, b) => {
    if (a.site.satisfiable !== b.site.satisfiable) return a.site.satisfiable ? -1 : 1;
    return b.site.score - a.site.score;
  });

  const seeds: typeof coarseSites = [];
  for (const c of coarseSites) {
    if (seeds.length >= seedCount) break;
    const far = seeds.every(
      (s) => dist2(s.site.x, s.site.y, c.site.x, c.site.y) >= minCoarseSep * minCoarseSep,
    );
    if (far) seeds.push(c);
  }

  const regionalBest: SiteScore[] = [];

  for (const { site, col, row } of seeds) {
    const x0 = grid.originX + col * grid.cellW;
    const y0 = grid.originY + row * grid.cellH;
    const subW = grid.cellW / input.refineSubdiv;
    const subH = grid.cellH / input.refineSubdiv;

    let best = site;
    for (let sr = 0; sr < input.refineSubdiv; sr++) {
      for (let sc = 0; sc < input.refineSubdiv; sc++) {
        const cx = x0 + (sc + 0.5) * subW;
        const cy = y0 + (sr + 0.5) * subH;
        const refined = scoreAt(cx, cy);
        if (
          refined.satisfiable !== best.satisfiable
            ? refined.satisfiable
            : refined.score > best.score
        ) {
          best = refined;
        }
      }
    }
    regionalBest.push(best);
  }

  // Grid samples score heat correctly but pins sit on cell centers. Relocate each
  // candidate onto the multi-resource midpoint of its assignment before diversity
  // so we don't list "sites" floating in open water that only haul from a far pocket.
  const relocate = (s: SiteScore) =>
    relocateSiteToAssignment(
      s,
      demand,
      nodesByResource,
      input.caveDeltaZCm,
      input.scoringMode,
      options.centerPower,
      options.includeElevation,
    );

  const pool = [
    ...regionalBest.map(relocate),
    ...coarseSites.slice(0, seedCount).map((c) => relocate(c.site)),
  ];
  const picked = pickDiverseSites(pool, options.topN, minSiteSep);
  const topSites = picked.map((s) => annotateSiteCapacity(s, nodesByResource, input.miner));

  grid.scores = normalizeScoresForDisplay(grid.scores, options.heatContrast);

  return {
    grid,
    topSites,
    elapsedMs: performance.now() - t0,
    scoredDemand: demand,
  };
}

import { distXY } from "@/lib/coords";
import { nodeExtractRate } from "@/lib/mining";
import type {
  CapacityTag,
  MinerSettings,
  RawDemand,
  ResourceAssignment,
  ResourceCapacityInfo,
  ResourceNode,
  ScoringMode,
  SiteScore,
} from "@/types";

export type ScoredNode = ResourceNode & { rate: number };

/** Characteristic length (cm) for rate-invariant quality → heat. ~1 km. */
export const HAUL_REF_CM = 100_000;

/**
 * Nodes within this radius of a candidate site count as "local" supply for
 * Limited / Abundant tags (~1.5 km).
 */
export const LOCAL_CAPACITY_RADIUS_CM = 150_000;

/** Bottleneck utilization at or above this → Limited (thin fit). */
export const UTIL_LIMITED = 0.75;

/** Bottleneck utilization at or below this → candidate for Abundant. */
export const UTIL_ABUNDANT = 0.3;

/**
 * Continuous rate of one pure permanent node for this resource under miner/clock.
 */
export function pureNodeExtractRate(resource: string, miner: MinerSettings): number {
  const probe: ResourceNode = {
    id: `pure-probe-${resource}`,
    resource,
    purity: "pure",
    nodeType: "node",
    x: 0,
    y: 0,
    z: 0,
  };
  return nodeExtractRate(probe, miner);
}

export function prepareNodes(
  nodes: ResourceNode[],
  miner: MinerSettings,
  demandResources: Set<string>,
): Map<string, ScoredNode[]> {
  const byRes = new Map<string, ScoredNode[]>();
  for (const n of nodes) {
    if (!demandResources.has(n.resource)) continue;
    const rate = nodeExtractRate(n, miner);
    if (rate <= 0) continue;
    const list = byRes.get(n.resource) ?? [];
    list.push({ ...n, rate });
    byRes.set(n.resource, list);
  }
  return byRes;
}

/**
 * Sum extract rates of scored nodes for `resource` within radius of (x, y).
 */
export function localCapacityForResource(
  x: number,
  y: number,
  resource: string,
  nodesByResource: Map<string, ScoredNode[]>,
  radiusCm: number = LOCAL_CAPACITY_RADIUS_CM,
): number {
  const pool = nodesByResource.get(resource) ?? [];
  const r2 = radiusCm * radiusCm;
  let sum = 0;
  for (const n of pool) {
    const dx = n.x - x;
    const dy = n.y - y;
    if (dx * dx + dy * dy <= r2) sum += n.rate;
  }
  return sum;
}

/**
 * Build per-resource local capacity rows for a scored site (exact demand).
 */
export function buildCapacityByResource(
  site: Pick<SiteScore, "x" | "y" | "byResource">,
  nodesByResource: Map<string, ScoredNode[]>,
  radiusCm: number = LOCAL_CAPACITY_RADIUS_CM,
): ResourceCapacityInfo[] {
  return site.byResource.map((ra) => {
    const localCapacity = localCapacityForResource(
      site.x,
      site.y,
      ra.resource,
      nodesByResource,
      radiusCm,
    );
    const demanded = ra.demanded;
    const spare = Math.max(0, localCapacity - demanded);
    const utilization =
      localCapacity > 1e-9
        ? demanded / localCapacity
        : demanded > 1e-9
          ? Number.POSITIVE_INFINITY
          : 0;
    return {
      resource: ra.resource,
      demanded,
      localCapacity,
      utilization,
      spare,
    };
  });
}

/**
 * Infer capacity tag from exact-demand fit + local utilization.
 * Pure/impure only matter via extract rates already in localCapacity.
 */
export function inferCapacityTag(
  site: Pick<SiteScore, "satisfiable">,
  capacityByResource: ResourceCapacityInfo[],
  miner: MinerSettings,
): { tag: CapacityTag; maxUtilization: number } {
  if (!site.satisfiable) {
    const maxU = capacityByResource.reduce(
      (m, c) => Math.max(m, Number.isFinite(c.utilization) ? c.utilization : 1e9),
      0,
    );
    return { tag: "shortfall", maxUtilization: maxU };
  }

  let maxUtilization = 0;
  for (const c of capacityByResource) {
    const u = Number.isFinite(c.utilization) ? c.utilization : Number.POSITIVE_INFINITY;
    if (u > maxUtilization) maxUtilization = u;
  }

  if (maxUtilization >= UTIL_LIMITED || !Number.isFinite(maxUtilization)) {
    return { tag: "limited", maxUtilization };
  }

  if (maxUtilization <= UTIL_ABUNDANT) {
    // Require meaningful absolute spare on the bottleneck resource so mega
    // plans (e.g. 3200 oil) never look "Abundant" when local barely covers D.
    let abundantOk = capacityByResource.length > 0;
    for (const c of capacityByResource) {
      const pure = pureNodeExtractRate(c.resource, miner);
      const minSpare = Math.max(0.5 * pure, 0.5 * c.demanded);
      if (c.spare + 1e-6 < minSpare) {
        abundantOk = false;
        break;
      }
    }
    if (abundantOk) return { tag: "abundant", maxUtilization };
  }

  return { tag: "ok", maxUtilization };
}

/**
 * Attach capacityTag / capacityByResource to a site scored at exact demand.
 */
export function annotateSiteCapacity(
  site: SiteScore,
  nodesByResource: Map<string, ScoredNode[]>,
  miner: MinerSettings,
  radiusCm: number = LOCAL_CAPACITY_RADIUS_CM,
): SiteScore {
  const capacityByResource = buildCapacityByResource(site, nodesByResource, radiusCm);
  const { tag, maxUtilization } = inferCapacityTag(site, capacityByResource, miner);
  return {
    ...site,
    capacityTag: tag,
    maxUtilization,
    capacityByResource,
    limited: tag === "limited",
  };
}

function meanDistForResource(ra: ResourceAssignment): number {
  const denom = ra.demanded > 1e-9 ? Math.min(ra.demanded, ra.supplied) : 1;
  if (denom <= 1e-9) return 0;
  let resourceHaul = 0;
  for (const n of ra.nodes) {
    resourceHaul += n.rateUsed * n.dist;
  }
  const useDenom = ra.supplied > 1e-9 ? ra.supplied : denom;
  return resourceHaul / useDenom;
}

/**
 * Effective haul distance in cm (lower is better). **Scale-invariant** in
 * throughput: doubling every demand rate does not change the score when the
 * same nearest nodes still cover the plan.
 *
 * weighted: throughput-weighted mean distance.
 * centered: L_p mean of per-resource mean distances (p = centerPower).
 */
export function combineHaulCost(
  mode: ScoringMode,
  byResource: ResourceAssignment[],
  centerPower = 1.35,
): number {
  if (byResource.length === 0) return 0;

  if (mode === "weighted") {
    let num = 0;
    let den = 0;
    for (const ra of byResource) {
      for (const n of ra.nodes) {
        num += n.rateUsed * n.dist;
        den += n.rateUsed;
      }
    }
    return den > 1e-9 ? num / den : 0;
  }

  const p = Math.min(2.5, Math.max(1, centerPower));
  const means: number[] = [];
  for (const ra of byResource) {
    if (ra.supplied <= 1e-9 && ra.demanded <= 1e-9) continue;
    means.push(meanDistForResource(ra));
  }
  if (means.length === 0) return 0;
  const acc = means.reduce((s, m) => s + m ** p, 0) / means.length;
  return acc ** (1 / p);
}

/** Map effective distance → (0,1] quality. Independent of items/min scale. */
export function haulDistanceToScore(effectiveDistCm: number, cavePenalty = 1): number {
  const d = Math.max(0, effectiveDistCm);
  const quality = 1 / (1 + d / HAUL_REF_CM);
  return quality / Math.max(1, cavePenalty);
}

/**
 * Capacity-aware greedy assignment at factory point (x, y).
 */
export function scoreSite(
  x: number,
  y: number,
  demand: RawDemand[],
  nodesByResource: Map<string, ScoredNode[]>,
  caveDeltaZCm: number,
  scoringMode: ScoringMode = "centered",
  centerPower = 1.35,
): SiteScore {
  const byResource: ResourceAssignment[] = [];
  const caveRiskNotes: string[] = [];
  let satisfiable = true;

  for (const d of demand) {
    if (d.itemsPerMinute <= 0) continue;
    const pool = [...(nodesByResource.get(d.resource) ?? [])];
    pool.sort((a, b) => distXY(x, y, a.x, a.y) - distXY(x, y, b.x, b.y));

    let remaining = d.itemsPerMinute;
    const assigned: ResourceAssignment["nodes"] = [];

    for (const n of pool) {
      if (remaining <= 1e-6) break;
      const use = Math.min(n.rate, remaining);
      const dist = distXY(x, y, n.x, n.y);
      const caveRisk = Boolean(n.flags?.cave) || Math.abs(n.z) > caveDeltaZCm;
      const elevRisk = Math.abs(n.z) > 15000;
      const risk = caveRisk || elevRisk;

      assigned.push({
        nodeId: n.id,
        rateUsed: use,
        dist,
        x: n.x,
        y: n.y,
        z: n.z,
        purity: n.purity,
        caveRisk: risk,
      });
      if (risk) {
        caveRiskNotes.push(
          `${d.resource}: node ${n.id.slice(0, 24)}… elev/cave risk (z=${Math.round(n.z)})`,
        );
      }
      remaining -= use;
    }

    const supplied = d.itemsPerMinute - Math.max(0, remaining);
    const shortfall = Math.max(0, remaining);
    if (shortfall > 1e-3) {
      satisfiable = false;
    }
    byResource.push({
      resource: d.resource,
      nodes: assigned,
      supplied,
      demanded: d.itemsPerMinute,
      shortfall,
    });
  }

  const totalHaul = combineHaulCost(scoringMode, byResource, centerPower);
  const cavePenalty = 1 + caveRiskNotes.length * 0.05;
  const quality = haulDistanceToScore(totalHaul, cavePenalty);

  let score: number;
  if (!satisfiable) {
    const met = byResource.reduce((s, r) => s + r.supplied, 0);
    const need = byResource.reduce((s, r) => s + r.demanded, 0) || 1;
    score = 0.35 * (met / need) * quality;
  } else {
    score = quality;
  }

  return {
    x,
    y,
    score,
    satisfiable,
    totalHaul,
    byResource,
    caveRiskNotes: [...new Set(caveRiskNotes)].slice(0, 6),
  };
}

/**
 * Ideal factory pin for a fixed assignment.
 *
 * - **centered**: mean of per-resource rate-weighted centroids (equal resources)
 * - **weighted**: single rate-weighted centroid of all assigned nodes
 *
 * Returns null when nothing was assigned.
 */
export function assignmentCentroid(
  byResource: ResourceAssignment[],
  scoringMode: ScoringMode = "centered",
): { x: number; y: number } | null {
  if (scoringMode === "weighted") {
    let sx = 0;
    let sy = 0;
    let w = 0;
    for (const ra of byResource) {
      for (const n of ra.nodes) {
        sx += n.x * n.rateUsed;
        sy += n.y * n.rateUsed;
        w += n.rateUsed;
      }
    }
    if (w <= 1e-9) return null;
    return { x: sx / w, y: sy / w };
  }

  let sx = 0;
  let sy = 0;
  let nRes = 0;
  for (const ra of byResource) {
    let rx = 0;
    let ry = 0;
    let w = 0;
    for (const n of ra.nodes) {
      rx += n.x * n.rateUsed;
      ry += n.y * n.rateUsed;
      w += n.rateUsed;
    }
    if (w <= 1e-9) continue;
    sx += rx / w;
    sy += ry / w;
    nRes++;
  }
  if (nRes === 0) return null;
  return { x: sx / nRes, y: sy / nRes };
}

function siteBetter(a: SiteScore, b: SiteScore): boolean {
  if (a.satisfiable !== b.satisfiable) return a.satisfiable;
  return a.score > b.score;
}

/**
 * Move a grid-sampled site onto the multi-resource midpoint of its assignment.
 *
 * Hierarchical search scores cell centers (good for heat). Those samples often
 * sit off to one side of the nodes they haul from — or even off the coast —
 * especially after diversity pushes lower ranks into empty cells that still
 * "see" a distant pocket. Alternating assignment → centroid → re-score pulls
 * the pin onto the true local hub so top-N is not a star of spokes into the sea.
 */
export function relocateSiteToAssignment(
  site: SiteScore,
  demand: RawDemand[],
  nodesByResource: Map<string, ScoredNode[]>,
  caveDeltaZCm: number,
  scoringMode: ScoringMode = "centered",
  centerPower = 1.35,
  maxIters = 6,
): SiteScore {
  let best = site;
  let cur = site;
  const epsCm = 50; // ~0.5 m — sub-cell noise

  for (let i = 0; i < maxIters; i++) {
    const target = assignmentCentroid(cur.byResource, scoringMode);
    if (!target) break;
    const step = distXY(cur.x, cur.y, target.x, target.y);
    if (step < epsCm) break;

    const next = scoreSite(
      target.x,
      target.y,
      demand,
      nodesByResource,
      caveDeltaZCm,
      scoringMode,
      centerPower,
    );

    if (siteBetter(next, best)) best = next;

    // Accept the move when score does not collapse (assignment can flicker on ties).
    if (siteBetter(next, cur) || next.score >= cur.score * 0.995) {
      cur = next;
      continue;
    }

    // Half-step fallback — pure centroid can overshoot when assignment flips.
    const mid = scoreSite(
      (cur.x + target.x) / 2,
      (cur.y + target.y) / 2,
      demand,
      nodesByResource,
      caveDeltaZCm,
      scoringMode,
      centerPower,
    );
    if (siteBetter(mid, best)) best = mid;
    if (siteBetter(mid, cur) || mid.score >= cur.score * 0.995) {
      cur = mid;
      continue;
    }
    break;
  }

  return siteBetter(best, site) || best.score >= site.score * 0.999 ? best : site;
}

/**
 * Normalize raw scores for heat paint (display only — rankings unchanged).
 *
 * Peak-relative with a **strong floor** and power ≥ 1 so mid-map dies and only
 * true hubs remain. `heatContrast` (Peak emphasis) is the sparseness control:
 * low → more secondary hubs visible; high → narrow peaks only.
 * Color/opacity shaping is separate (rasterize + Heat settings).
 */
export function normalizeScoresForDisplay(scores: number[], heatContrast: number): number[] {
  const positive = scores.filter((s) => s > 0);
  if (positive.length === 0) return scores.map(() => 0);

  let peak = 0;
  for (const s of positive) if (s > peak) peak = s;
  if (peak <= 1e-12) return scores.map(() => 0);

  // Soften a single-cell spike slightly via p98, but never treat the top 10%
  // of the map as "full heat" (old p90 ref washed abundant-resource plans).
  const sorted = [...positive].sort((a, b) => a - b);
  const p98Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98));
  const p98 = sorted[p98Idx] ?? peak;
  const ref = Math.max(peak * 0.94, p98, 1e-12);

  const emphasis = Math.min(3.2, Math.max(1.1, heatContrast));
  const t = (emphasis - 1.1) / (3.2 - 1.1); // 0 = more hubs, 1 = peaks only

  // Relative-to-peak cutoff. High emphasis punches holes between hubs.
  // Floor starts high enough that abundant-resource mid-map dies by default.
  const floor = 0.5 + t * 0.3; // ~0.50 … ~0.80
  // Compress mid scores (never mid-lift). High emphasis → sharper cores.
  const power = 1.25 + t * 1.35; // ~1.25 … ~2.60

  return scores.map((s) => {
    if (s <= 0) return 0;
    const r = s / ref;
    if (r <= floor) return 0;
    const u = Math.min(1, (r - floor) / (1 - floor));
    return u ** power;
  });
}

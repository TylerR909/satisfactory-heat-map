import { haulDist, median, WORLD_X_MAX, WORLD_X_MIN, WORLD_Y_MAX, WORLD_Y_MIN } from "@/lib/coords";
import { nodeExtractRate, WATER_EXTRACTOR_BASE } from "@/lib/mining";
import { WATER_RESOURCE_ID } from "@/lib/resources";
import type {
  CapacityTag,
  MinerSettings,
  NodeAssignment,
  OpenWaterData,
  RawDemand,
  ResourceAssignment,
  ResourceCapacityInfo,
  ResourceNode,
  ScoringMode,
  SiteScore,
} from "@/types";

export type ScoredNode = ResourceNode & {
  rate: number;
  /**
   * Optional multi-point surface (open-water bodies). Distance to the node is
   * min distance to any sample; assignment uses the nearest sample as (x,y).
   */
  samples?: [number, number][];
};

/** Characteristic length (cm) for rate-invariant quality → heat. ~1 km. */
export const HAUL_REF_CM = 100_000;

/** World diagonal — upper bound for plan-view haul (cm). */
const MAP_DIAG_CM = Math.hypot(WORLD_X_MAX - WORLD_X_MIN, WORLD_Y_MAX - WORLD_Y_MIN);

/**
 * Distance buckets for large supply pools (open water). All of bucket i is
 * closer than bucket i+1, so we only sort within each small bucket — O(N)
 * overall instead of O(N log N) full sorts on every grid cell.
 */
const ASSIGN_DIST_BUCKETS = 96;

/** Below this pool size, a plain sort is cheaper than bucketing. */
const ASSIGN_SORT_DIRECT_MAX = 48;

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
 * Water uses a single open Water Extractor (120 @ 100%), not a pure well satellite.
 */
export function pureNodeExtractRate(resource: string, miner: MinerSettings): number {
  if (resource === WATER_RESOURCE_ID) {
    const clock = miner.waterClockPercent ?? miner.clockPercent;
    return WATER_EXTRACTOR_BASE * (clock / 100);
  }
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

/**
 * Nearest surface point on a scored supply unit (open-water samples or node xy).
 */
export function nearestPointOnNode(
  x: number,
  y: number,
  n: ScoredNode,
): { x: number; y: number; d2: number } {
  if (n.samples && n.samples.length > 0) {
    let bestX = n.samples[0][0];
    let bestY = n.samples[0][1];
    let bestD2 = Number.POSITIVE_INFINITY;
    for (let i = 0; i < n.samples.length; i++) {
      const sx = n.samples[i][0];
      const sy = n.samples[i][1];
      const dx = sx - x;
      const dy = sy - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestX = sx;
        bestY = sy;
      }
    }
    return { x: bestX, y: bestY, d2: bestD2 };
  }
  const dx = n.x - x;
  const dy = n.y - y;
  return { x: n.x, y: n.y, d2: dx * dx + dy * dy };
}

/**
 * Turn open-water bodies into synthetic scored supply units for Desc_Water_C.
 * One unit per body (finite slots); samples stay on the node for near-shore distance.
 * Pond of 4 slots → 480/min @ 100%.
 */
export function openWaterToScoredNodes(
  openWater: OpenWaterData | null | undefined,
  miner: MinerSettings,
): ScoredNode[] {
  if (!openWater?.bodies?.length) return [];
  const base =
    openWater.extractorRateAt100 > 0 ? openWater.extractorRateAt100 : WATER_EXTRACTOR_BASE;
  const clock = (miner.waterClockPercent ?? miner.clockPercent) / 100;
  const out: ScoredNode[] = [];

  for (const body of openWater.bodies) {
    if (body.slots <= 0) continue;
    const totalRate = body.slots * base * clock;
    if (totalRate <= 1e-9) continue;

    const samples =
      body.samples && body.samples.length > 0
        ? body.samples
        : ([[body.x, body.y]] as [number, number][]);

    out.push({
      id: body.id,
      resource: WATER_RESOURCE_ID,
      purity: "normal",
      nodeType: "node",
      displayName: "Open water",
      x: body.x,
      y: body.y,
      z: 0,
      rate: totalRate,
      // Keep multi-sample only when it changes distance (large coasts/lakes)
      ...(samples.length > 1 ? { samples } : {}),
    });
  }
  return out;
}

type RankedSupply = {
  node: ScoredNode;
  d2: number;
  px: number;
  py: number;
};

function pushAssignment(
  assigned: NodeAssignment[],
  assignedZ: number[],
  item: RankedSupply,
  use: number,
): void {
  const n = item.node;
  assigned.push({
    nodeId: n.id,
    rateUsed: use,
    dist: Math.sqrt(item.d2),
    x: item.px,
    y: item.py,
    z: n.z,
    purity: n.purity,
    caveRisk: Boolean(n.flags?.cave),
  });
  assignedZ.push(n.z);
}

/**
 * Greedy nearest-capacity assignment.
 *
 * Small pools: full sort. Large pools (open water): distance-bucket in O(N),
 * sort only near buckets, stop once demand is met — avoids O(N log N) per cell.
 */
export function assignNearestCapacity(
  x: number,
  y: number,
  pool: ScoredNode[],
  demandRate: number,
): { assigned: NodeAssignment[]; remaining: number; assignedZ: number[] } {
  const assigned: NodeAssignment[] = [];
  const assignedZ: number[] = [];
  let remaining = demandRate;
  if (pool.length === 0 || remaining <= 1e-6) {
    return { assigned, remaining: Math.max(0, remaining), assignedZ };
  }

  if (pool.length <= ASSIGN_SORT_DIRECT_MAX) {
    const ranked: RankedSupply[] = new Array(pool.length);
    for (let i = 0; i < pool.length; i++) {
      const node = pool[i];
      const p = nearestPointOnNode(x, y, node);
      ranked[i] = { node, d2: p.d2, px: p.x, py: p.y };
    }
    if (ranked.length > 1) ranked.sort((a, b) => a.d2 - b.d2);
    for (let i = 0; i < ranked.length && remaining > 1e-6; i++) {
      const use = Math.min(ranked[i].node.rate, remaining);
      pushAssignment(assigned, assignedZ, ranked[i], use);
      remaining -= use;
    }
    return { assigned, remaining: Math.max(0, remaining), assignedZ };
  }

  const buckets: RankedSupply[][] = new Array(ASSIGN_DIST_BUCKETS);
  for (let i = 0; i < ASSIGN_DIST_BUCKETS; i++) buckets[i] = [];
  // Bucket by d² so we skip sqrt; order is still nearest-first across buckets.
  const maxD2 = MAP_DIAG_CM * MAP_DIAG_CM;
  const inv = ASSIGN_DIST_BUCKETS / maxD2;

  for (let i = 0; i < pool.length; i++) {
    const node = pool[i];
    const p = nearestPointOnNode(x, y, node);
    let b = (p.d2 * inv) | 0;
    if (b >= ASSIGN_DIST_BUCKETS) b = ASSIGN_DIST_BUCKETS - 1;
    if (b < 0) b = 0;
    buckets[b].push({ node, d2: p.d2, px: p.x, py: p.y });
  }

  for (let b = 0; b < ASSIGN_DIST_BUCKETS && remaining > 1e-6; b++) {
    const bucket = buckets[b];
    if (bucket.length === 0) continue;
    if (bucket.length > 1) bucket.sort((a, c) => a.d2 - c.d2);
    for (let i = 0; i < bucket.length && remaining > 1e-6; i++) {
      const use = Math.min(bucket[i].node.rate, remaining);
      pushAssignment(assigned, assignedZ, bucket[i], use);
      remaining -= use;
    }
  }

  return { assigned, remaining: Math.max(0, remaining), assignedZ };
}

export function prepareNodes(
  nodes: ResourceNode[],
  miner: MinerSettings,
  demandResources: Set<string>,
  openWater?: OpenWaterData | null,
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

  if (demandResources.has(WATER_RESOURCE_ID)) {
    const open = openWaterToScoredNodes(openWater, miner);
    if (open.length > 0) {
      const list = byRes.get(WATER_RESOURCE_ID) ?? [];
      list.push(...open);
      byRes.set(WATER_RESOURCE_ID, list);
    }
  }

  return byRes;
}

/**
 * Sum extract rates of scored nodes for `resource` within radius of (x, y).
 * Open-water multi-sample bodies count if any sample (nearest surface) is in range.
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
    const { d2 } = nearestPointOnNode(x, y, n);
    if (d2 <= r2) sum += n.rate;
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
export function haulDistanceToScore(effectiveDistCm: number): number {
  const d = Math.max(0, effectiveDistCm);
  return 1 / (1 + d / HAUL_REF_CM);
}

/**
 * Greedy nearest-capacity assignment at factory (x, y).
 *
 * Ranks supply by **plan-view (XY)** distance. Large pools (open water) use
 * distance bucketing so each cell is ~O(N) rather than O(N log N) full sorts.
 * When `includeElevation`, factory Z is the median of assigned elevations and
 * each haul `dist` is rewritten as 3D from that hub height.
 *
 * `caveDeltaZCm` is retained for API compatibility; it no longer affects score.
 */
export function scoreSite(
  x: number,
  y: number,
  demand: RawDemand[],
  nodesByResource: Map<string, ScoredNode[]>,
  _caveDeltaZCm: number,
  scoringMode: ScoringMode = "centered",
  centerPower = 1.35,
  includeElevation = true,
): SiteScore {
  const byResource: ResourceAssignment[] = [];
  const caveRiskNotes: string[] = [];
  let satisfiable = true;
  const assignedZ: number[] = [];

  for (const d of demand) {
    if (d.itemsPerMinute <= 0) continue;
    const pool = nodesByResource.get(d.resource) ?? [];
    const {
      assigned,
      remaining,
      assignedZ: zFromRes,
    } = assignNearestCapacity(x, y, pool, d.itemsPerMinute);
    for (const z of zFromRes) assignedZ.push(z);
    for (const n of assigned) {
      if (n.caveRisk) {
        caveRiskNotes.push(
          `${d.resource}: node ${n.nodeId.slice(0, 24)}… cave (z=${Math.round(n.z)})`,
        );
      }
    }

    const supplied = d.itemsPerMinute - remaining;
    const shortfall = remaining;
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

  const zSite = median(assignedZ);

  // Apply 3D haul from hub median Z — O(assigned), not O(all nodes × sort)
  if (includeElevation && assignedZ.length > 0) {
    for (const ra of byResource) {
      for (const n of ra.nodes) {
        const dx = n.x - x;
        const dy = n.y - y;
        const dz = n.z - zSite;
        n.dist = Math.hypot(dx, dy, dz);
      }
    }
  }

  const totalHaul = combineHaulCost(scoringMode, byResource, centerPower);
  const quality = haulDistanceToScore(totalHaul);

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
    z: zSite,
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
  includeElevation = true,
  maxIters = 6,
): SiteScore {
  let best = site;
  let cur = site;
  const epsCm = 50; // ~0.5 m — sub-cell noise

  for (let i = 0; i < maxIters; i++) {
    const target = assignmentCentroid(cur.byResource, scoringMode);
    if (!target) break;
    const step = haulDist(cur.x, cur.y, 0, target.x, target.y, 0, false);
    if (step < epsCm) break;

    const next = scoreSite(
      target.x,
      target.y,
      demand,
      nodesByResource,
      caveDeltaZCm,
      scoringMode,
      centerPower,
      includeElevation,
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
      includeElevation,
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

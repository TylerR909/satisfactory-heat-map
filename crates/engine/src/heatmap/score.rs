//! Capacity assignment + site scoring.
//!
//! Hot path (`score_site_light`): no String assignments, reused scratch, one
//! distance pass + bucket/direct sort. Full `score_site` only for top-N/relocate.

use std::collections::HashMap;

use super::mining::{
    node_extract_rate, pure_node_extract_rate, WATER_EXTRACTOR_BASE_PUB, WATER_RESOURCE_ID,
};
use super::types::*;

pub const HAUL_REF_CM: f64 = 100_000.0;
const MAP_DIAG_CM2: f64 = 1_061_367.0 * 1_061_367.0;
const ASSIGN_DIST_BUCKETS: usize = 96;
const ASSIGN_SORT_DIRECT_MAX: usize = 48;
pub const LOCAL_CAPACITY_RADIUS_CM: f64 = 150_000.0;
const UTIL_LIMITED: f64 = 0.75;
const UTIL_ABUNDANT: f64 = 0.3;

/// Flat supply unit — hot fields first.
#[derive(Clone)]
pub struct ScoredNode {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub rate: f64,
    pub cave: bool,
    pub samples: Option<Vec<[f64; 2]>>,
    pub id: String,
    pub purity: String,
}

#[derive(Clone, Copy)]
struct Ranked {
    idx: usize,
    d2: f64,
    px: f64,
    py: f64,
}

#[derive(Clone, Copy)]
struct LightHit {
    rate_used: f64,
    /// d² until finish_score, then haul cm.
    dist: f64,
    x: f64,
    y: f64,
    z: f64,
    pool_idx: usize,
}

pub struct ScoreScratch {
    ranked: Vec<Ranked>,
    hits: Vec<LightHit>,
    res_spans: Vec<(usize, usize, f64, f64)>,
    assigned_z: Vec<f64>,
    means: Vec<f64>,
    median_buf: Vec<f64>,
    buckets: Vec<Vec<Ranked>>,
    dirty_buckets: Vec<usize>,
}

impl ScoreScratch {
    pub fn new() -> Self {
        Self {
            ranked: Vec::with_capacity(128),
            hits: Vec::with_capacity(64),
            res_spans: Vec::with_capacity(16),
            assigned_z: Vec::with_capacity(64),
            means: Vec::with_capacity(16),
            median_buf: Vec::with_capacity(32),
            buckets: (0..ASSIGN_DIST_BUCKETS)
                .map(|_| Vec::with_capacity(32))
                .collect(),
            dirty_buckets: Vec::with_capacity(32),
        }
    }
}

pub struct DemandPool<'a> {
    pub demanded: f64,
    pub pool: &'a [ScoredNode],
    pub resource: &'a str,
}

#[derive(Clone, Copy)]
pub struct LightSite {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub score: f64,
    pub satisfiable: bool,
    pub total_haul: f64,
}

#[inline(always)]
fn nearest_d2(x: f64, y: f64, n: &ScoredNode) -> (f64, f64, f64) {
    if let Some(samples) = n.samples.as_ref() {
        if samples.is_empty() {
            let dx = n.x - x;
            let dy = n.y - y;
            return (n.x, n.y, dx * dx + dy * dy);
        }
        let mut best_x = samples[0][0];
        let mut best_y = samples[0][1];
        let mut best_d2 = {
            let dx = best_x - x;
            let dy = best_y - y;
            dx * dx + dy * dy
        };
        for s in samples.iter().skip(1) {
            let dx = s[0] - x;
            let dy = s[1] - y;
            let d2 = dx * dx + dy * dy;
            if d2 < best_d2 {
                best_d2 = d2;
                best_x = s[0];
                best_y = s[1];
            }
        }
        return (best_x, best_y, best_d2);
    }
    let dx = n.x - x;
    let dy = n.y - y;
    (n.x, n.y, dx * dx + dy * dy)
}

fn median_inplace(buf: &mut [f64]) -> f64 {
    let n = buf.len();
    if n == 0 {
        return 0.0;
    }
    buf.sort_unstable_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mid = n / 2;
    if n % 2 == 1 {
        buf[mid]
    } else {
        (buf[mid - 1] + buf[mid]) * 0.5
    }
}

fn open_water_to_scored(open_water: Option<&OpenWaterData>, miner: &MinerSettings) -> Vec<ScoredNode> {
    let Some(ow) = open_water else {
        return vec![];
    };
    if ow.bodies.is_empty() {
        return vec![];
    }
    let base = if ow.extractor_rate_at100 > 0.0 {
        ow.extractor_rate_at100
    } else {
        WATER_EXTRACTOR_BASE_PUB
    };
    let clock = miner.water_clock_percent / 100.0;
    let mut out = Vec::with_capacity(ow.bodies.len());
    for body in &ow.bodies {
        if body.slots <= 0.0 {
            continue;
        }
        let total_rate = body.slots * base * clock;
        if total_rate <= 1e-9 {
            continue;
        }
        // Multi-sample bodies keep samples for nearest-surface distance; xy is body center.
        let samples = match &body.samples {
            Some(s) if s.len() > 1 => Some(s.clone()),
            _ => None,
        };
        out.push(ScoredNode {
            x: body.x,
            y: body.y,
            z: 0.0,
            rate: total_rate,
            cave: false,
            samples,
            id: body.id.clone(),
            purity: "normal".into(),
        });
    }
    out
}

pub fn prepare_nodes(
    nodes: &[ResourceNode],
    miner: &MinerSettings,
    demand_resources: &std::collections::HashSet<String>,
    open_water: Option<&OpenWaterData>,
) -> HashMap<String, Vec<ScoredNode>> {
    let mut by_res: HashMap<String, Vec<ScoredNode>> = HashMap::new();
    for n in nodes {
        if !demand_resources.contains(&n.resource) {
            continue;
        }
        let rate = node_extract_rate(n, miner);
        if rate <= 0.0 {
            continue;
        }
        let cave = n.flags.as_ref().and_then(|f| f.cave).unwrap_or(false);
        by_res.entry(n.resource.clone()).or_default().push(ScoredNode {
            x: n.x,
            y: n.y,
            z: n.z,
            rate,
            cave,
            samples: None,
            id: n.id.clone(),
            purity: n.purity.clone(),
        });
    }
    if demand_resources.contains(WATER_RESOURCE_ID) {
        let open = open_water_to_scored(open_water, miner);
        if !open.is_empty() {
            by_res
                .entry(WATER_RESOURCE_ID.into())
                .or_default()
                .extend(open);
        }
    }
    by_res
}

/// Greedy nearest capacity → hits. Stores plan-view **d²** in `dist` until finish_score.
fn assign_nearest(
    scratch: &mut ScoreScratch,
    x: f64,
    y: f64,
    pool: &[ScoredNode],
    demand_rate: f64,
) -> f64 {
    let mut remaining = demand_rate;
    if pool.is_empty() || remaining <= 1e-6 {
        return remaining.max(0.0);
    }

    if pool.len() <= ASSIGN_SORT_DIRECT_MAX {
        scratch.ranked.clear();
        for (idx, node) in pool.iter().enumerate() {
            let (px, py, d2) = nearest_d2(x, y, node);
            scratch.ranked.push(Ranked { idx, d2, px, py });
        }
        scratch
            .ranked
            .sort_unstable_by(|a, b| a.d2.partial_cmp(&b.d2).unwrap_or(std::cmp::Ordering::Equal));
        let ranked = std::mem::take(&mut scratch.ranked);
        for item in &ranked {
            if remaining <= 1e-6 {
                break;
            }
            let n = &pool[item.idx];
            let rate_use = n.rate.min(remaining);
            scratch.hits.push(LightHit {
                rate_used: rate_use,
                dist: item.d2,
                x: item.px,
                y: item.py,
                z: n.z,
                pool_idx: item.idx,
            });
            scratch.assigned_z.push(n.z);
            remaining -= rate_use;
        }
        scratch.ranked = ranked;
        scratch.ranked.clear();
        return remaining.max(0.0);
    }

    // Clear only buckets dirtied last time.
    for &bi in &scratch.dirty_buckets {
        scratch.buckets[bi].clear();
    }
    scratch.dirty_buckets.clear();

    let inv = ASSIGN_DIST_BUCKETS as f64 / MAP_DIAG_CM2;
    for (idx, node) in pool.iter().enumerate() {
        let (px, py, d2) = nearest_d2(x, y, node);
        let mut b = (d2 * inv) as usize;
        if b >= ASSIGN_DIST_BUCKETS {
            b = ASSIGN_DIST_BUCKETS - 1;
        }
        if scratch.buckets[b].is_empty() {
            scratch.dirty_buckets.push(b);
        }
        scratch.buckets[b].push(Ranked { idx, d2, px, py });
    }

    for bi in 0..ASSIGN_DIST_BUCKETS {
        if remaining <= 1e-6 {
            break;
        }
        if scratch.buckets[bi].is_empty() {
            continue;
        }
        if scratch.buckets[bi].len() > 1 {
            scratch.buckets[bi]
                .sort_unstable_by(|a, c| a.d2.partial_cmp(&c.d2).unwrap_or(std::cmp::Ordering::Equal));
        }
        let items = std::mem::take(&mut scratch.buckets[bi]);
        for item in &items {
            if remaining <= 1e-6 {
                break;
            }
            let n = &pool[item.idx];
            let rate_use = n.rate.min(remaining);
            scratch.hits.push(LightHit {
                rate_used: rate_use,
                dist: item.d2,
                x: item.px,
                y: item.py,
                z: n.z,
                pool_idx: item.idx,
            });
            scratch.assigned_z.push(n.z);
            remaining -= rate_use;
        }
        // Drop items (bucket stays empty); dirty_buckets will clear next call.
        // Don't restore — saves write-back. Mark still dirty for clear next time.
        let _ = items;
    }
    remaining.max(0.0)
}

#[inline]
fn haul_distance_to_score(d: f64) -> f64 {
    1.0 / (1.0 + d.max(0.0) / HAUL_REF_CM)
}

fn finish_score(
    scratch: &mut ScoreScratch,
    x: f64,
    y: f64,
    is_weighted: bool,
    center_power: f64,
    include_elevation: bool,
    met: f64,
    need: f64,
    satisfiable: bool,
) -> (f64, f64, f64) {
    let z_site = {
        scratch.median_buf.clear();
        scratch.median_buf.extend_from_slice(&scratch.assigned_z);
        median_inplace(&mut scratch.median_buf)
    };

    // One sqrt per hit (plan-view or 3D).
    if include_elevation && !scratch.hits.is_empty() {
        for h in &mut scratch.hits {
            let dx = h.x - x;
            let dy = h.y - y;
            let dz = h.z - z_site;
            h.dist = (dx * dx + dy * dy + dz * dz).sqrt();
        }
    } else {
        for h in &mut scratch.hits {
            h.dist = h.dist.sqrt(); // was d²
        }
    }

    let total_haul = if is_weighted {
        let mut num = 0.0;
        let mut den = 0.0;
        for h in &scratch.hits {
            num += h.rate_used * h.dist;
            den += h.rate_used;
        }
        if den > 1e-9 {
            num / den
        } else {
            0.0
        }
    } else {
        let p = center_power.clamp(1.0, 2.5);
        scratch.means.clear();
        for &(start, len, demanded, supplied) in &scratch.res_spans {
            if supplied <= 1e-9 && demanded <= 1e-9 {
                continue;
            }
            let denom = if demanded > 1e-9 {
                demanded.min(supplied)
            } else {
                1.0
            };
            if denom <= 1e-9 {
                continue;
            }
            let mut resource_haul = 0.0;
            for h in &scratch.hits[start..start + len] {
                resource_haul += h.rate_used * h.dist;
            }
            let use_denom = if supplied > 1e-9 { supplied } else { denom };
            scratch.means.push(resource_haul / use_denom);
        }
        if scratch.means.is_empty() {
            0.0
        } else {
            let n = scratch.means.len() as f64;
            let acc = scratch.means.iter().map(|m| m.powf(p)).sum::<f64>() / n;
            acc.powf(1.0 / p)
        }
    };

    let quality = haul_distance_to_score(total_haul);
    let score = if satisfiable {
        quality
    } else {
        0.35 * (met / need.max(1.0)) * quality
    };
    (score, total_haul, z_site)
}

#[inline]
pub fn score_site_light(
    scratch: &mut ScoreScratch,
    x: f64,
    y: f64,
    demand_pools: &[DemandPool<'_>],
    scoring_mode: &str,
    center_power: f64,
    include_elevation: bool,
) -> LightSite {
    scratch.hits.clear();
    scratch.res_spans.clear();
    scratch.assigned_z.clear();

    let is_weighted = scoring_mode == "weighted";
    let mut satisfiable = true;
    let mut met = 0.0;
    let mut need = 0.0;

    for d in demand_pools {
        need += d.demanded;
        let start = scratch.hits.len();
        let remaining = assign_nearest(scratch, x, y, d.pool, d.demanded);
        let len = scratch.hits.len() - start;
        let supplied = d.demanded - remaining;
        met += supplied;
        if remaining > 1e-3 {
            satisfiable = false;
        }
        scratch.res_spans.push((start, len, d.demanded, supplied));
    }

    let (score, total_haul, z_site) = finish_score(
        scratch,
        x,
        y,
        is_weighted,
        center_power,
        include_elevation,
        met,
        need,
        satisfiable,
    );

    LightSite {
        x,
        y,
        z: z_site,
        score,
        satisfiable,
        total_haul,
    }
}

fn materialize_assignments(
    scratch: &ScoreScratch,
    demand_pools: &[DemandPool<'_>],
) -> Vec<ResourceAssignment> {
    let mut by_resource = Vec::with_capacity(scratch.res_spans.len());
    for (i, &(start, len, demanded, supplied)) in scratch.res_spans.iter().enumerate() {
        let pool = demand_pools.get(i).map(|d| d.pool).unwrap_or(&[]);
        let resource = demand_pools
            .get(i)
            .map(|d| d.resource.to_string())
            .unwrap_or_default();
        let mut nodes = Vec::with_capacity(len);
        for h in &scratch.hits[start..start + len] {
            let n = &pool[h.pool_idx];
            nodes.push(NodeAssignment {
                node_id: n.id.clone(),
                rate_used: h.rate_used,
                dist: h.dist,
                x: h.x,
                y: h.y,
                z: h.z,
                purity: n.purity.clone(),
                cave_risk: n.cave,
            });
        }
        by_resource.push(ResourceAssignment {
            resource,
            nodes,
            supplied,
            demanded,
            shortfall: (demanded - supplied).max(0.0),
        });
    }
    by_resource
}

pub fn score_site(
    scratch: &mut ScoreScratch,
    x: f64,
    y: f64,
    demand_pools: &[DemandPool<'_>],
    scoring_mode: &str,
    center_power: f64,
    include_elevation: bool,
) -> SiteScore {
    let light = score_site_light(
        scratch,
        x,
        y,
        demand_pools,
        scoring_mode,
        center_power,
        include_elevation,
    );
    let by_resource = materialize_assignments(scratch, demand_pools);

    let mut notes = Vec::new();
    'outer: for ra in &by_resource {
        for n in &ra.nodes {
            if n.cave_risk {
                let id_short = if n.node_id.len() > 24 {
                    format!("{}…", &n.node_id[..24])
                } else {
                    n.node_id.clone()
                };
                notes.push(format!(
                    "{}: node {} cave (z={})",
                    ra.resource,
                    id_short,
                    n.z.round()
                ));
                if notes.len() >= 6 {
                    break 'outer;
                }
            }
        }
    }

    SiteScore {
        x: light.x,
        y: light.y,
        z: light.z,
        score: light.score,
        satisfiable: light.satisfiable,
        total_haul: light.total_haul,
        by_resource,
        cave_risk_notes: notes,
        capacity_tag: None,
        max_utilization: None,
        capacity_by_resource: None,
        limited: None,
    }
}

fn assignment_centroid(by_resource: &[ResourceAssignment], scoring_mode: &str) -> Option<(f64, f64)> {
    if scoring_mode == "weighted" {
        let mut sx = 0.0;
        let mut sy = 0.0;
        let mut w = 0.0;
        for ra in by_resource {
            for n in &ra.nodes {
                sx += n.x * n.rate_used;
                sy += n.y * n.rate_used;
                w += n.rate_used;
            }
        }
        return if w > 1e-9 {
            Some((sx / w, sy / w))
        } else {
            None
        };
    }
    let mut sx = 0.0;
    let mut sy = 0.0;
    let mut n_res = 0;
    for ra in by_resource {
        let mut rx = 0.0;
        let mut ry = 0.0;
        let mut w = 0.0;
        for n in &ra.nodes {
            rx += n.x * n.rate_used;
            ry += n.y * n.rate_used;
            w += n.rate_used;
        }
        if w <= 1e-9 {
            continue;
        }
        sx += rx / w;
        sy += ry / w;
        n_res += 1;
    }
    if n_res == 0 {
        None
    } else {
        Some((sx / n_res as f64, sy / n_res as f64))
    }
}

fn site_better(a: &SiteScore, b: &SiteScore) -> bool {
    if a.satisfiable != b.satisfiable {
        return a.satisfiable;
    }
    a.score > b.score
}

pub fn relocate_site_to_assignment(
    scratch: &mut ScoreScratch,
    site: &SiteScore,
    demand_pools: &[DemandPool<'_>],
    scoring_mode: &str,
    center_power: f64,
    include_elevation: bool,
) -> SiteScore {
    let mut best = site.clone();
    let mut cur = site.clone();
    for _ in 0..6 {
        let Some((tx, ty)) = assignment_centroid(&cur.by_resource, scoring_mode) else {
            break;
        };
        let step2 = (cur.x - tx).powi(2) + (cur.y - ty).powi(2);
        if step2 < 50.0 * 50.0 {
            break;
        }
        let next = score_site(
            scratch,
            tx,
            ty,
            demand_pools,
            scoring_mode,
            center_power,
            include_elevation,
        );
        if site_better(&next, &best) {
            best = next.clone();
        }
        if site_better(&next, &cur) || next.score >= cur.score * 0.995 {
            cur = next;
            continue;
        }
        let mid = score_site(
            scratch,
            (cur.x + tx) * 0.5,
            (cur.y + ty) * 0.5,
            demand_pools,
            scoring_mode,
            center_power,
            include_elevation,
        );
        if site_better(&mid, &best) {
            best = mid.clone();
        }
        if site_better(&mid, &cur) || mid.score >= cur.score * 0.995 {
            cur = mid;
            continue;
        }
        break;
    }
    if site_better(&best, site) || best.score >= site.score * 0.999 {
        best
    } else {
        site.clone()
    }
}

fn local_capacity_sum(x: f64, y: f64, pool: &[ScoredNode], radius_cm: f64) -> f64 {
    let r2 = radius_cm * radius_cm;
    let mut sum = 0.0;
    for n in pool {
        let (_, _, d2) = nearest_d2(x, y, n);
        if d2 <= r2 {
            sum += n.rate;
        }
    }
    sum
}

pub fn annotate_site_capacity(
    site: SiteScore,
    nodes_by_resource: &HashMap<String, Vec<ScoredNode>>,
    miner: &MinerSettings,
) -> SiteScore {
    let capacity_by_resource: Vec<ResourceCapacityInfo> = site
        .by_resource
        .iter()
        .map(|ra| {
            let pool = nodes_by_resource
                .get(&ra.resource)
                .map(|v| v.as_slice())
                .unwrap_or(&[]);
            let local_capacity = local_capacity_sum(site.x, site.y, pool, LOCAL_CAPACITY_RADIUS_CM);
            let demanded = ra.demanded;
            let spare = (local_capacity - demanded).max(0.0);
            let utilization = if local_capacity > 1e-9 {
                demanded / local_capacity
            } else if demanded > 1e-9 {
                f64::INFINITY
            } else {
                0.0
            };
            ResourceCapacityInfo {
                resource: ra.resource.clone(),
                demanded,
                local_capacity,
                utilization,
                spare,
            }
        })
        .collect();

    let (tag, max_u) = if !site.satisfiable {
        let max_u = capacity_by_resource.iter().fold(0.0_f64, |m, c| {
            let u = if c.utilization.is_finite() {
                c.utilization
            } else {
                1e9
            };
            m.max(u)
        });
        ("shortfall".to_string(), max_u)
    } else {
        let mut max_utilization = 0.0_f64;
        for c in &capacity_by_resource {
            let u = if c.utilization.is_finite() {
                c.utilization
            } else {
                f64::INFINITY
            };
            if u > max_utilization {
                max_utilization = u;
            }
        }
        if max_utilization >= UTIL_LIMITED || !max_utilization.is_finite() {
            ("limited".to_string(), max_utilization)
        } else if max_utilization <= UTIL_ABUNDANT {
            let mut abundant_ok = !capacity_by_resource.is_empty();
            for c in &capacity_by_resource {
                let pure = pure_node_extract_rate(&c.resource, miner);
                let min_spare = (0.5 * pure).max(0.5 * c.demanded);
                if c.spare + 1e-6 < min_spare {
                    abundant_ok = false;
                    break;
                }
            }
            if abundant_ok {
                ("abundant".to_string(), max_utilization)
            } else {
                ("ok".to_string(), max_utilization)
            }
        } else {
            ("ok".to_string(), max_utilization)
        }
    };

    let limited = tag == "limited";
    SiteScore {
        capacity_tag: Some(tag),
        max_utilization: Some(max_u),
        capacity_by_resource: Some(capacity_by_resource),
        limited: Some(limited),
        ..site
    }
}

pub fn normalize_scores_for_display(scores: &[f64], heat_contrast: f64) -> Vec<f64> {
    let mut peak = 0.0_f64;
    for &s in scores {
        if s > peak {
            peak = s;
        }
    }
    if peak <= 1e-12 {
        return vec![0.0; scores.len()];
    }
    let mut sorted: Vec<f64> = scores.iter().copied().filter(|&s| s > 0.0).collect();
    if sorted.is_empty() {
        return vec![0.0; scores.len()];
    }
    sorted.sort_unstable_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let p98_idx = ((sorted.len() as f64 * 0.98).floor() as usize).min(sorted.len() - 1);
    let p98 = sorted[p98_idx];
    let ref_v = (peak * 0.94).max(p98).max(1e-12);
    let emphasis = heat_contrast.clamp(1.1, 3.2);
    let t = (emphasis - 1.1) / (3.2 - 1.1);
    let floor = 0.5 + t * 0.3;
    let power = 1.25 + t * 1.35;
    let inv_span = 1.0 / (1.0 - floor);

    scores
        .iter()
        .map(|&s| {
            if s <= 0.0 {
                return 0.0;
            }
            let r = s / ref_v;
            if r <= floor {
                return 0.0;
            }
            (((r - floor) * inv_span).min(1.0)).powf(power)
        })
        .collect()
}

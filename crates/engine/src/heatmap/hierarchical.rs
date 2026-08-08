//! Hierarchical capacity heatmap.
//!
//! Hot path (coarse + refine samples) uses [`score_site_light`]. Full scoring only
//! for regional winners and top-N relocate/annotate.

use super::score::{
    annotate_site_capacity, normalize_scores_for_display, prepare_nodes, relocate_site_to_assignment,
    score_site, score_site_light, DemandPool, LightSite, ScoreScratch,
};
use super::types::*;
use std::collections::HashSet;

fn dist2(ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    let dx = ax - bx;
    let dy = ay - by;
    dx * dx + dy * dy
}

fn pick_diverse_sites(candidates: &[SiteScore], top_n: usize, min_sep: f64) -> Vec<SiteScore> {
    if candidates.is_empty() || top_n == 0 {
        return vec![];
    }
    let min_sep2 = min_sep * min_sep;
    let mut sorted = candidates.to_vec();
    sorted.sort_by(|a, b| match (a.satisfiable, b.satisfiable) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => b
            .score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal),
    });
    let mut picked = Vec::new();
    for s in sorted {
        if picked.len() >= top_n {
            break;
        }
        if picked
            .iter()
            .all(|p: &SiteScore| dist2(p.x, p.y, s.x, s.y) >= min_sep2)
        {
            picked.push(s);
        }
    }
    picked
}

fn now_ms() -> f64 {
    #[cfg(target_arch = "wasm32")]
    {
        use wasm_bindgen::JsCast;
        if let Some(perf) = web_sys::window().and_then(|w| w.performance()) {
            return perf.now();
        }
        js_sys::Reflect::get(&js_sys::global(), &"performance".into())
            .ok()
            .and_then(|p| p.dyn_into::<web_sys::Performance>().ok())
            .map(|p| p.now())
            .unwrap_or(0.0)
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs_f64() * 1000.0)
            .unwrap_or(0.0)
    }
}

fn light_better(a: &LightSite, b: &LightSite) -> bool {
    if a.satisfiable != b.satisfiable {
        return a.satisfiable;
    }
    a.score > b.score
}

/// Hierarchical capacity heatmap + diverse top-N sites.
pub fn compute_hierarchical_heatmap(input: &ScoreGridInput) -> HeatmapResult {
    let t0 = now_ms();
    let options = &input.options;
    let demand = &input.demand;

    let demand_res: HashSet<String> = demand.iter().map(|d| d.resource.clone()).collect();
    let nodes_by_resource = prepare_nodes(
        &input.nodes,
        &input.miner,
        &demand_res,
        input.open_water.as_ref(),
    );

    let demand_pools: Vec<DemandPool<'_>> = demand
        .iter()
        .filter(|d| d.items_per_minute > 0.0)
        .map(|d| DemandPool {
            demanded: d.items_per_minute,
            resource: d.resource.as_str(),
            pool: nodes_by_resource
                .get(&d.resource)
                .map(|v| v.as_slice())
                .unwrap_or(&[]),
        })
        .collect();

    let cols = input.coarse_cols;
    let rows = input.coarse_rows;
    let cell_w = (input.bounds.max_x - input.bounds.min_x) / cols as f64;
    let cell_h = (input.bounds.max_y - input.bounds.min_y) / rows as f64;
    let mut grid = HeatmapGrid {
        origin_x: input.bounds.min_x,
        origin_y: input.bounds.min_y,
        cell_w,
        cell_h,
        cols,
        rows,
        scores: vec![0.0; (cols * rows) as usize],
        satisfiable: vec![false; (cols * rows) as usize],
    };

    let map_span = ((input.bounds.max_x - input.bounds.min_x).powi(2)
        + (input.bounds.max_y - input.bounds.min_y).powi(2))
    .sqrt();
    let sep_frac = options.site_sep_fraction.clamp(0.04, 0.42);
    let cell_diag = (grid.cell_w.powi(2) + grid.cell_h.powi(2)).sqrt();
    let min_site_sep = (map_span * sep_frac).max(cell_diag * 1.5);
    let seed_count = options
        .top_n
        .saturating_mul(6)
        .max(input.refine_top_k)
        .max(((map_span / (min_site_sep * 0.85).max(cell_diag)).ceil() as usize + 4).min(48));
    let min_coarse_sep = (min_site_sep * 0.85).max(cell_diag * 1.25);

    let scoring_mode = if input.scoring_mode == "weighted" {
        "weighted"
    } else {
        "centered"
    };

    let mut scratch = ScoreScratch::new();
    let t_after_prepare = now_ms();

    #[derive(Clone, Copy)]
    struct Coarse {
        light: LightSite,
        col: u32,
        row: u32,
    }

    let n_cells = (cols * rows) as usize;
    let mut coarse_sites: Vec<Coarse> = Vec::with_capacity(n_cells);
    for row in 0..rows {
        for col in 0..cols {
            let cx = grid.origin_x + (col as f64 + 0.5) * grid.cell_w;
            let cy = grid.origin_y + (row as f64 + 0.5) * grid.cell_h;
            let light = score_site_light(
                &mut scratch,
                cx,
                cy,
                &demand_pools,
                scoring_mode,
                options.center_power,
                options.include_elevation,
            );
            let idx = (row * cols + col) as usize;
            grid.scores[idx] = light.score;
            grid.satisfiable[idx] = light.satisfiable;
            coarse_sites.push(Coarse { light, col, row });
        }
    }

    let t_after_coarse = now_ms();

    coarse_sites.sort_by(|a, b| match (a.light.satisfiable, b.light.satisfiable) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => b
            .light
            .score
            .partial_cmp(&a.light.score)
            .unwrap_or(std::cmp::Ordering::Equal),
    });

    let mut seeds: Vec<Coarse> = Vec::new();
    for c in &coarse_sites {
        if seeds.len() >= seed_count {
            break;
        }
        let far = seeds.iter().all(|s| {
            dist2(s.light.x, s.light.y, c.light.x, c.light.y) >= min_coarse_sep * min_coarse_sep
        });
        if far {
            seeds.push(*c);
        }
    }

    let subdiv = input.refine_subdiv.max(1);
    let mut regional_best: Vec<SiteScore> = Vec::with_capacity(seeds.len());
    for c in &seeds {
        let x0 = grid.origin_x + c.col as f64 * grid.cell_w;
        let y0 = grid.origin_y + c.row as f64 * grid.cell_h;
        let sub_w = grid.cell_w / subdiv as f64;
        let sub_h = grid.cell_h / subdiv as f64;

        let mut best_light = c.light;
        for sr in 0..subdiv {
            for sc in 0..subdiv {
                let cx = x0 + (sc as f64 + 0.5) * sub_w;
                let cy = y0 + (sr as f64 + 0.5) * sub_h;
                let refined = score_site_light(
                    &mut scratch,
                    cx,
                    cy,
                    &demand_pools,
                    scoring_mode,
                    options.center_power,
                    options.include_elevation,
                );
                if light_better(&refined, &best_light) {
                    best_light = refined;
                }
            }
        }
        regional_best.push(score_site(
            &mut scratch,
            best_light.x,
            best_light.y,
            &demand_pools,
            scoring_mode,
            options.center_power,
            options.include_elevation,
        ));
    }

    let t_after_refine = now_ms();

    let mut pool: Vec<SiteScore> = regional_best
        .iter()
        .map(|s| {
            relocate_site_to_assignment(
                &mut scratch,
                s,
                &demand_pools,
                scoring_mode,
                options.center_power,
                options.include_elevation,
            )
        })
        .collect();

    for c in coarse_sites.iter().take(seed_count) {
        let full = score_site(
            &mut scratch,
            c.light.x,
            c.light.y,
            &demand_pools,
            scoring_mode,
            options.center_power,
            options.include_elevation,
        );
        pool.push(relocate_site_to_assignment(
            &mut scratch,
            &full,
            &demand_pools,
            scoring_mode,
            options.center_power,
            options.include_elevation,
        ));
    }

    let picked = pick_diverse_sites(&pool, options.top_n, min_site_sep);
    let top_sites: Vec<SiteScore> = picked
        .into_iter()
        .map(|s| annotate_site_capacity(s, &nodes_by_resource, &input.miner))
        .collect();

    grid.scores = normalize_scores_for_display(&grid.scores, options.heat_contrast);

    let t_end = now_ms();
    HeatmapResult {
        grid,
        top_sites,
        elapsed_ms: t_end - t0,
        timings: HeatmapTimings {
            prepare_ms: t_after_prepare - t0,
            coarse_ms: t_after_coarse - t_after_prepare,
            refine_ms: t_after_refine - t_after_coarse,
            top_sites_ms: t_end - t_after_refine,
        },
        scored_demand: demand.clone(),
    }
}

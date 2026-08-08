//! Browser-facing WASM engine for Satisfactory Heatmap.
//!
//! Public wire types use `tsify` so wasm-pack emits real TypeScript interfaces
//! (not `any` / `JsValue`). Domain fields are camelCase via serde to match `@/types`.

use wasm_bindgen::prelude::*;

pub mod heatmap;

use heatmap::compute_hierarchical_heatmap;
use heatmap::types::{HeatmapResult, ScoreGridInput};
use konsl_randomization::{apply_world_seed, ResourceNodeDto};

/// Crate / glue version for diagnostics.
#[wasm_bindgen]
pub fn engine_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Cheap sanity export — worker calls once at boot to warm WASM.
#[wasm_bindgen]
pub fn ping() -> u32 {
    1
}

/// Hierarchical heatmap score (typed wire: `ScoreGridInput` → `HeatmapResult`).
#[wasm_bindgen]
pub fn score_grid(input: ScoreGridInput) -> HeatmapResult {
    compute_hierarchical_heatmap(&input)
}

/// Apply map seed to fixed base slots.
///
/// - `is_default` true → identity clone (vanilla layout)
/// - else → strict shuffle + purity no_change at `seed` (i32)
#[wasm_bindgen]
pub fn apply_map_seed(nodes: Vec<ResourceNodeDto>, seed: i32, is_default: bool) -> Vec<ResourceNodeDto> {
    apply_world_seed(&nodes, seed, is_default)
}

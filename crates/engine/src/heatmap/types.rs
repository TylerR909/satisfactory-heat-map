//! Shared types mirrored from `src/types` for scoring (serde camelCase for JS).

use serde::{Deserialize, Serialize};
use tsify::Tsify;

#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ResourceNode {
    pub id: String,
    pub resource: String,
    pub purity: String,
    #[serde(default)]
    pub node_type: String,
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub z: f64,
    #[serde(default)]
    pub flags: Option<NodeFlags>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct NodeFlags {
    #[serde(default)]
    pub cave: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct MinerSettings {
    pub miner_mk: u8,
    pub clock_percent: f64,
    #[serde(default = "default_clock")]
    pub oil_clock_percent: f64,
    #[serde(default = "default_clock")]
    pub water_clock_percent: f64,
    #[serde(default = "default_true")]
    pub resource_wells_enabled: bool,
    #[serde(default = "default_clock")]
    pub well_clock_percent: f64,
}

fn default_clock() -> f64 {
    100.0
}
fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ScoringOptions {
    #[serde(default = "default_center_power")]
    pub center_power: f64,
    #[serde(default = "default_heat_contrast")]
    pub heat_contrast: f64,
    #[serde(default = "default_top_n")]
    pub top_n: usize,
    #[serde(default = "default_site_sep")]
    pub site_sep_fraction: f64,
    #[serde(default = "default_true")]
    pub include_elevation: bool,
}

fn default_center_power() -> f64 {
    1.35
}
fn default_heat_contrast() -> f64 {
    2.35
}
fn default_top_n() -> usize {
    5
}
fn default_site_sep() -> f64 {
    0.12
}

#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct RawDemand {
    pub resource: String,
    pub items_per_minute: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct WorldBounds {
    pub min_x: f64,
    pub max_x: f64,
    pub min_y: f64,
    pub max_y: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct OpenWaterBody {
    pub id: String,
    pub slots: f64,
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub samples: Option<Vec<[f64; 2]>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct OpenWaterData {
    #[serde(default)]
    pub bodies: Vec<OpenWaterBody>,
    #[serde(default)]
    pub extractor_rate_at100: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(rename_all = "camelCase")]
pub struct ScoreGridInput {
    pub nodes: Vec<ResourceNode>,
    #[serde(default)]
    pub open_water: Option<OpenWaterData>,
    pub demand: Vec<RawDemand>,
    pub miner: MinerSettings,
    #[serde(default = "default_scoring_mode")]
    pub scoring_mode: String,
    pub options: ScoringOptions,
    pub bounds: WorldBounds,
    pub coarse_cols: u32,
    pub coarse_rows: u32,
    pub refine_top_k: usize,
    pub refine_subdiv: u32,
    #[serde(default)]
    pub cave_delta_z_cm: f64,
}

fn default_scoring_mode() -> String {
    "centered".into()
}

#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct NodeAssignment {
    pub node_id: String,
    pub rate_used: f64,
    pub dist: f64,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub purity: String,
    pub cave_risk: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ResourceAssignment {
    pub resource: String,
    pub nodes: Vec<NodeAssignment>,
    pub supplied: f64,
    pub demanded: f64,
    pub shortfall: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct ResourceCapacityInfo {
    pub resource: String,
    pub demanded: f64,
    pub local_capacity: f64,
    pub utilization: f64,
    pub spare: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct SiteScore {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub score: f64,
    pub satisfiable: bool,
    pub total_haul: f64,
    pub by_resource: Vec<ResourceAssignment>,
    pub cave_risk_notes: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capacity_tag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_utilization: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capacity_by_resource: Option<Vec<ResourceCapacityInfo>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limited: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct HeatmapGrid {
    pub origin_x: f64,
    pub origin_y: f64,
    pub cell_w: f64,
    pub cell_h: f64,
    pub cols: u32,
    pub rows: u32,
    pub scores: Vec<f64>,
    pub satisfiable: Vec<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct HeatmapTimings {
    pub prepare_ms: f64,
    pub coarse_ms: f64,
    pub refine_ms: f64,
    pub top_sites_ms: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(rename_all = "camelCase")]
pub struct HeatmapResult {
    pub grid: HeatmapGrid,
    pub top_sites: Vec<SiteScore>,
    pub elapsed_ms: f64,
    pub timings: HeatmapTimings,
    pub scored_demand: Vec<RawDemand>,
}

//! Extract rates — port of `src/lib/mining.ts`.

use super::types::{MinerSettings, ResourceNode};

const WATER_EXTRACTOR_BASE: f64 = 120.0;
const OIL_EXTRACTOR_NORMAL_BASE: f64 = 120.0;
const WELL_EXTRACTOR_NORMAL_BASE: f64 = 60.0;
const PORTABLE_MINER_NORMAL_BASE: f64 = 40.0;

fn purity_mult(purity: &str) -> f64 {
    match purity {
        "impure" => 0.5,
        "pure" => 2.0,
        _ => 1.0,
    }
}

fn miner_base(mk: u8) -> f64 {
    match mk {
        1 => 60.0,
        3 => 240.0,
        _ => 120.0,
    }
}

fn is_solid_ore(resource: &str) -> bool {
    matches!(
        resource,
        "Desc_OreIron_C"
            | "Desc_OreCopper_C"
            | "Desc_Stone_C"
            | "Desc_Coal_C"
            | "Desc_OreGold_C"
            | "Desc_RawQuartz_C"
            | "Desc_Sulfur_C"
            | "Desc_OreBauxite_C"
            | "Desc_OreUranium_C"
            | "Desc_SAM_C"
    )
}

enum ExtractorKind {
    None,
    Miner,
    Oil,
    Water,
    Well,
    Portable,
}

fn extractor_kind(node: &ResourceNode) -> ExtractorKind {
    match node.node_type.as_str() {
        "geyser" | "frackingCore" => ExtractorKind::None,
        "frackingSatellite" => ExtractorKind::Well,
        "deposit" => ExtractorKind::Portable,
        _ => {
            if node.resource == "Desc_LiquidOil_C" {
                ExtractorKind::Oil
            } else if node.resource == "Desc_Water_C" {
                ExtractorKind::Water
            } else if is_solid_ore(&node.resource) || node.node_type == "node" || node.node_type.is_empty()
            {
                ExtractorKind::Miner
            } else {
                ExtractorKind::None
            }
        }
    }
}

fn with_clock(base: f64, clock: f64) -> f64 {
    base * (clock / 100.0)
}

pub fn node_extract_rate(node: &ResourceNode, settings: &MinerSettings) -> f64 {
    let miner_clock = settings.clock_percent;
    match extractor_kind(node) {
        ExtractorKind::None => 0.0,
        ExtractorKind::Miner => with_clock(
            miner_base(settings.miner_mk) * purity_mult(&node.purity),
            miner_clock,
        ),
        ExtractorKind::Oil => with_clock(
            OIL_EXTRACTOR_NORMAL_BASE * purity_mult(&node.purity),
            settings.oil_clock_percent,
        ),
        ExtractorKind::Water => with_clock(WATER_EXTRACTOR_BASE, settings.water_clock_percent),
        ExtractorKind::Well => {
            if !settings.resource_wells_enabled {
                0.0
            } else {
                with_clock(
                    WELL_EXTRACTOR_NORMAL_BASE * purity_mult(&node.purity),
                    settings.well_clock_percent,
                )
            }
        }
        ExtractorKind::Portable => with_clock(
            PORTABLE_MINER_NORMAL_BASE * purity_mult(&node.purity),
            miner_clock,
        ),
    }
}

pub fn pure_node_extract_rate(resource: &str, miner: &MinerSettings) -> f64 {
    if resource == "Desc_Water_C" {
        return WATER_EXTRACTOR_BASE * (miner.water_clock_percent / 100.0);
    }
    let probe = ResourceNode {
        id: format!("pure-probe-{resource}"),
        resource: resource.to_string(),
        purity: "pure".into(),
        node_type: "node".into(),
        x: 0.0,
        y: 0.0,
        z: 0.0,
        flags: None,
    };
    node_extract_rate(&probe, miner)
}

pub const WATER_RESOURCE_ID: &str = "Desc_Water_C";
pub const WATER_EXTRACTOR_BASE_PUB: f64 = WATER_EXTRACTOR_BASE;

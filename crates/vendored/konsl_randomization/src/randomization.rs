//! Node randomization — port of Konsl `randomization.rs` + worldFromNodes adapter.
//! Algorithm matches the former TypeScript port of Konsl MIT code.

use crate::random_stream::RandomStream;
use crate::resources::{
    has_gameplay_tag, purity_ordinal, resource_label, resources_with_tag, GameplayTag,
};
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Clone, Debug, Serialize, Deserialize, Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
#[serde(rename_all = "camelCase")]
pub struct ResourceNodeDto {
    pub id: String,
    pub resource: String,
    pub purity: String,
    #[serde(default = "default_node_type")]
    pub node_type: String,
    #[serde(default)]
    pub display_name: Option<String>,
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub z: f64,
    #[serde(default)]
    pub class_path: Option<String>,
    #[serde(default)]
    pub rotation: Option<f64>,
    /// Opaque optional flags (e.g. cave). Seed shuffle does not read these.
    #[serde(default)]
    pub flags: Option<NodeFlagsDto>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct NodeFlagsDto {
    #[serde(default)]
    pub cave: Option<bool>,
}

fn default_node_type() -> String {
    "node".into()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NodeRandomizationMode {
    None,
    Strict,
    BasicRich,
    AdvancedRich,
    FossilFuelRich,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NodePuritySettings {
    NoChange,
    AllImpure,
    Decrease,
    AllNormal,
    Increase,
    AllPure,
    AllRandom,
}

#[derive(Clone)]
struct AlgoResourceNode {
    name: String,
    resource: String,
    purity: String,
    base_index: usize,
}

#[derive(Clone)]
struct AlgoSatellite {
    name: String,
    purity: String,
    base_index: usize,
}

#[derive(Clone)]
struct AlgoFrackingCore {
    name: String,
    resource: String,
    satellites: Vec<AlgoSatellite>,
    base_index: usize,
}

struct AlgoWorld {
    resource_nodes: Vec<AlgoResourceNode>,
    fracking_cores: Vec<AlgoFrackingCore>,
}

#[derive(Clone)]
struct ResourceNodeInfo {
    resource: String,
    purity: Option<String>,
    total_throughput: i32,
}

fn compare_code_unit(a: &str, b: &str) -> std::cmp::Ordering {
    a.cmp(b)
}

fn compare_purity(a: &Option<String>, b: &Option<String>) -> std::cmp::Ordering {
    let ao = a.as_deref().map(purity_ordinal).unwrap_or(-1);
    let bo = b.as_deref().map(purity_ordinal).unwrap_or(-1);
    ao.cmp(&bo)
}

fn compare_node_info(a: &ResourceNodeInfo, b: &ResourceNodeInfo) -> std::cmp::Ordering {
    compare_code_unit(&a.resource, &b.resource)
        .then_with(|| compare_purity(&a.purity, &b.purity))
        .then_with(|| a.total_throughput.cmp(&b.total_throughput))
}

fn shuffle<T>(rng: &mut RandomStream, pool: &mut [T]) {
    if pool.len() < 2 {
        return;
    }
    for i in 0..pool.len() - 1 {
        let span = (pool.len() - i) as f32;
        let off = rng.frand_range(0.0..span) as usize;
        let swap_index = (i + off).min(pool.len() - 1);
        pool.swap(i, swap_index);
    }
}

fn get_purity_override(
    rng: &mut RandomStream,
    purity: Option<&str>,
    settings: NodePuritySettings,
) -> Option<String> {
    match settings {
        NodePuritySettings::NoChange => None,
        NodePuritySettings::AllPure => Some("pure".into()),
        NodePuritySettings::AllNormal => Some("normal".into()),
        NodePuritySettings::AllImpure => Some("impure".into()),
        NodePuritySettings::AllRandom => {
            let r = rng.frand_range(0.0..3.0) as i32;
            Some(match r {
                0 => "impure".into(),
                1 => "normal".into(),
                _ => "pure".into(),
            })
        }
        NodePuritySettings::Increase => match purity {
            None => None,
            Some("impure") => Some("normal".into()),
            _ => Some("pure".into()),
        },
        NodePuritySettings::Decrease => match purity {
            None => None,
            Some("pure") => Some("normal".into()),
            _ => Some("impure".into()),
        },
    }
}

fn modify_node_distribution(
    rng: &mut RandomStream,
    node_pool: &mut [ResourceNodeInfo],
    tag: GameplayTag,
    multiplier: f64,
) {
    let mut matching = node_pool
        .iter()
        .filter(|n| has_gameplay_tag(&n.resource, tag))
        .count();
    let modified = (matching as f64 * multiplier).round() as usize;
    let resource_options = resources_with_tag(tag);
    shuffle(rng, node_pool);

    let mut seen = std::collections::HashSet::new();
    for n in node_pool.iter_mut() {
        if matching >= modified {
            break;
        }
        if has_gameplay_tag(&n.resource, tag) {
            continue;
        }
        if !seen.contains(&n.resource) {
            seen.insert(n.resource.clone());
            continue;
        }
        if resource_options.is_empty() {
            continue;
        }
        let idx = rng.frand_range(0.0..resource_options.len() as f32) as usize;
        let idx = idx.min(resource_options.len() - 1);
        n.resource = resource_options[idx].to_string();
        matching += 1;
    }
}

fn distribute_throughput(core: &mut AlgoFrackingCore, throughput: i32) {
    for s in &mut core.satellites {
        s.purity = "pure".into();
    }
    let mut error = core.satellites.len() as i32 * purity_ordinal("pure") - throughput;
    if error < 2 {
        return;
    }
    let convert_count = ((error / 2) as usize).min(core.satellites.len());
    for i in 0..convert_count {
        if let Some(sat) = core.satellites.get_mut(i) {
            sat.purity = "normal".into();
        }
    }
    error += convert_count as i32 * (purity_ordinal("normal") - purity_ordinal("pure"));
    if error < 1 {
        return;
    }
    let impure_count = (error as usize).min(core.satellites.len());
    for i in 0..impure_count {
        if let Some(sat) = core.satellites.get_mut(i) {
            sat.purity = "impure".into();
        }
    }
}

fn core_throughput(core: &AlgoFrackingCore) -> i32 {
    core.satellites
        .iter()
        .map(|s| purity_ordinal(&s.purity))
        .sum()
}

fn nodes_to_algo_world(base: &[ResourceNodeDto]) -> AlgoWorld {
    let mut resource_nodes = Vec::new();
    let mut cores: Vec<(usize, &ResourceNodeDto)> = Vec::new();
    let mut sats: Vec<(usize, &ResourceNodeDto)> = Vec::new();

    for (i, n) in base.iter().enumerate() {
        match n.node_type.as_str() {
            "node" => resource_nodes.push(AlgoResourceNode {
                name: n.id.clone(),
                resource: n.resource.clone(),
                purity: n.purity.clone(),
                base_index: i,
            }),
            "frackingCore" => cores.push((i, n)),
            "frackingSatellite" => sats.push((i, n)),
            // deposits, geysers, etc. — passthrough (not in shuffle pool)
            _ => {}
        }
    }

    let mut fracking_cores: Vec<AlgoFrackingCore> = cores
        .iter()
        .map(|(index, node)| AlgoFrackingCore {
            name: node.id.clone(),
            resource: node.resource.clone(),
            satellites: Vec::new(),
            base_index: *index,
        })
        .collect();

    for (index, node) in sats {
        let mut best = 0usize;
        let mut best_d = f64::INFINITY;
        for (c, (_ci, core_node)) in cores.iter().enumerate() {
            let dx = core_node.x - node.x;
            let dy = core_node.y - node.y;
            let d = dx * dx + dy * dy;
            if d < best_d {
                best_d = d;
                best = c;
            }
        }
        if let Some(target) = fracking_cores.get_mut(best) {
            target.satellites.push(AlgoSatellite {
                name: node.id.clone(),
                purity: node.purity.clone(),
                base_index: index,
            });
        }
    }

    AlgoWorld {
        resource_nodes,
        fracking_cores,
    }
}

fn apply_to_algo_world(
    world: &mut AlgoWorld,
    seed: i32,
    mode: NodeRandomizationMode,
    purity_settings: NodePuritySettings,
) {
    let mut rng = RandomStream::new(seed);

    world
        .resource_nodes
        .sort_by(|a, b| compare_code_unit(&a.name, &b.name));
    world
        .fracking_cores
        .sort_by(|a, b| compare_code_unit(&a.name, &b.name));
    for c in &mut world.fracking_cores {
        c.satellites
            .sort_by(|a, b| compare_code_unit(&a.name, &b.name));
    }

    if mode == NodeRandomizationMode::None {
        for n in &mut world.resource_nodes {
            if let Some(next) = get_purity_override(&mut rng, Some(&n.purity), purity_settings) {
                n.purity = next;
            }
        }
    } else {
        let mut node_pool: Vec<ResourceNodeInfo> = world
            .resource_nodes
            .iter()
            .map(|n| ResourceNodeInfo {
                resource: n.resource.clone(),
                purity: Some(n.purity.clone()),
                total_throughput: 0,
            })
            .collect();
        node_pool.sort_by(compare_node_info);

        match mode {
            NodeRandomizationMode::BasicRich => {
                modify_node_distribution(&mut rng, &mut node_pool, GameplayTag::Basic, 1.1);
            }
            NodeRandomizationMode::AdvancedRich => {
                modify_node_distribution(&mut rng, &mut node_pool, GameplayTag::Advanced, 3.0);
            }
            NodeRandomizationMode::FossilFuelRich => {
                modify_node_distribution(&mut rng, &mut node_pool, GameplayTag::FossilFuel, 2.0);
            }
            _ => {}
        }

        for n in &mut world.resource_nodes {
            if node_pool.is_empty() {
                break;
            }
            let pool_index = rng.frand_range(0.0..node_pool.len() as f32) as usize;
            let pool_index = pool_index.min(node_pool.len() - 1);
            let info = node_pool.remove(pool_index);
            n.resource = info.resource;
            if let Some(next) =
                get_purity_override(&mut rng, info.purity.as_deref(), purity_settings)
            {
                n.purity = next;
            }
        }

        let mut fracking_pool: Vec<ResourceNodeInfo> = world
            .fracking_cores
            .iter()
            .map(|c| ResourceNodeInfo {
                resource: c.resource.clone(),
                purity: None,
                total_throughput: core_throughput(c),
            })
            .collect();
        fracking_pool.sort_by(compare_node_info);
        shuffle(&mut rng, &mut fracking_pool);

        for core in &mut world.fracking_cores {
            if fracking_pool.is_empty() {
                break;
            }
            let pool_index = rng.frand_range(0.0..fracking_pool.len() as f32) as usize;
            let pool_index = pool_index.min(fracking_pool.len() - 1);
            let info = fracking_pool.remove(pool_index);
            core.resource = info.resource;
            distribute_throughput(core, info.total_throughput);
        }
    }

    if purity_settings != NodePuritySettings::NoChange {
        let mut sat_indices: Vec<(String, usize, usize)> = Vec::new();
        for (ci, c) in world.fracking_cores.iter().enumerate() {
            for (si, s) in c.satellites.iter().enumerate() {
                sat_indices.push((s.name.clone(), ci, si));
            }
        }
        sat_indices.sort_by(|a, b| compare_code_unit(&a.0, &b.0));
        for (_, ci, si) in sat_indices {
            let purity = world.fracking_cores[ci].satellites[si].purity.clone();
            if let Some(next) = get_purity_override(&mut rng, Some(&purity), purity_settings) {
                world.fracking_cores[ci].satellites[si].purity = next;
            }
        }
    }
}

fn algo_world_to_nodes(base: &[ResourceNodeDto], world: &AlgoWorld) -> Vec<ResourceNodeDto> {
    let mut out = base.to_vec();
    for rn in &world.resource_nodes {
        if let Some(slot) = out.get_mut(rn.base_index) {
            slot.resource = rn.resource.clone();
            slot.purity = rn.purity.clone();
            slot.display_name = Some(resource_label(&rn.resource));
        }
    }
    for core in &world.fracking_cores {
        if let Some(slot) = out.get_mut(core.base_index) {
            slot.resource = core.resource.clone();
            slot.display_name = Some(resource_label(&core.resource));
        }
        for sat in &core.satellites {
            if let Some(slot) = out.get_mut(sat.base_index) {
                slot.resource = core.resource.clone();
                slot.purity = sat.purity.clone();
                slot.display_name = Some(resource_label(&core.resource));
            }
        }
    }
    out
}

/// Product policy: default layout, or strict + no_change for any numeric seed.
pub fn apply_world_seed(
    base_slots: &[ResourceNodeDto],
    seed: i32,
    is_default: bool,
) -> Vec<ResourceNodeDto> {
    if is_default {
        return base_slots.to_vec();
    }
    apply_world_seed_config(
        base_slots,
        seed,
        NodeRandomizationMode::Strict,
        NodePuritySettings::NoChange,
    )
}

pub fn apply_world_seed_config(
    base_slots: &[ResourceNodeDto],
    seed: i32,
    mode: NodeRandomizationMode,
    purity: NodePuritySettings,
) -> Vec<ResourceNodeDto> {
    if mode == NodeRandomizationMode::None && purity == NodePuritySettings::NoChange {
        return base_slots.to_vec();
    }
    let mut world = nodes_to_algo_world(base_slots);
    apply_to_algo_world(&mut world, seed, mode, purity);
    algo_world_to_nodes(base_slots, &world)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_preserves_length() {
        let nodes = vec![ResourceNodeDto {
            id: "a".into(),
            resource: "Desc_OreIron_C".into(),
            purity: "pure".into(),
            node_type: "node".into(),
            display_name: None,
            x: 0.0,
            y: 0.0,
            z: 0.0,
            class_path: None,
            rotation: None,
            flags: None,
        }];
        let out = apply_world_seed(&nodes, 0, true);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].resource, "Desc_OreIron_C");
    }
}

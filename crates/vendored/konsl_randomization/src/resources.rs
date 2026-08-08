//! Resource tags / purity ordinals — port of Konsl game descriptors we need.

pub const SHUFFLE_RESOURCES: &[&str] = &[
    "Desc_OreIron_C",
    "Desc_Coal_C",
    "Desc_OreCopper_C",
    "Desc_Stone_C",
    "Desc_RawQuartz_C",
    "Desc_LiquidOil_C",
    "Desc_Water_C",
    "Desc_SAM_C",
    "Desc_NitrogenGas_C",
    "Desc_OreBauxite_C",
    "Desc_OreGold_C",
    "Desc_Sulfur_C",
    "Desc_OreUranium_C",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GameplayTag {
    Basic,
    Advanced,
    FossilFuel,
}

pub fn purity_ordinal(purity: &str) -> i32 {
    match purity {
        "impure" => 1,
        "pure" => 4,
        _ => 2, // normal
    }
}

pub fn has_gameplay_tag(resource: &str, tag: GameplayTag) -> bool {
    match tag {
        GameplayTag::Basic => matches!(
            resource,
            "Desc_OreIron_C" | "Desc_Coal_C" | "Desc_OreCopper_C" | "Desc_Stone_C"
        ),
        GameplayTag::Advanced => matches!(
            resource,
            "Desc_RawQuartz_C"
                | "Desc_SAM_C"
                | "Desc_OreBauxite_C"
                | "Desc_OreGold_C"
                | "Desc_Sulfur_C"
                | "Desc_OreUranium_C"
        ),
        GameplayTag::FossilFuel => {
            matches!(resource, "Desc_Coal_C" | "Desc_LiquidOil_C" | "Desc_Sulfur_C")
        }
    }
}

pub fn resources_with_tag(tag: GameplayTag) -> Vec<&'static str> {
    let mut v: Vec<&'static str> = SHUFFLE_RESOURCES
        .iter()
        .copied()
        .filter(|r| has_gameplay_tag(r, tag))
        .collect();
    v.sort(); // code-unit / byte order for ASCII
    v
}

pub fn resource_label(id: &str) -> String {
    match id {
        "Desc_OreIron_C" => "Iron Ore".into(),
        "Desc_OreCopper_C" => "Copper Ore".into(),
        "Desc_Stone_C" => "Limestone".into(),
        "Desc_Coal_C" => "Coal".into(),
        "Desc_OreGold_C" => "Caterium Ore".into(),
        "Desc_RawQuartz_C" => "Raw Quartz".into(),
        "Desc_Sulfur_C" => "Sulfur".into(),
        "Desc_OreBauxite_C" => "Bauxite".into(),
        "Desc_OreUranium_C" => "Uranium".into(),
        "Desc_SAM_C" => "S.A.M. Ore".into(),
        "Desc_LiquidOil_C" => "Crude Oil".into(),
        "Desc_Water_C" => "Water".into(),
        "Desc_NitrogenGas_C" => "Nitrogen Gas".into(),
        "Desc_GeothermalEnergy_C" => "Geyser".into(),
        _ => {
            let bare = id
                .trim_start_matches("Desc_")
                .trim_start_matches("BP_")
                .trim_end_matches("_C");
            bare.replace('_', " ")
        }
    }
}

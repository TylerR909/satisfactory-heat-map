//! Vendored / ported Konsl map-seed randomization (MIT).
//!
//! Upstream: https://github.com/Konsl/satisfactory-world-generator
//! - `random_stream` — as-is UE LCG
//! - `randomization` — algorithm port matching Konsl + our JSON node adapter
//! - GPL viewer code is not included

pub mod random_stream;
pub mod randomization;
pub mod resources;

pub use random_stream::RandomStream;
pub use randomization::{
    apply_world_seed, apply_world_seed_config, NodePuritySettings, NodeRandomizationMode,
    ResourceNodeDto,
};

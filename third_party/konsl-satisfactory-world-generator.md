# Konsl / satisfactory-world-generator

**Upstream:** https://github.com/Konsl/satisfactory-world-generator  
**License:** MIT (see `konsl-satisfactory-world-generator.LICENSE`)  
**Copyright:** (c) 2026 Konsl

## What we use

**Rust / WASM** (`crates/vendored/konsl_randomization/` → `sf_engine.apply_map_seed`):

| Module | Source |
|--------|--------|
| `random_stream.rs` | Vendored as-is from Konsl (UE LCG; MIT) |
| `randomization.rs` | Full algorithm port of Konsl `randomization.rs` + our JSON `ResourceNode` adapter (same behavior as the retired TS port) |
| `resources.rs` | Gameplay tags / purity ordinals / labels needed for the algorithm |

TypeScript `src/lib/seed/` is a **thin wrapper** (cache, types, `configForSeed`) only — no algorithm.

## What we do **not** use

- `src/app/*` — the web viewer UI is **GPL v3**; it is not ported or redistributed.

## Notes

- Node **slot positions** and the vanilla type/purity template come from our FModel extract (`public/data/nodes/default-nodes.json` via `npm run extract-world-nodes`), not from Konsl’s encrypted resources zip.
- Konsl’s extractor only includes `BP_ResourceNode_C` (not `BP_ResourceDeposit_C`). Our port **excludes** deposits from the shuffle pool to match that membership.
- Fixed product policy for non-default seeds: randomization mode **strict** (in-game “Random”) + purity **no_change**.

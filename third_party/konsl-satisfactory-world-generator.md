# Konsl / satisfactory-world-generator

**Upstream:** https://github.com/Konsl/satisfactory-world-generator  
**License:** MIT (see `konsl-satisfactory-world-generator.LICENSE`)  
**Copyright:** (c) 2026 Konsl

## What we use

TypeScript ports under `src/lib/seed/` of the **MIT-licensed** randomization algorithm from:

- `src/random_stream.rs`
- `src/game.rs` (resource/purity/tag enums used by randomization)
- `src/randomization.rs`

## What we do **not** use

- `src/app/*` — the web viewer UI is **GPL v3**; it is not ported or redistributed.

## Notes

- Node **slot positions** and the vanilla type/purity template come from our own bootstrap (`public/data/nodes/default-nodes.json`, rockfactory MIT extract), not from Konsl’s encrypted resources zip.
- Konsl’s extractor only includes `BP_ResourceNode_C` (not `BP_ResourceDeposit_C`). Our port **excludes** deposits from the shuffle pool to match that membership.
- Fixed product policy for non-default seeds: randomization mode **strict** (in-game “Random”) + purity **no_change**.

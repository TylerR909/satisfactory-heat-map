# rockfactory / satisfactory-logistics

**Upstream:** https://github.com/rockfactory/satisfactory-logistics  
**License:** MIT (see `rockfactory-satisfactory-logistics.LICENSE`)  
**Copyright:** (c) 2024 Leonardo Ascione

## What we use

Bootstrap resource **node slot data** shipped as:

- `public/data/nodes/default-nodes.json`

Derived from upstream `WorldResourceNodes.json` (MIT). Coordinates, actor ids, and the vanilla type/purity layout are used as the fixed slot template for heatmaps and as input to the 1.2+ seed shuffle (Konsl algorithm — separate third_party entry).

## What we do **not** claim

- Map basemap **artwork** / tile pyramid is Coffee Stain IP (temporary CDN only; not this MIT notice).
- Randomization of types/purities is **not** rockfactory’s work; see `konsl-satisfactory-world-generator.md`.

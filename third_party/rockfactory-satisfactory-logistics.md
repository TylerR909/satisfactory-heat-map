# rockfactory / satisfactory-logistics

**Upstream:** https://github.com/rockfactory/satisfactory-logistics  
**License:** MIT (see `rockfactory-satisfactory-logistics.LICENSE`)  
**Copyright:** (c) 2024 Leonardo Ascione

## What we use

Bootstrap resource **node slot data** shipped as:

- `public/data/nodes/default-nodes.json`

Derived from upstream `WorldResourceNodes.json` (MIT). Coordinates, actor ids, and the vanilla type/purity layout are used as the fixed slot template for heatmaps and as input to the 1.2+ seed shuffle (Konsl algorithm — separate third_party entry).

## Scope of this notice

This MIT notice covers **node JSON only**. Map basemap artwork is Coffee Stain IP; our tile pyramid is generated separately (see `public/map/v1/README.md`). Randomization of types/purities is **not** rockfactory’s work; see `konsl-satisfactory-world-generator.md`.

# Open-water bodies

| File | Role |
|------|------|
| `open-water.json` | Finite open-water **pockets** (slots + coords) for heatmap water capacity |

**Not** game resource nodes — derived at build time from the basemap image (blue pixels) by `npm run map:generate` (Node + `sharp` in Docker after GDAL tiles).

- Runtime load: `/data/water/open-water.json` (same-origin; required for open-water scoring).
- Regenerate: `npm run map:generate` or `MAP_SKIP_TILES=1 npm run map:generate` (water only).
- Policy & calibration: [docs/DATA.md](../../../docs/DATA.md) (Water section).

Map art © Coffee Stain Studios.

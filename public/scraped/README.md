# Temporary / third-party basemap

This project’s **interactive basemap** is currently loaded from a **public CDN** operated by the MIT-licensed [rockfactory/satisfactory-logistics](https://github.com/rockfactory/satisfactory-logistics) project:

```
https://satisfactory-logistics-maps.fra1.cdn.digitaloceanspaces.com/map/v2/{z}/{x}/{y}.webp
```

Configured in `public/data/meta.json` → `basemap.tilesUrl`.

**Coords:** use the same `game → CRS.Simple` math as rockfactory (`src/lib/coords.ts`) so markers sit on their tiles. **Do not flip tile Y** in the Leaflet layer — that causes horizontal strip seams that get worse as you zoom in.

## Why here?

We need a readable world backdrop before shipping our own extract. Rockfactory already:

1. Extracted / upscaled the in-game map render  
2. Built a WebP XYZ tile pyramid  
3. Hosts it with public-read CDN URLs (same asset family community tools use)

Their map README states the **artwork is Coffee Stain IP**, used by community tools for reference; node data licensing is separate (MIT).

## License / honesty

| Piece | Status |
|-------|--------|
| Tile **hosting** we hot-link | Temporary dependency on rockfactory’s CDN |
| Map **artwork** | Coffee Stain Studios — not our asset |
| Our **code** + **node JSON** pipeline | MIT / attributed (see `docs/DATA.md`) |

**Do not** treat this CDN as permanent infrastructure. Coffee Stain or rockfactory may change URLs; for production you should host your own pyramid.

## Replace with your own basemap later

1. Extract or capture a square orthographic / minimap (see rockfactory `public/images/map/README.md` + `npm run generate-map-tiles` with GDAL).  
2. Publish tiles under your CDN (or `public/map/tiles/{z}/{x}/{y}.webp`).  
3. Point `meta.json` `basemap.tilesUrl` at your base, e.g. `/map/tiles/{z}/{x}/{y}.webp`.  
4. Keep the same world bounds / CRS mapping in `src/lib/coords.ts` (or re-calibrate if framing changes).  
5. Remove any note that we’re using the logistics CDN.

### Offline / air-gapped option

Download zoom 0–4 (or full pyramid) with:

```bash
# example: only low zooms for a small local cache
mkdir -p public/map/tiles
# use a small script or rclone/wget mirror of the CDN path you need
```

Then set:

```json
"tilesUrl": "/map/tiles/{z}/{x}/{y}.webp"
```

## Alternatives if the CDN dies

| Source | Notes |
|--------|--------|
| Wiki `Map.jpg` | https://satisfactory.wiki.gg/images/Map.jpg — single image, may need crop/calibration |
| Your FModel / in-game minimap | Best long-term |
| Procedural canvas | Nodes-only silhouette (no biomes) — easy fallback code if needed |

Nothing under this folder is currently a committed binary; the “scrape” is a **runtime URL** documented here for provenance.
